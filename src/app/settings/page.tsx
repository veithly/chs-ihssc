import { Badge, Callout } from "@radix-ui/themes";
import { CheckCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { ResetSampleButton } from "@/components/ClientButtons";
import { DesktopPetToggle } from "@/components/DesktopPetToggle";
import { getProviderStatus } from "@/lib/env";
import { getManifest } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLE_BOUNDARIES: { role: string; work: string; boundary: string }[] = [
  { role: "价格治理岗", work: "导入价格批次、编辑明细、发起核查、查看处置建议和过程回看", boundary: "异常落地、对外函件和高危处置必须转人工核验" },
  { role: "价格核验人", work: "确认人审任务、补充核验意见、沉淀可复用处置动作", boundary: "不能改写原始数据、政策依据和核查结果" },
  { role: "目录维护员", work: "确认编码纠错、维护价格目录快照、处理目录未命中项", boundary: "不直接判断价格落地是否违规" },
  { role: "系统管理员", work: "维护智能研判服务、访问配置、规则来源和演示环境", boundary: "不替业务人员作核验结论" },
];

const HUMAN_GUARDRAILS = [
  "超最高有效价、集采未落地、对外发函、通报和违规认定一律保留人审。",
  "学习规则必须来自人审决策，经过影响面预览后才能激活。",
  "智能研判不可用时，系统写入检查失败，不用本地规则伪造成智能结论。",
];

export default async function SettingsPage() {
  const status = getProviderStatus();
  const manifest = getManifest("REL-2026-0623-07");

  return (
    <div className="gate-shell">
      <AppHeader active="设置" />
      <Breadcrumb items={["价序", "设置"]} />
      <main className="settings-shell">
        <header className="settings-head">
          <div className="agent-eyebrow">
            <span className="mono">运行与治理边界</span>
          </div>
          <h1 className="settings-title">设置</h1>
          <p className="settings-lead">
            面向医保价格治理岗和评审演示，集中说明当前运行状态、核验依据、人工边界和演示环境。
          </p>
        </header>

        <section className="gate-card settings-card">
          <div className="settings-card-head">
            <strong>运行状态</strong>
            {status.configured ? (
              <Badge color="green" variant="soft" radius="full">
                <CheckCircledIcon style={{ marginRight: 4 }} /> 智能研判可用
              </Badge>
            ) : (
              <Badge color="amber" variant="soft" radius="full">
                <ExclamationTriangleIcon style={{ marginRight: 4 }} /> 降级运行
              </Badge>
            )}
          </div>
          {status.configured ? (
            <div className="settings-kv">
              <Row label="服务状态" value="可生成规划、处置建议和机构口径草稿" />
              <Row label="研判能力" mono={status.model ?? "-"} />
              <Row label="配置来源" mono={status.source ?? "-"} />
              <p className="settings-note">
                访问配置仅在后台使用，浏览器只展示运行状态和非敏感说明。
              </p>
            </div>
          ) : (
            <Callout.Root color="amber">
              <Callout.Icon><ExclamationTriangleIcon /></Callout.Icon>
              <Callout.Text>
                未发现可用智能研判服务。字段对应、归并、规则评估等可确定结果仍可查看；机构口径草稿不生成，治理状态诚实标记为检查失败。
              </Callout.Text>
            </Callout.Root>
          )}
          <details className="settings-debug">
            <summary>运行排查信息</summary>
            <div className="settings-source-order mono">
              服务位置：{status.baseUrlHost ?? "-"}；检查顺序：{status.checkedSources.join(" -> ")}
            </div>
          </details>
        </section>

        <section className="gate-card settings-card">
          <div className="settings-card-head">
            <strong>核验依据</strong>
            <Badge color="blue" variant="soft" radius="full">{manifest?.procurement_channel_version}</Badge>
          </div>
          <div className="settings-kv">
            <Row label="价格目录" mono={manifest?.code_dictionary_version ?? "-"} />
            <Row label="政策/渠道事实" mono={manifest?.procurement_channel_version ?? "-"} />
            <Row label="治理规则" mono={manifest?.release_rule_version ?? "-"} />
            <Row label="参考价来源" mono={manifest?.token_method ?? "-"} />
            <Row label="表头规范" mono={manifest?.schema_version ?? "-"} />
          </div>
          <p className="settings-note">
            每次核查都会按这些版本写入过程回看和决策留痕；政策依据变更后，存量执行价会被重新对照并进入风险队列。
          </p>
        </section>

        <section className="gate-card settings-card">
          <div className="settings-card-head">
            <strong>人审与自动化边界</strong>
            <span className="settings-card-meta mono">{ROLE_BOUNDARIES.length} 类角色</span>
          </div>
          <div className="settings-guardrails">
            {HUMAN_GUARDRAILS.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>角色</th>
                  <th>当前可做</th>
                  <th>必须保留的边界</th>
                </tr>
              </thead>
              <tbody>
                {ROLE_BOUNDARIES.map((r) => (
                  <tr key={r.role}>
                    <td className="settings-role-cell">{r.role}</td>
                    <td>{r.work}</td>
                    <td className="settings-boundary-cell">{r.boundary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="gate-card settings-card">
          <div className="settings-card-head">
            <strong>演示环境</strong>
            <span className="settings-card-meta mono">演示数据</span>
          </div>
          <div className="settings-kv settings-demo-grid">
            <div>
              <Row label="数据范围" value="合成/脱敏价格批次，不包含真实敏感医保数据" />
              <Row label="演示能力" value="导入、编辑、核查、过程回看、人审、待审规则和自动处置闭环" />
              <Row label="公开边界" value="评委可重跑样例和查看过程回看，但不能跳过人审护栏" />
              <div style={{ marginTop: 14 }}>
                <ResetSampleButton />
              </div>
            </div>
            <div className="settings-companion">
              <div className="settings-card-head compact">
                <strong>界面辅助</strong>
                <span className="settings-card-meta mono">可选</span>
              </div>
              <p className="settings-note">
                仅用于演示时提示运行状态，不参与任何业务判断。
              </p>
              <div style={{ marginTop: 10 }}>
                <DesktopPetToggle />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Row({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: string;
  value?: string;
}) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <span className={mono ? "mono settings-row-value" : "settings-row-value"}>{mono ?? value ?? "-"}</span>
    </div>
  );
}
