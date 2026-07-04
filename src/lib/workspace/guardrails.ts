import "server-only";

// ===== V2 自动审批护栏 =====
// 来源：葛文婧"难判断 AI 辅助、不替人定性"；周夕鸣"发函/通报/违规认定/关闭必须人确认"。
// 这些情况必须人审，绝不自动处置。applyLearnedRules 在自动处置前先过 mustHumanReview。

export interface GuardrailInput {
  severity?: string;
  issueType?: string;
  overCeiling?: boolean;
  collectiveOverTolerance?: boolean;
  codeInvalid?: boolean;
  // 差比价折算超限（2452号）：后续动作是督促企业调价，属对企动作，必须人审。
  specRatioOver?: boolean;
  providerDegraded?: boolean;
  maskedData?: boolean;
}

export interface GuardrailResult {
  mustHuman: boolean;
  reasons: string[];
}

// 判断一条处置项是否必须人审。
export function mustHumanReview(input: GuardrailInput): GuardrailResult {
  const reasons: string[] = [];
  const sev = (input.severity ?? "").toLowerCase();

  // 1. 严重度：critical/high 一律人审
  if (sev === "critical" || sev === "high") {
    reasons.push("severity_high_or_critical");
  }
  // 2. 超最高有效价：人审（红线）
  if (input.overCeiling) {
    reasons.push("over_ceiling_price");
  }
  // 3. 集采价超中选价容忍阈值：人审
  if (input.collectiveOverTolerance) {
    reasons.push("collective_price_over_tolerance");
  }
  // 4. 编码失效/重映射：人审
  if (input.codeInvalid) {
    reasons.push("code_invalid_or_remapped");
  }
  // 4b. 差比价折算超限：督促调价是对企动作，人审
  if (input.specRatioOver) {
    reasons.push("spec_ratio_over_limit");
  }
  // 5. 涉及不公开支付标准：人审（红线）
  if (input.maskedData) {
    reasons.push("non_public_masked_data");
  }
  // 6. provider 降级：人审（不能在不可靠时自动处置）
  if (input.providerDegraded) {
    reasons.push("provider_degraded");
  }

  return { mustHuman: reasons.length > 0, reasons };
}

// 从 disposition_item + rule_evaluation 的常见字段推断护栏输入。
// 用于 applyLearnedRules 里把 disposition 转成 GuardrailInput。
export function inferGuardrailInput(disp: {
  severity: string;
  issue_type: string;
}): GuardrailInput {
  const it = disp.issue_type.toLowerCase();
  return {
    severity: disp.severity,
    issueType: disp.issue_type,
    overCeiling: it.includes("ceiling") || it.includes("最高有效价") || it.includes("over_ceiling"),
    collectiveOverTolerance: it.includes("集采") || it.includes("中选价") || it.includes("collective"),
    codeInvalid: it.includes("code") || it.includes("编码") || it.includes("schema") || it.includes("unmatched"),
    specRatioOver: it.includes("spec_over_ratio") || it.includes("差比价"),
  };
}
