import "server-only";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Server-side credential discovery per PRD 12.2 and references/05-ai-implementation.md.
// Order: project .env.local / .dev.vars / .env -> $HOME/user_key.txt -> $HOME/use_key.txt.
// Secrets never reach the client. We only expose presence + non-secret metadata.

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ProviderStatus {
  configured: boolean;
  baseUrlHost: string | null;
  model: string | null;
  source: string | null;
  checkedSources: string[];
}

const DISCOVERY_SOURCES = (): string[] => {
  const home = homedir();
  return [
    join(process.cwd(), ".env.local"),
    join(process.cwd(), ".dev.vars"),
    join(process.cwd(), ".env"),
    join(home, "user_key.txt"),
    join(home, "use_key.txt"),
  ];
};

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    }
  } catch {
    // ignore unreadable source
  }
  return out;
}

function pickModel(env: Record<string, string>): string | undefined {
  return (
    env.OPENAI_MODEL ||
    env.OPENAI_DEFAULT_MODEL ||
    env.OPENAI_MODEL_DEFAULT ||
    env.OPENAI_MODEL_REASONING ||
    undefined
  );
}

let cached: { config: ProviderConfig | null; source: string | null } | null = null;

function discover(): { config: ProviderConfig | null; source: string | null } {
  if (cached) return cached;

  // 1. process.env (Next loads .env.local automatically).
  const fromProcess: Record<string, string> = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "",
    OPENAI_MODEL: process.env.OPENAI_MODEL || "",
    OPENAI_DEFAULT_MODEL: process.env.OPENAI_DEFAULT_MODEL || "",
    OPENAI_MODEL_DEFAULT: process.env.OPENAI_MODEL_DEFAULT || "",
  };
  if (fromProcess.OPENAI_API_KEY && (fromProcess.OPENAI_BASE_URL || true)) {
    const model = pickModel(fromProcess);
    if (fromProcess.OPENAI_API_KEY && model) {
      cached = {
        config: {
          apiKey: fromProcess.OPENAI_API_KEY,
          baseUrl: fromProcess.OPENAI_BASE_URL || "https://api.openai.com/v1",
          model,
        },
        source: "process.env",
      };
      return cached;
    }
  }

  // 2. File-based discovery.
  for (const path of DISCOVERY_SOURCES()) {
    if (!existsSync(path)) continue;
    const env = parseEnvFile(path);
    const apiKey = env.OPENAI_API_KEY;
    const model = pickModel(env);
    if (apiKey && model) {
      cached = {
        config: {
          apiKey,
          baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
          model,
        },
        source: path.replace(homedir(), "~"),
      };
      return cached;
    }
  }

  cached = { config: null, source: null };
  return cached;
}

export function getProviderConfig(): ProviderConfig | null {
  return discover().config;
}

export function getProviderStatus(): ProviderStatus {
  const { config, source } = discover();
  let host: string | null = null;
  if (config) {
    try {
      host = new URL(config.baseUrl).host;
    } catch {
      host = config.baseUrl;
    }
  }
  return {
    configured: Boolean(config),
    baseUrlHost: host,
    model: config?.model ?? null,
    source,
    checkedSources: DISCOVERY_SOURCES().map((p) => p.replace(homedir(), "~")),
  };
}
