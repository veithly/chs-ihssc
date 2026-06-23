import "server-only";
import { getProviderConfig } from "./env";
import type { AgentPlan } from "./types";

export interface ProviderMeta {
  model: string;
  baseUrlHost: string;
  latency_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  finish_reason?: string;
}

export type PlanResult =
  | { ok: true; plan: AgentPlan; meta: ProviderMeta; raw: string }
  | { ok: false; category: string; message: string; meta?: Partial<ProviderMeta> };

const TOOL_CATALOG = `
可用工具（server-side 确定性执行）：
- schema_mapper: 校验行字段是否符合发布 schema。
- code_dictionary_validator: 校验 catalog_code 是否命中医保目录字典当前版本，并查找高置信纠错别名。
- tokenized_identity_matcher: 校验 person_token 是否唯一命中脱敏身份注册表，识别模糊匹配。
- access_policy_evaluator: 校验 requester_role + purpose 是否满足该批次访问策略。
- anomaly_profiler: 识别日期等异常（如服务日期晚于发布日）。
- correction_writer: 写入高置信纠错提案 correction_proposal。
- quarantine_writer: 写入隔离项 quarantine_item。
- approval_router: 写入待人工审批的 release_approval。
- replay_builder: 组装可回放时间线。
`;

const SYSTEM_PROMPT = `你是"医保可信数据通行 Agent"的规划器，服务于医保数据中心 / 可信数据空间运营人员。
你的职责：观察一个待发布数据集（dataset release）中被选中的一行脱敏医保数据，判断主要风险，并规划要调用哪些工具、按什么顺序、预计把该批次发布推进到哪个状态。

发布状态词（只能用这些）：待发布 / 纠错候选 / 隔离 / 可发布 / 需审批 / 检查失败。

安全边界（必须遵守）：
- 编码无法命中目录字典且没有高置信纠错别名时，应隔离，不可放行。
- 服务日期晚于发布日属于时序异常，应隔离。
- 身份模糊匹配、访问策略越权属于不确定/高风险，必须进入需审批，绝不可自动放行。
- 你只做规划与说明；最终状态由确定性工具校验结果与安全规则共同决定。

${TOOL_CATALOG}

只返回一个 JSON 对象，不要任何额外文字、解释或代码块围栏。JSON 字段：
{
  "issue_focus": "code_dictionary | date_anomaly | identity | access_policy | schema | none 之一",
  "ordered_tools": ["从可用工具名中选择，按调用顺序排列，至少 3 个"],
  "rationale": "一句中文，说明你为什么这样规划（面向运营人员）",
  "expected_state": "纠错候选 | 隔离 | 可发布 | 需审批 之一"
}`;

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function generateAgentPlan(
  observation: Record<string, unknown>,
): Promise<PlanResult> {
  const config = getProviderConfig();
  if (!config) {
    return {
      ok: false,
      category: "missing_credentials",
      message:
        "未发现可用的 provider 凭证（已检查 .env.local / .dev.vars / .env / ~/user_key.txt / ~/use_key.txt）。",
    };
  }

  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let host = config.baseUrl;
  try {
    host = new URL(config.baseUrl).host;
  } catch {
    /* keep raw */
  }

  const body = {
    model: config.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "请基于以下观察结果给出通行检查规划（只返回 JSON）：\n" +
          JSON.stringify(observation, null, 2),
      },
    ],
    response_format: { type: "json_object" as const },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latency = Date.now() - started;

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        category: res.status === 401 ? "auth_failed" : "provider_http_error",
        message: `Provider 返回 ${res.status}: ${errText.slice(0, 200)}`,
        meta: { model: config.model, baseUrlHost: host, latency_ms: latency },
      };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content);
    if (!parsed) {
      return {
        ok: false,
        category: "unparseable_plan",
        message: "Provider 返回内容无法解析为 JSON plan。",
        meta: { model: config.model, baseUrlHost: host, latency_ms: latency },
      };
    }

    const orderedRaw = Array.isArray(parsed.ordered_tools)
      ? (parsed.ordered_tools as unknown[]).map(String)
      : [];

    const plan: AgentPlan = {
      issue_focus: String(parsed.issue_focus ?? "none"),
      ordered_tools: orderedRaw,
      rationale: String(parsed.rationale ?? "").slice(0, 400),
      expected_state: String(parsed.expected_state ?? ""),
      source: "live-provider",
    };

    const meta: ProviderMeta = {
      model: config.model,
      baseUrlHost: host,
      latency_ms: latency,
      prompt_tokens: data.usage?.prompt_tokens,
      completion_tokens: data.usage?.completion_tokens,
      finish_reason: data.choices?.[0]?.finish_reason,
    };

    return { ok: true, plan, meta, raw: content };
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      category: aborted ? "provider_timeout" : "provider_unreachable",
      message: aborted
        ? "Provider 调用超时（45s）。"
        : `Provider 调用失败：${err instanceof Error ? err.message : String(err)}`,
      meta: { model: config.model, baseUrlHost: host },
    };
  } finally {
    clearTimeout(timeout);
  }
}
