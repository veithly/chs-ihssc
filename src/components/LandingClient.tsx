"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  LightningBoltIcon,
  PaperPlaneIcon,
  LoopIcon,
  TargetIcon,
} from "@radix-ui/react-icons";
import type { LandingSnapshot } from "@/lib/workspace/landingSnapshot";
import type { ProviderStatus } from "@/lib/env";

const PROMPTS: { key: string; label: string; text: string }[] = [
  {
    key: "repair_price_batch",
    label: "核完并修复这批价格数据",
    text: "请核完并修复这批价格数据。能确定的字段和单位先修复；拿不准的问我；可以处置的生成机构核实口径和流程任务。",
  },
  {
    key: "collective_landing",
    label: "找出集采落地差异并生成催办口径",
    text: "请找出集采落地差异，并生成需要催办的机构口径和内部流程任务。",
  },
  {
    key: "match_first",
    label: "把同品同规先归并，拿不准的问我",
    text: "请先把同品同规归并。高置信的直接建组，拿不准的只提出确认问题。",
  },
  {
    key: "parse_replies",
    label: "解析机构回函，更新昨日续办",
    text: "请解析机构回函，提取价格、原因、承诺时间和缺失材料，并更新昨日续办任务。",
  },
  {
    key: "data_governance",
    label: "生成需要发起的数据治理确认",
    text: "请生成需要发起的数据治理确认。缺字段、缺包装单位和编码不稳的项先不要催医院。",
  },
];

const LADDER: { phase: string; title: string; chip: string; detail: string }[] = [
  {
    phase: "observe",
    title: "读上下文",
    chip: "table_parser · source_connector",
    detail: "上传 CSV 或连接演示数据源；读取字段、行、回函和昨日未完。",
  },
  {
    phase: "plan",
    title: "排计划",
    chip: "planner",
    detail: "选择核价 / 标化 / 修复 / 催办 / 流程发起路径；高置信先做，拿不准先问。",
  },
  {
    phase: "tools",
    title: "跑工具",
    chip: "field_mapper · repair_writer · matcher · converter · rule_evaluator",
    detail: "字段映射、单位换算、同品归并、价格对齐、规则评估，结果都是结构化对象。",
  },
  {
    phase: "mutate",
    title: "写状态",
    chip: "writer · draft_generator · workflow_router",
    detail: "修复 patch、归并组、价格口径、处置篮、机构草稿、流程任务写入 SQLite。",
  },
  {
    phase: "verify",
    title: "复查 + 追问",
    chip: "verifier · recover",
    detail: "数量与算术可复算；缺字段或口径不清转人工确认，不假成功。",
  },
];

const PRODUCT_LOOP: { label: string; into: string }[] = [
  { label: "上传/连接", into: "uploaded_dataset · data_source_connection" },
  { label: "字段映射", into: "field_mapping" },
  { label: "修复 patch", into: "repair_patch" },
  { label: "同品归并", into: "match_group" },
  { label: "价格口径", into: "price_basis_pack · unit_conversion" },
  { label: "处置篮", into: "disposition_item" },
  { label: "机构草稿", into: "institution_draft" },
  { label: "流程任务", into: "workflow_task" },
];

interface LandingClientProps {
  initial: LandingSnapshot;
  providerStatus: ProviderStatus;
}

function useCountUp(target: number, active: boolean, duration = 1100) {
  // SSR + first paint shows the real target value (no flash of 0). Once the
  // tile scrolls into view (active), the count-up animation runs 0 → target.
  const [value, setValue] = useState(target);
  const ref = useRef<number | null>(null);
  useEffect(() => {
    if (!active || target === 0) {
      setValue(target);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      return;
    }
    setValue(0);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) ref.current = requestAnimationFrame(tick);
    };
    ref.current = requestAnimationFrame(tick);
    return () => {
      if (ref.current) cancelAnimationFrame(ref.current);
    };
  }, [target, active, duration]);
  return value;
}

function useInView<T extends Element>(opts?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!ref.current || inView) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      });
    }, opts ?? { threshold: 0.4 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [inView, opts]);
  return { ref, inView };
}

export function LandingClient({ initial, providerStatus }: LandingClientProps) {
  const router = useRouter();
  const { snapshot, stats, latestRunId } = initial;
  const [now, setNow] = useState<string>("");
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const update = () => {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      setNow(`${hh}:${mm}:${ss}`);
    };
    update();
    const id = setInterval(() => {
      update();
      setFrame((f) => (f + 1) % 100000);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  function sendPrompt(prompt: { key: string; text: string }) {
    const params = new URLSearchParams({ prompt: prompt.key, text: prompt.text });
    router.push(`/workspace?${params.toString()}`);
  }

  const statsRow = useMemo(() => {
    return [
      { label: "字段映射", value: stats.fieldMappings, hint: "field_mapping" },
      { label: "修复 patch", value: stats.repairPatches, hint: "repair_patch" },
      { label: "同品归并", value: stats.matchGroups, hint: "match_group" },
      { label: "流程任务", value: stats.workflowTasks, hint: "workflow_task" },
      { label: "机构草稿", value: stats.institutionDrafts, hint: "institution_draft" },
    ];
  }, [stats]);

  return (
    <main className="landing-shell" data-visual-lane="regulated-public-service-conversation-workbench">
      <SystemStrip
        providerStatus={providerStatus}
        threadId={snapshot.thread?.id ?? null}
        runId={latestRunId}
        rowsScanned={stats.rowsScanned}
        now={now}
        frame={frame}
      />

      <section className="landing-hero" data-landing-hero>
        <div className="landing-hero-grid">
          <div className="landing-hero-text">
            <div className="agent-eyebrow">
              <span className="mono">价序 · JIA XU</span>
            </div>
            <h1>
              把表格或数据源交给<span className="landing-mark">价序</span>，
              <br />
              直接说你要完成的价格治理工作。
            </h1>
            <p className="landing-lead">
              它会读字段、归并同品、换算单位、对齐价格、筛掉假异常，
              把可以处置的项写成机构核实草稿和流程任务，所有状态写入 SQLite，
              可回放、可追问、可退回人工确认。
            </p>
            <div className="landing-cta-row">
              <Link href="/workspace" className="landing-cta primary" data-cta-primary>
                打开工作台 <ArrowRightIcon />
              </Link>
              <Link href="/queue" className="landing-cta ghost">
                看核验队列
              </Link>
            </div>
            <div className="landing-meta-row mono">
              <span>agent · v0.1</span>
              <span className="pane-sub-sep" aria-hidden />
              <span>{providerStatus.configured ? providerStatus.model : "provider 未配置"}</span>
              <span className="pane-sub-sep" aria-hidden />
              <span>SQLite · 合成/脱敏</span>
            </div>
          </div>

          <LiveWorkspaceCard
            stats={statsRow}
            hasLiveRun={stats.hasLiveRun}
            rowsScanned={stats.rowsScanned}
            runId={latestRunId}
            threadId={snapshot.thread?.id ?? null}
            frame={frame}
          />
        </div>

        <div className="prompt-rail-landing" aria-label="内置业务 prompt" data-prompt-rail>
          <span className="prompt-rail-label mono">
            <LightningBoltIcon /> PROMPTS · 点一个直接进工作台
          </span>
          {PROMPTS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="prompt-chip-landing"
              data-prompt-chip
              data-prompt-key={p.key}
              onClick={() => sendPrompt(p)}
            >
              <span>{p.label}</span>
              <ArrowRightIcon />
            </button>
          ))}
        </div>
      </section>

      <ContentLadderSection />

      <ProductLoopSection loop={PRODUCT_LOOP} />

      <ProofSection providerStatus={providerStatus} />

      <LandingFooter />
    </main>
  );
}

function SystemStrip({
  providerStatus,
  threadId,
  runId,
  rowsScanned,
  now,
  frame,
}: {
  providerStatus: ProviderStatus;
  threadId: string | null;
  runId: string | null;
  rowsScanned: number;
  now: string;
  frame: number;
}) {
  return (
    <div className="system-strip mono" data-system-strip aria-hidden={false}>
      <span className="system-strip-cell">
        <span className="system-strip-label">SYS</span>
        <span>价序 · price-governance agent</span>
      </span>
      <span className="system-strip-cell">
        <span className="system-strip-label">PROVIDER</span>
        <span className={providerStatus.configured ? "ok" : "warn"}>
          <span className="status-dot" aria-hidden />
          {providerStatus.configured ? providerStatus.baseUrlHost : "未配置"}
        </span>
      </span>
      <span className="system-strip-cell">
        <span className="system-strip-label">THREAD</span>
        <span>{threadId ? threadId.slice(0, 18) : "—"}</span>
      </span>
      <span className="system-strip-cell">
        <span className="system-strip-label">RUN</span>
        <span>{runId ? runId.slice(0, 18) : "idle"}</span>
      </span>
      <span className="system-strip-cell">
        <span className="system-strip-label">ROWS</span>
        <span>{rowsScanned}</span>
      </span>
      <span className="system-strip-cell system-strip-clock">
        <span className="system-strip-label">CLOCK</span>
        <span>{now || "--:--:--"}</span>
      </span>
      <span className="system-strip-cell system-strip-frame">
        <span className="system-strip-label">FRAME</span>
        <span>{String(frame).padStart(5, "0")}</span>
      </span>
    </div>
  );
}

function LiveWorkspaceCard({
  stats,
  hasLiveRun,
  rowsScanned,
  runId,
  threadId,
  frame,
}: {
  stats: { label: string; value: number; hint: string }[];
  hasLiveRun: boolean;
  rowsScanned: number;
  runId: string | null;
  threadId: string | null;
  frame: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <aside className="live-workspace-card" data-live-workspace ref={ref}>
      <div className="lwc-head">
        <div>
          <div className="lwc-title">
            <span className="agent-mark" aria-hidden>价</span>
            <strong>最近一次 agent run</strong>
          </div>
          <div className="lwc-sub mono">
            <span>{threadId ? threadId.slice(0, 18) : "—"}</span>
            <span className="pane-sub-sep" aria-hidden />
            <span>{runId ? runId.slice(0, 18) : "idle"}</span>
          </div>
        </div>
        <span className={`lwc-state ${hasLiveRun ? "ok" : "idle"}`}>
          <span className="status-dot" aria-hidden />
          {hasLiveRun ? "ready" : "idle"}
        </span>
      </div>

      <div className="lwc-stats" data-lwc-stats>
        {stats.map((s) => (
          <StatTile key={s.hint} label={s.label} value={s.value} hint={s.hint} active={inView} />
        ))}
      </div>

      <div className="lwc-foot mono">
        <span>
          <CheckCircledIcon /> 处置 {stats[3].value + stats[4].value} 项 · 行 {rowsScanned}
        </span>
        <span className="lwc-frame">FRAME {String(frame).padStart(5, "0")}</span>
      </div>

      <div className="lwc-cta">
        <Link href="/workspace" className="lwc-open" data-cta-open>
          打开 /workspace <ArrowRightIcon />
        </Link>
      </div>
    </aside>
  );
}

function StatTile({
  label,
  value,
  hint,
  active,
}: {
  label: string;
  value: number;
  hint: string;
  active: boolean;
}) {
  const v = useCountUp(value, active);
  return (
    <div className="stat-tile" data-stat-tile={hint}>
      <div className="stat-tile-value mono" data-stat-target={value}>{v}</div>
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-hint mono">{hint}</div>
    </div>
  );
}

function ContentLadderSection() {
  return (
    <section className="landing-section landing-ladder" data-landing-section="ladder">
      <header className="landing-section-head">
        <div className="agent-eyebrow">
          <span className="mono">AGENT LOOP · 智能体怎么工作</span>
        </div>
        <h2>不是固定按钮，是会读、会规划、会修、会发起流程的工作台。</h2>
        <p className="landing-section-lead">
          价序每跑一次任务，都会走完五步。每一步都把状态写到 SQLite，
          评委可以从回放里看到它当时为什么这么做。
        </p>
      </header>
      <ol className="content-ladder" data-content-ladder>
        {LADDER.map((r, i) => (
          <li key={r.phase} className="ladder-rung" data-ladder-rung={r.phase}>
            <span className="ladder-num mono">{String(i + 1).padStart(2, "0")}</span>
            <div className="ladder-body">
              <strong>{r.title}</strong>
              <span>{r.detail}</span>
            </div>
            <span className="ladder-chip mono">{r.chip}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ProductLoopSection({ loop }: { loop: { label: string; into: string }[] }) {
  return (
    <section className="landing-section landing-loop" data-landing-section="loop">
      <header className="landing-section-head">
        <div className="agent-eyebrow">
          <span className="mono">PRODUCT LOOP · 状态怎么落库</span>
        </div>
        <h2>从一张表到一批可审批对象，全在 SQLite 里。</h2>
        <p className="landing-section-lead">
          评委改一个输入，下面每一格都会变。回放能查到每一行是怎么从原始字段走到流程任务的。
        </p>
      </header>
      <ol className="loop-track" data-loop-track>
        {loop.map((node, i) => (
          <li key={node.into} className="loop-node" data-loop-node={node.into}>
            <span className="loop-node-num mono">{String(i + 1).padStart(2, "0")}</span>
            <strong>{node.label}</strong>
            <span className="loop-node-into mono">{node.into}</span>
            {i < loop.length - 1 && <span className="loop-arrow" aria-hidden />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ProofSection({
  providerStatus,
}: {
  providerStatus: ProviderStatus;
}) {
  const proofs = [
    { k: "real_provider", label: "真实模型 provider", value: providerStatus.configured ? providerStatus.model : "未配置" },
    { k: "durable", label: "状态写入", value: "SQLite · node:sqlite" },
    { k: "replay", label: "回放可查", value: "run_event · conversation_message" },
    { k: "recover", label: "失败不假成功", value: "auth_failed · recover → 人工确认" },
    { k: "data", label: "数据", value: "合成/脱敏 · 演示数据源" },
  ];
  return (
    <section className="landing-section landing-proof" data-landing-section="proof">
      <header className="landing-section-head">
        <div className="agent-eyebrow ok">
          <span className="status-dot" aria-hidden />
          <span className="mono">PROOF · 评委可复跑</span>
        </div>
        <h2>从 /workspace 复跑：选数据源、点 prompt、看结果。</h2>
        <p className="landing-section-lead">
          以下事实可现场验证。坏 key 会返回 auth_failed，不会生成假线索；
          拿不准的字段会转人工确认，不会硬写。
        </p>
      </header>
      <ol className="proof-list" data-proof-list>
        {proofs.map((p) => (
          <li key={p.k} className="proof-row" data-proof-row={p.k}>
            <span className="proof-label">{p.label}</span>
            <span className="proof-value mono">{p.value}</span>
            <CheckCircledIcon className="proof-check" />
          </li>
        ))}
      </ol>
      <div className="proof-cta-row">
        <Link href="/workspace" className="landing-cta primary" data-cta-proof>
          <TargetIcon /> 进 /workspace 复跑
        </Link>
        <Link href="/settings" className="landing-cta ghost">
          查看 provider 设置
        </Link>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer" data-landing-footer>
      <div className="landing-footer-inner">
        <div className="landing-footer-brand">
          <span className="agent-mark" aria-hidden>价</span>
          <div>
            <strong>价序</strong>
            <span className="mono">agent · v0.1 · 医药价格治理工作台</span>
          </div>
        </div>
        <div className="landing-footer-meta mono">
          <span>2026 全国智慧医保大赛</span>
          <span className="pane-sub-sep" aria-hidden />
          <span>合成/脱敏演示数据</span>
          <span className="pane-sub-sep" aria-hidden />
          <span>SQLite · node:sqlite</span>
        </div>
        <div className="landing-footer-cta">
          <Link href="/workspace" className="landing-cta primary small" data-cta-footer>
            打开工作台 <ArrowRightIcon />
          </Link>
        </div>
      </div>
    </footer>
  );
}
