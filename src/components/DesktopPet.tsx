"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PetMood = "idle" | "running" | "needs_user" | "happy" | "worried";

type PetContext = {
  driftCount: number;
  taskCount: number;
  draftCount: number;
  ruleCount: number;
  repairCount: number;
};

interface DesktopPetProps {
  isRunning: boolean;
  threadState: string;
  lastRunStatus: "success" | "degraded" | "failed" | null;
  lastRunEndedAt: number;
  context: PetContext;
  onInteract: (mood: PetMood) => void;
}

const STORAGE_KEY = "chs.desktopPet.enabled";
const POSITION_KEY = "chs.desktopPet.position";
const COLLAPSED_KEY = "chs.desktopPet.collapsed";
const QUIET_UNTIL_KEY = "chs.desktopPet.quietUntil";

const PET_LINES: Record<PetMood, string[]> = {
  idle: [
    "我在旁边陪你核价。",
    "政策、价格、证据，我们一条条看。",
    "有拿不准的地方，我会先停下来问你。",
  ],
  running: [
    "正在核价，先把能自动跑的跑完。",
    "我在读上下文和政策事实。",
    "自动处理和人审边界，我会分清楚。",
  ],
  needs_user: [
    "需要你点一下哦。",
    "这里需要你拍板。",
    "这条我不硬判，等你确认。",
  ],
  happy: [
    "又清理了一批异常价，漂亮！",
    "这轮闭环了，漂亮。",
    "结果已留痕，可以放心回看。",
  ],
  worried: [
    "这次没全跑通，咱们一起看看。",
    "异常不丢证据，我们再看一眼。",
    "我把不确定性先稳稳留住了。",
  ],
};

export function DesktopPet({
  isRunning,
  threadState,
  lastRunStatus,
  lastRunEndedAt,
  context,
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
  const [flashMood, setFlashMood] = useState<"happy" | "worried" | null>(null);

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
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    return () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      if (clickTimer.current) clearTimeout(clickTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!lastRunEndedAt) return;
    const nextMood = lastRunStatus === "success" ? "happy" : "worried";
    setFlashMood(nextMood);
    say(contextLine(nextMood, context) ?? pick(PET_LINES[nextMood]), 3400);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMood(null), 4200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRunEndedAt]);

  const mood = useMemo<PetMood>(() => {
    if (flashMood) return flashMood;
    if (isRunning) return "running";
    if (threadState === "needs_user") return "needs_user";
    if (lastRunStatus === "failed" || lastRunStatus === "degraded") return "worried";
    if (context.driftCount > 0 || context.taskCount > 0) return "worried";
    return "idle";
  }, [context.driftCount, context.taskCount, flashMood, isRunning, lastRunStatus, threadState]);

  const statusLine = statusLabel(mood);
  const quiet = quietUntil > Date.now();

  useEffect(() => {
    if (!enabled || collapsed) return;

    if (mood === "running" || mood === "needs_user") {
      say(contextLine(mood, context) ?? pick(PET_LINES[mood]), mood === "running" ? 2600 : 3600);
      return;
    }

    if (mood !== "idle") return;
    const talkTimer = setInterval(() => {
      if (!quiet && Math.random() < 0.34) say(contextLine("idle", context) ?? pick(PET_LINES.idle), 3200);
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
  }, [collapsed, enabled, mood, context.driftCount, context.taskCount, context.ruleCount, quiet]);

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

  if (!mounted || !enabled) return null;

  return (
    <div
      ref={petRef}
      className={`desktop-pet mood-${mood}${dragging ? " dragging" : ""}${collapsed ? " collapsed" : ""}${reduceMotion ? " reduce-motion" : ""}`}
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
          onInteract(mood);
          say(contextLine(mood, context) ?? pick(PET_LINES[mood]), 3200);
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
      aria-label={`小序，当前状态：${statusLine}`}
      title="小序：可拖动，双击收起，右键安静一小时"
    >
      <div className="desktop-pet-bubble" data-visible={Boolean(bubble)}>
        <strong>小序</strong>
        <span>{bubble ?? "我在旁边陪你核价。"}</span>
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

function contextLine(mood: PetMood, context: PetContext) {
  if (mood === "running") {
    const total = context.driftCount + context.taskCount + context.ruleCount + context.repairCount;
    return total > 0 ? `我在整理 ${total} 个业务对象，先把能自动跑的跑完。` : null;
  }
  if (mood === "needs_user") {
    if (context.taskCount > 0) return `有 ${context.taskCount} 个待人审任务，需要你点一下哦。`;
    if (context.ruleCount > 0) return `有 ${context.ruleCount} 条规则候选，等你确认边界。`;
    return "这里需要你点一下哦。";
  }
  if (mood === "happy") {
    if (context.draftCount > 0) return `又清理了一批异常价，生成了 ${context.draftCount} 张建议卡。`;
    return "又清理了一批异常价，漂亮！";
  }
  if (mood === "worried") {
    if (context.driftCount > 0) return `这次没全跑通，我把 ${context.driftCount} 条漂移先留住了。`;
    if (context.taskCount > 0) return `还有 ${context.taskCount} 个任务要你复核，咱们一起看看。`;
    return "这次没全跑通，咱们一起看看。";
  }
  if (context.driftCount > 0) return `我在旁边守着，${context.driftCount} 条漂移我们慢慢核。`;
  return null;
}

function statusLabel(mood: PetMood) {
  if (mood === "running") return "正在核价";
  if (mood === "needs_user") return "等你判断";
  if (mood === "happy") return "已闭环";
  if (mood === "worried") return "需复核";
  return "在岗";
}

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
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
