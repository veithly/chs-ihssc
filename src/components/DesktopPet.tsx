"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PetMood = "idle" | "running" | "needs_user" | "happy" | "worried";

export type PetWorkState =
  | "global_idle"
  | "source_empty"
  | "source_ready"
  | "running"
  | "mapping_done"
  | "repair_ready"
  | "policy_checking"
  | "drift_detected"
  | "needs_human_review"
  | "rule_candidate_ready"
  | "degraded"
  | "failed"
  | "archived_ready";

export type PetContext = {
  driftCount: number;
  taskCount: number;
  draftCount: number;
  ruleCount: number;
  repairCount: number;
};

export type PetWorkStateDetail = {
  state: PetWorkState;
  context?: Partial<PetContext>;
  href?: string;
};

type PetConfig = {
  mood: PetMood;
  label: string;
  line: string;
};

interface DesktopPetProps {
  initialState?: PetWorkState;
  context?: Partial<PetContext>;
  href?: string;
  onInteract?: (state: PetWorkState, mood: PetMood) => void;
}

const STORAGE_KEY = "chs.desktopPet.enabled";
const POSITION_KEY = "chs.desktopPet.position";
const COLLAPSED_KEY = "chs.desktopPet.collapsed";
const QUIET_UNTIL_KEY = "chs.desktopPet.quietUntil";
const EVENT_NAME = "chs:desktop-pet-state";

const DEFAULT_CONTEXT: PetContext = {
  driftCount: 0,
  taskCount: 0,
  draftCount: 0,
  ruleCount: 0,
  repairCount: 0,
};

const AUTO_ANNOUNCE_STATES = new Set<PetWorkState>([
  "running",
  "repair_ready",
  "drift_detected",
  "needs_human_review",
  "rule_candidate_ready",
  "degraded",
  "failed",
  "archived_ready",
]);

const STATE_CONFIG: Record<PetWorkState, PetConfig> = {
  global_idle: {
    mood: "idle",
    label: "小序在岗",
    line: "我在旁边，等你开始核价。",
  },
  source_empty: {
    mood: "idle",
    label: "等待数据",
    line: "先接入一批机构执行价，我再陪你核。",
  },
  source_ready: {
    mood: "idle",
    label: "数据已接入",
    line: "数据已接入，可以开始核查。",
  },
  running: {
    mood: "running",
    label: "正在核查",
    line: "我在核政策、价格和证据，先别急着下结论。",
  },
  mapping_done: {
    mood: "running",
    label: "字段映射",
    line: "字段和口径正在对齐。",
  },
  repair_ready: {
    mood: "happy",
    label: "数据修正",
    line: "能确定的数据修正已经整理出来。",
  },
  policy_checking: {
    mood: "running",
    label: "政策核验",
    line: "正在对照最新政策依据。",
  },
  drift_detected: {
    mood: "worried",
    label: "发现漂移",
    line: "发现政策漂移，需要复核执行价。",
  },
  needs_human_review: {
    mood: "needs_user",
    label: "等待人审",
    line: "这里需要你点一下哦。",
  },
  rule_candidate_ready: {
    mood: "needs_user",
    label: "规则候选",
    line: "有可复用规则候选，等你确认边界。",
  },
  degraded: {
    mood: "worried",
    label: "降级保留",
    line: "模型服务不稳，但确定性结果已保留。",
  },
  failed: {
    mood: "worried",
    label: "核查失败",
    line: "这次没全跑通，咱们一起看看。",
  },
  archived_ready: {
    mood: "happy",
    label: "可归档",
    line: "结果已留痕，可以放心回放。",
  },
};

export function DesktopPet({
  initialState = "global_idle",
  context,
  href = "/workspace",
  onInteract,
}: DesktopPetProps) {
  const [mounted, setMounted] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [quietUntil, setQuietUntil] = useState(0);
  const [pos, setPos] = useState({ x: 92, y: 80 });
  const [dragging, setDragging] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [blink, setBlink] = useState(false);
  const [detail, setDetail] = useState<PetWorkStateDetail>({
    state: initialState,
    context,
    href,
  });

  const petRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    petX: number;
    petY: number;
    finalPct: { x: number; y: number };
  } | null>(null);
  const movedRef = useRef(false);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announcedStateRef = useRef<PetWorkState | null>(null);

  const fullContext = { ...DEFAULT_CONTEXT, ...context, ...detail.context };
  const config = STATE_CONFIG[detail.state] ?? STATE_CONFIG.global_idle;
  const mood = config.mood;
  const quiet = quietUntil > Date.now();

  useEffect(() => {
    setMounted(true);
    try {
      setEnabled(localStorage.getItem(STORAGE_KEY) !== "false");
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "true");
      setQuietUntil(Number(localStorage.getItem(QUIET_UNTIL_KEY) ?? 0));
      const storedPosition = localStorage.getItem(POSITION_KEY);
      if (storedPosition) {
        const parsed = JSON.parse(storedPosition) as { x?: number; y?: number };
        if (isValidPosition(parsed)) setPos(parsed);
      }
    } catch {
      /* localStorage may be unavailable. */
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) setEnabled(event.newValue !== "false");
    }
    function handleState(event: Event) {
      const next = (event as CustomEvent<PetWorkStateDetail>).detail;
      if (!next?.state) return;
      setDetail((current) => ({
        state: next.state,
        context: next.context ?? current.context,
        href: next.href ?? current.href,
      }));
    }
    window.addEventListener("storage", handleStorage);
    window.addEventListener(EVENT_NAME, handleState);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(EVENT_NAME, handleState);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!enabled || collapsed || quiet) return;
    if (announcedStateRef.current === detail.state) return;
    announcedStateRef.current = detail.state;
    if (!AUTO_ANNOUNCE_STATES.has(detail.state)) return;
    say(contextLine(detail.state, fullContext) ?? config.line, mood === "running" ? 2400 : 3200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.state, quiet]);

  useEffect(() => {
    if (!enabled || collapsed || mood !== "idle") return;
    const talkTimer = setInterval(() => {
      if (!quiet && Math.random() < 0.32) say(contextLine(detail.state, fullContext) ?? config.line, 3200);
    }, 42000);
    const blinkTimer = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 160);
    }, 5200);
    return () => {
      clearInterval(talkTimer);
      clearInterval(blinkTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, enabled, mood, quiet, detail.state]);

  function say(line: string, ms = 3000) {
    if (quiet && mood === "idle") return;
    setBubble(line);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), ms);
  }

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSED_KEY, String(next));
      } catch {
        /* no-op */
      }
      return next;
    });
  }

  function snooze() {
    const next = Date.now() + 60 * 60 * 1000;
    setQuietUntil(next);
    say("我先安静一小时。", 2400);
    try {
      localStorage.setItem(QUIET_UNTIL_KEY, String(next));
    } catch {
      /* no-op */
    }
  }

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const el = petRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      petX: rect.left + rect.width / 2,
      petY: rect.top + rect.height / 2,
      finalPct: pos,
    };
    movedRef.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const state = dragState.current;
    if (!state) return;
    const next = {
      x: clamp(((state.petX + event.clientX - state.startX) / window.innerWidth) * 100, 6, 96),
      y: clamp(((state.petY + event.clientY - state.startY) / window.innerHeight) * 100, 8, 94),
    };
    if (Math.abs(event.clientX - state.startX) > 4 || Math.abs(event.clientY - state.startY) > 4) {
      movedRef.current = true;
    }
    state.finalPct = next;
    setPos(next);
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    const state = dragState.current;
    if (!state) return;
    dragState.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
      localStorage.setItem(POSITION_KEY, JSON.stringify(state.finalPct));
    } catch {
      /* no-op */
    }
  }, []);

  function activate() {
    onInteract?.(detail.state, mood);
    window.dispatchEvent(new CustomEvent("chs:desktop-pet-action", { detail: { state: detail.state, mood } }));
    if (!onInteract && detail.href && window.location.pathname !== detail.href) window.location.href = detail.href;
    say(contextLine(detail.state, fullContext) ?? config.line, 3200);
  }

  if (!mounted || !enabled) return null;

  return (
    <div
      ref={petRef}
      className={`desktop-pet mood-${mood} work-${detail.state}${dragging ? " dragging" : ""}${collapsed ? " collapsed" : ""}${reduceMotion ? " reduce-motion" : ""}`}
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      onClick={() => {
        if (movedRef.current) {
          movedRef.current = false;
          return;
        }
        if (clickTimer.current) clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(() => {
          if (collapsed) {
            toggleCollapsed();
            return;
          }
          activate();
        }, 120);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        if (clickTimer.current) clearTimeout(clickTimer.current);
        toggleCollapsed();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        snooze();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
      aria-label={`小序，当前状态：${config.label}`}
      title="小序：可拖动，双击收起，右键安静一小时"
    >
      <div className="desktop-pet-bubble" data-visible={Boolean(bubble)}>
        <strong>小序 · {config.label}</strong>
        <span>{bubble ?? config.line}</span>
      </div>

      <div className="desktop-pet-sprite" aria-hidden>
        <img className="desktop-pet-img" src="/brand/xiaoxu.png" alt="" draggable={false} />
        <span className="desktop-pet-status-dot" />
        {mood === "running" && <span className="desktop-pet-spinner"><span /></span>}
        {mood === "needs_user" && <span className="desktop-pet-question">?</span>}
        {mood === "happy" && (
          <>
            <span className="desktop-pet-spark spark-a" />
            <span className="desktop-pet-spark spark-b" />
            <span className="desktop-pet-spark spark-c" />
          </>
        )}
        {mood === "worried" && (
          <>
            <span className="desktop-pet-sweat sweat-a" />
            <span className="desktop-pet-sweat sweat-b" />
          </>
        )}
        {blink && mood === "idle" && <span className="desktop-pet-blink" />}
      </div>

      <button
        type="button"
        className="desktop-pet-mini"
        aria-label="展开小序"
        onClick={(event) => {
          event.stopPropagation();
          toggleCollapsed();
        }}
      >
        <span />
      </button>
    </div>
  );
}

export function publishDesktopPetState(detail: PetWorkStateDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

function contextLine(state: PetWorkState, context: PetContext) {
  if (state === "running") {
    const total = context.driftCount + context.taskCount + context.ruleCount + context.repairCount;
    return total > 0 ? `我在整理 ${total} 个业务对象，先把能自动跑的跑完。` : null;
  }
  if (state === "drift_detected" && context.driftCount > 0) {
    return `发现 ${context.driftCount} 条漂移，需要复核执行价。`;
  }
  if (state === "needs_human_review" && context.taskCount > 0) {
    return `有 ${context.taskCount} 个待人审任务，需要你点一下哦。`;
  }
  if (state === "rule_candidate_ready" && context.ruleCount > 0) {
    return `有 ${context.ruleCount} 条规则候选，等你确认边界。`;
  }
  if (state === "repair_ready" && context.repairCount > 0) {
    return `整理出 ${context.repairCount} 个数据修正对象。`;
  }
  if (state === "archived_ready" && context.draftCount > 0) {
    return `生成了 ${context.draftCount} 张处置建议卡，可以回放归档。`;
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isValidPosition(value: { x?: number; y?: number }): value is { x: number; y: number } {
  return (
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    value.x >= 0 &&
    value.x <= 100 &&
    value.y >= 0 &&
    value.y <= 100
  );
}
