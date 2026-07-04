"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  LightningBoltIcon,
  TargetIcon,
} from "@radix-ui/react-icons";
import type { LandingSnapshot } from "@/lib/workspace/landingSnapshot";
import type { ProviderStatus } from "@/lib/env";

const PROMPTS: { key: string; label: string; text: string; hero?: boolean }[] = [
  {
    key: "drift_review_loop",
    label: "按最新政策核对执行价并出处置提案",
    text: "请对照最新政策事实（集采中选价、参考价、最高有效价）核对这批机构执行价：检出政策漂移并生成复核任务；高置信数据问题直接自动修复回写；命中已激活规则的自动处置；其余出可编辑提案卡等我确认。",
    hero: true,
  },
  {
    key: "repair_price_batch",
    label: "核完并修复这批价格数据",
    text: "请核完并修复这批价格数据。能确定的字段、编码和单位直接自动修复回写；拿不准的出提案卡等我确认；可以处置的生成机构核实口径和流程任务。",
  },
  {
    key: "collective_landing",
    label: "找出集采落地差异并生成催办口径",
    text: "请找出集采落地差异，并生成需要催办的机构口径和内部流程任务。",
  },
  {
    key: "data_governance",
    label: "生成需要发起的数据治理确认",
    text: "请生成需要发起的数据治理确认。缺字段、缺包装单位和编码不稳的项先不要催医院。",
  },
];

const LADDER: { phase: string; title: string; chip: string; detail: string; pain?: string }[] = [
  {
    phase: "observe",
    title: "读上下文",
    chip: "表格补录 · 来源接入",
    detail: "补充表格或连接演示来源；读取字段、明细、政策依据与昨日未完事项。",
  },
  {
    phase: "plan",
    title: "排计划",
    chip: "排查顺序",
    detail: "选择核价 / 修复 / 漂移复核 / 催办路径；高置信先做，拿不准先问。",
  },
  {
    phase: "tools",
    title: "核明细",
    chip: "逐项核对",
    detail: "字段对应、单位换算、同品归并、价格对齐，结果都可复核。",
  },
  {
    phase: "mutate",
    title: "写状态",
    chip: "处置留痕",
    detail: "数据修正、漂移记录、复核任务、机构草稿全部留痕保存。",
  },
  {
    phase: "drift",
    title: "盯政策",
    chip: "政策依据 · 风险记录",
    detail: "对照政策事实基线复核每一条执行价；政策一变，昨天合规的今天自动标红。",
    pain: "政策跟不住",
  },
  {
    phase: "learn",
    title: "学人审",
    chip: "人工结论 · 待审规则",
    detail: "人审结论按（问题类型 × 严重度 × 处置动作）聚合成规则候选，激活后同类自动处置。",
    pain: "规则负担重",
  },
  {
    phase: "verify",
    title: "复查 + 留痕",
    chip: "复核 · 护栏",
    detail: "数量与算术可复算；敏感项永远人审；每一次自动/人审决策都进决策日志。",
  },
];

const PRODUCT_LOOP: { label: string; into: string }[] = [
  { label: "政策依据", into: "公告来源 · 版本依据" },
  { label: "上传/连接", into: "本批数据 · 来源记录" },
  { label: "字段对应", into: "表头口径 · 标准字段" },
  { label: "数据修正", into: "修正前后 · 待确认项" },
  { label: "风险记录", into: "政策变化 · 执行价差异" },
  { label: "复核任务", into: "责任岗 · 办理状态" },
  { label: "决策留痕", into: "人工确认 · 自动处置" },
  { label: "待审规则", into: "同类经验 · 人工激活" },
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

  function sendPrompt(prompt: { key: string; text: string }) {
    const params = new URLSearchParams({ prompt: prompt.key, text: prompt.text });
    router.push(`/workspace?${params.toString()}`);
  }

  const statsRow = useMemo(() => {
    return [
      { label: "字段对应", value: stats.fieldMappings, hint: "表头已对应" },
      { label: "数据修正", value: stats.repairPatches, hint: "修正待确认" },
      { label: "同品归并", value: stats.matchGroups, hint: "同品已归并" },
      { label: "流程任务", value: stats.workflowTasks, hint: "待办已生成" },
      { label: "机构口径", value: stats.institutionDrafts, hint: "可发起核实" },
    ];
  }, [stats]);

  return (
    <main className="landing-shell" data-visual-lane="regulated-public-service-conversation-workbench">
      <section className="landing-hero" data-landing-hero>
        <div className="landing-hero-grid">
          <div className="landing-hero-text">
            <div className="landing-brand-lockup" aria-label="价序">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="landing-brand-logo" src="/brand/logomark.svg" alt="" aria-hidden />
              <div>
                <strong>价序</strong>
                <span>医保医药价格复核工作台</span>
              </div>
            </div>
            <h1>
              政策变了，存量执行价要<span className="landing-mark">重新复核</span>。
              <br />
              价序把风险项推到下一步。
            </h1>
            <p className="landing-lead">
              给医保医药价格治理岗用的复核工作台。接入一批机构执行价，价序会对照最新政策找漂移，生成复核任务、处置口径和留痕记录。
            </p>
            <div className="landing-proof-points" aria-label="价序核心能力">
              <span>政策变更后找出风险价</span>
              <span>拿不准的转人工确认</span>
              <span>确认过的同类项下批少审</span>
            </div>
            <div className="landing-cta-row">
              <Link href="/workspace" className="landing-cta primary" data-cta-primary>
                打开工作台 <ArrowRightIcon />
              </Link>
              <Link href="/queue" className="landing-cta ghost">
                看核验队列
              </Link>
            </div>
            <div className="landing-meta-row mono">
              <span>价格复核助手 · v0.1</span>
              <span className="pane-sub-sep" aria-hidden />
              <span>{providerStatus.configured ? "智能研判已接通" : "智能研判未接通"}</span>
              <span className="pane-sub-sep" aria-hidden />
              <span>演示数据已脱敏</span>
            </div>
          </div>

          <LiveWorkspaceCard
            stats={statsRow}
            hasLiveRun={stats.hasLiveRun}
            rowsScanned={stats.rowsScanned}
            runId={latestRunId}
          />
        </div>

        <div className="prompt-rail-landing" aria-label="内置业务任务" data-prompt-rail>
          <span className="prompt-rail-label mono">
            <LightningBoltIcon /> 常用任务 · 点一句开始核价
          </span>
          {PROMPTS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`prompt-chip-landing${p.hero ? " hero" : ""}`}
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

function LiveWorkspaceCard({
  stats,
  hasLiveRun,
  rowsScanned,
  runId,
}: {
  stats: { label: string; value: number; hint: string }[];
  hasLiveRun: boolean;
  rowsScanned: number;
  runId: string | null;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <aside className="live-workspace-card" data-live-workspace ref={ref}>
      <div className="lwc-head">
        <div>
          <div className="lwc-title">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="agent-mark-img" src="/brand/logomark.svg" alt="" aria-hidden />
            <strong>最近一次核查结果</strong>
          </div>
          <div className="lwc-sub mono">
            <span>{runId ? runId.slice(0, 18) : "等待第一次任务"}</span>
          </div>
        </div>
        <span className={`lwc-state ${hasLiveRun ? "ok" : "idle"}`}>
          <span className="status-dot" aria-hidden />
          {hasLiveRun ? "已生成" : "待开始"}
        </span>
      </div>

      <div className="lwc-stats" data-lwc-stats>
        {stats.map((s) => (
          <StatTile key={s.hint} label={s.label} value={s.value} hint={s.hint} active={inView} />
        ))}
      </div>

      <div className="lwc-foot mono">
        <span>
          <CheckCircledIcon /> 已形成 {stats[3].value + stats[4].value} 个待办/口径 · 核查 {rowsScanned} 行
        </span>
      </div>

      <div className="lwc-cta">
        <Link href="/workspace" className="lwc-open" data-cta-open>
          进入工作台 <ArrowRightIcon />
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
          <span className="mono">处理流程 · 系统怎么帮你核</span>
        </div>
        <h2>不是固定按钮：它会盯政策、复核价格，也会记住人工确认过的边界。</h2>
        <p className="landing-section-lead">
          价序每核查一次会走完七步。第 5 步对照政策依据抓风险，第 6 步把人审结论整理成规则。
          每一步都有留痕，过程回看能看到它当时为什么这么做。
        </p>
      </header>
      <ol className="content-ladder" data-content-ladder>
        {LADDER.map((r, i) => (
          <li key={r.phase} className="ladder-rung" data-ladder-rung={r.phase}>
            <span className="ladder-num mono">{String(i + 1).padStart(2, "0")}</span>
            <div className="ladder-body">
              <strong>
                {r.title}
                {r.pain && <em className="ladder-pain">{r.pain}</em>}
              </strong>
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
          <span className="mono">留痕链路 · 结果怎么追溯</span>
        </div>
        <h2>从政策依据到待审规则，每一步都能对账。</h2>
        <p className="landing-section-lead">
          改一条政策依据，风险记录、复核任务、决策留痕、待审规则逐格变化。
          过程回看能查到每一条规则是从哪几条人工确认学来的。
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
    { k: "real_provider", label: "智能研判状态", value: providerStatus.configured ? "已接通" : "未接通" },
    { k: "durable", label: "全程留痕", value: "记录保存，可回看" },
    { k: "drift", label: "政策变化可复核", value: "政策依据变更后再次核查即检出" },
    { k: "learn", label: "规则可审计", value: "规则来源于人工确认记录" },
    { k: "guardrail", label: "敏感项永远人审", value: "麻醉/精神类 · critical 不自动" },
    { k: "recover", label: "失败不假成功", value: "研判失败时保留人工确认" },
    { k: "data", label: "演示数据", value: "合成/脱敏" },
  ];
  return (
    <section className="landing-section landing-proof" data-landing-section="proof">
      <header className="landing-section-head">
        <div className="agent-eyebrow ok">
          <span className="status-dot" aria-hidden />
          <span className="mono">现场验证 · 评委可复跑</span>
        </div>
        <h2>现场复跑：接入数据、选一句任务、看结果。</h2>
        <p className="landing-section-lead">
          以下事实可现场验证。智能研判不可用时不会生成假线索；
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
          <TargetIcon /> 进入工作台复跑
        </Link>
        <Link href="/settings" className="landing-cta ghost">
          查看研判设置
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="agent-mark-img" src="/brand/logomark.svg" alt="" aria-hidden />
            <div>
              <strong>价序</strong>
            <span className="mono">政策变更驱动的价格治理闭环</span>
            </div>
          </div>
        <div className="landing-footer-meta mono">
          <span>2026 全国智慧医保大赛</span>
          <span className="pane-sub-sep" aria-hidden />
          <span>合成/脱敏演示数据</span>
          <span className="pane-sub-sep" aria-hidden />
          <span>全程留痕可回看</span>
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
