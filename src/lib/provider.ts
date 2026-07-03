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

export interface WorkspaceProviderDraft {
  target_name: string;
  draft_type: string;
  content: string;
}

export interface WorkspaceProviderPlan {
  plan_summary: string;
  ordered_steps: { key: string; label: string; reason: string }[];
  answer: string;
  clarifying_question: string;
  drafts: WorkspaceProviderDraft[];
  task_policy: string;
}

export type WorkspacePlanResult =
  | { ok: true; plan: WorkspaceProviderPlan; meta: ProviderMeta; raw: string }
  | { ok: false; category: string; message: string; meta?: Partial<ProviderMeta> };

const TOOL_CATALOG = `
可用工具（server-side 确定性执行）：
- schema_mapper: 校验价格批次字段是否完整且可标化。
- price_catalog_standardizer: 校验 item_code 是否命中医药价格目录，并识别高置信别名编码。
- reference_price_monitor: 对 unit_price 做参考价、最高有效价与涨幅监测。
- collective_landing_tracker: 跟踪集采中选价在 region / procurement_channel 下是否落地。
- anomaly_profiler: 识别日期等异常（如价格日期晚于批次监测日）。
- correction_writer: 写入高置信纠错提案 correction_proposal。
- quarantine_writer: 写入异常处置项 quarantine_item。
- approval_router: 写入待业务核验的 release_approval。
- replay_builder: 组装可回放时间线。
`;

const SYSTEM_PROMPT = `你是"价序"的价格治理规划器，服务于医保局价格招采处 / 医药价格监测人员。
你的职责：观察一个医药价格批次（药品/医用耗材价格记录，含抽样行与统计），判断这批价格数据的主要治理风险，并规划要调用哪些确定性工具、按什么顺序逐行监测，预计把该批次整体推进到哪个治理状态。

治理状态词（只能用这些）：待治理 / 纠错候选 / 异常处置 / 可落地 / 需核验 / 检查失败。
批次整体状态按治理优先级聚合：只要有一行需异常处置则整批异常处置；否则有需核验则整批需核验；否则有可纠错则纠错候选；全部通过才可落地。

安全边界（必须遵守）：
- 医保项目编码无法命中价格目录且没有高置信别名时，应进入异常处置。
- 价格日期晚于批次监测日属于时序异常，应进入异常处置。
- 单价超过最高有效价或集采中选价容忍阈值，应进入异常处置。
- 集采未落地区域、未知渠道、参考价涨幅异常属于不确定风险，必须进入需核验，绝不可自动落地。
- 你只做规划与说明；最终状态由确定性工具校验结果与安全规则共同决定。

${TOOL_CATALOG}

只返回一个 JSON 对象，不要任何额外文字、解释或代码块围栏。JSON 字段：
{
  "issue_focus": "price_catalog | reference_price | collective_landing | date_anomaly | schema | none 之一",
  "ordered_tools": ["从可用工具名中选择，按调用顺序排列，至少 3 个"],
  "rationale": "一句中文，说明你为什么这样规划（面向运营人员）",
  "expected_state": "纠错候选 | 异常处置 | 可落地 | 需核验 之一"
}`;

const MORNING_SYSTEM_PROMPT = `你是"价序"的价格晨会规划器，服务于医保局价格治理岗每天早上的处置晨会。
你的职责：观察今日来源（价格批次异常、重点机构/品种、投诉线索、昨日未回访任务），判断今天先核什么、先催谁、先回访哪条线索，并给出一条可被系统执行的排序规划。

安全边界（必须遵守）：
- 你不能直接形成违规、发函、通报、关闭或最终处置结论。
- 集采落地差异、机构执行价偏高、参考价涨幅异常，只能进入核验/补证/观察/处置待确认。
- 投诉线索只能提高优先级，不能单独作为结论依据。
- 对缺少票据、HIS 截图、包装单位说明、平台落地截图的线索，优先补证或核验。
- 如果 provider 或来源不可用，系统必须显示失败或部分失败，不能伪造晨会结果。

可用工具（server-side 确定性执行）：
- source_reader: 读取价格批次、行级监测结果、重点对象与回访任务。
- issue_ranker: 按风险、时限、重点对象、投诉和用户关注点给线索排序。
- lead_writer: 写入 daily_lead。
- follow_up_writer: 写入 follow_up_task。
- replay_builder: 组装可回放时间线。

只返回一个 JSON 对象，不要任何额外文字、解释或代码块围栏。JSON 字段：
{
  "issue_focus": "collective_landing | institution_execution | price_spike | evidence_gap | overdue_follow_up | catalog_standardization 之一",
  "ordered_tools": ["从可用工具名中选择，按调用顺序排列，至少 3 个"],
  "rationale": "一句中文，说明今天为什么这样排优先级（面向价格治理岗）",
  "expected_state": "需核验 | 异常处置 | 纠错候选 | 可落地 之一"
}`;

const WORKSPACE_SYSTEM_PROMPT = `你是"价序"的对话式医药价格治理工作台规划器，服务于医保局价格治理岗、数据治理岗和集采落地专班。
用户会上传 CSV/XLSX 表格或连接演示数据源，然后用内置 prompt 或自然语言交代任务。你的职责是把任务拆成可执行的价格治理工作：字段标化、数据修复、同品同规归并、单位换算、价格口径对齐、异常/无效异常判断、处置篮、机构口径草稿和内部流程任务。

安全边界：
- 你不能声称已正式发函、通报、罚款、处罚、关闭案件或接入真实省平台/HIS。
- 缺关键字段、包装单位或无法确认同品同规时，只能追问或转数据治理确认。
- 机构口径是草稿，必须保留人工复核边界。
- 合成/脱敏演示数据不能被写成真实生产结论。

可用确定性工具：
- table_parser
- field_mapper
- repair_writer
- product_matcher
- unit_converter
- price_timeline_aligner
- rule_evaluator
- workflow_writer
- draft_writer

只返回一个 JSON 对象，不要任何额外文字、解释或代码块围栏。JSON 字段：
{
  "plan_summary": "一句中文，说明这次准备怎么处理",
  "ordered_steps": [
    {"key": "field_mapping", "label": "字段映射", "reason": "为什么先做这步"}
  ],
  "answer": "给用户看的结果/阶段说明，必须自然、具体、不要像宣传文案",
  "clarifying_question": "如需追问则给出一个具体问题；没有则为空字符串",
  "drafts": [
    {"target_name": "机构名或内部角色", "draft_type": "机构核实 | 集采催办 | 数据治理确认 | 处置建议卡", "content": "可复制草稿，保留请核实/请补充/待人工确认口径"}
  ],
  "task_policy": "本次流程任务如何归类和排序"
}

当存在拿不准、缺关键字段或敏感的处置项时，drafts 里额外生成 draft_type="处置建议卡" 的条目，content 必须是 JSON 字符串：
{"recommendation":"建议动作(转数据治理/生成机构核实/集采催办/暂排除/进入报告)","rationale":"一句中文依据：源行/归并理由/换算公式/命中规则","severity":"low|medium|high|critical","confidence":"high|medium|low","human_actions":["采纳","改派","驳回","补证"]}
处置建议卡是给人看的辅助判断，不替人定性，不自动发函/通报/关闭。

输出长度要求（必须遵守）：answer 不超过 180 字；plan_summary、task_policy 各一句话；每份草稿 content 不超过 160 字（处置建议卡的 JSON 除外）；drafts 总数不超过 5 份。直接给结论，不要铺垫。`;

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
  return generatePlanWithPrompt(SYSTEM_PROMPT, observation, "请基于以下整批观察结果给出价格治理监测规划（只返回 JSON）：\n");
}

export async function generateMorningSessionPlan(
  observation: Record<string, unknown>,
): Promise<PlanResult> {
  return generatePlanWithPrompt(
    MORNING_SYSTEM_PROMPT,
    observation,
    "请基于以下晨会观察结果给出今日价格处置晨会规划（只返回 JSON）：\n",
  );
}

export async function generateWorkspacePlan(
  observation: Record<string, unknown>,
): Promise<WorkspacePlanResult> {
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
    temperature: 0.25,
    messages: [
      { role: "system", content: WORKSPACE_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "请基于以下对话任务、数据摘要和确定性工具结果，返回 JSON 工作计划与草稿：\n" +
          JSON.stringify(observation, null, 2),
      },
    ],
    response_format: { type: "json_object" as const },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
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
        message: "Provider 返回内容无法解析为 JSON 工作计划。",
        meta: { model: config.model, baseUrlHost: host, latency_ms: latency },
      };
    }

    const steps = Array.isArray(parsed.ordered_steps)
      ? (parsed.ordered_steps as unknown[]).map((raw) => {
          const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
          return {
            key: String(item.key ?? "step"),
            label: String(item.label ?? "处理步骤").slice(0, 40),
            reason: String(item.reason ?? "").slice(0, 220),
          };
        })
      : [];
    const drafts = Array.isArray(parsed.drafts)
      ? (parsed.drafts as unknown[]).map((raw) => {
          const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
          return {
            target_name: String(item.target_name ?? "待确认对象").slice(0, 80),
            draft_type: String(item.draft_type ?? "机构核实").slice(0, 40),
            content: String(item.content ?? "").slice(0, 900),
          };
        })
      : [];

    const plan: WorkspaceProviderPlan = {
      plan_summary: String(parsed.plan_summary ?? "").slice(0, 360),
      ordered_steps: steps.length
        ? steps
        : [
            { key: "field_mapping", label: "字段映射", reason: "先确认数据可比口径。" },
            { key: "repair", label: "数据修复", reason: "能确定的字段和编码先生成修复 patch。" },
            { key: "workflow", label: "流程任务", reason: "不能自动处置的项转人工确认。" },
          ],
      answer: String(parsed.answer ?? "").slice(0, 1200),
      clarifying_question: String(parsed.clarifying_question ?? "").slice(0, 220),
      drafts,
      task_policy: String(parsed.task_policy ?? "").slice(0, 360),
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
        ? "Provider 调用超时（90s）。"
        : `Provider 调用失败：${err instanceof Error ? err.message : String(err)}`,
      meta: { model: config.model, baseUrlHost: host },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function generatePlanWithPrompt(
  systemPrompt: string,
  observation: Record<string, unknown>,
  userPrefix: string,
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
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: userPrefix + JSON.stringify(observation, null, 2),
      },
    ],
    response_format: { type: "json_object" as const },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
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
        ? "Provider 调用超时（90s）。"
        : `Provider 调用失败：${err instanceof Error ? err.message : String(err)}`,
      meta: { model: config.model, baseUrlHost: host },
    };
  } finally {
    clearTimeout(timeout);
  }
}
