import { Badge, Callout } from "@radix-ui/themes";
import { CheckCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { ResetSampleButton } from "@/components/ClientButtons";
import { getProviderStatus } from "@/lib/env";
import { getManifest } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: { role: string; can: string; boundary: string }[] = [
  { role: "数据运营员", can: "创建/打开 release，选择或编辑脱敏行，运行通行检查，查看状态与回放", boundary: "不能越过审批发布高风险数据" },
  { role: "业务审批人", can: "批准/拒绝 correction、release approval、quarantine release", boundary: "不能改写 Agent 原始 run" },
  { role: "数据安全员", can: "查看策略快照、token 规则、权限拒绝原因，导出审计包", boundary: "不维护目录字典" },
  { role: "目录维护员", can: "维护医保目录字典快照，确认编码纠错提案", boundary: "不负责最终发布审批" },
  { role: "系统管理员", can: "配置 provider、凭证发现、规则源、数据适配器、保留策略、用户权限", boundary: "不替业务审批" },
  { role: "公开评委 / 演示用户", can: "操作合成脱敏 fixture，触发 mutation，查看公开 replay", boundary: "不访问真实敏感数据，不跳过审批边界" },
];

export default async function SettingsPage() {
  const status = getProviderStatus();
  const manifest = getManifest("REL-2026-0623-07");

  return (
    <div className="gate-shell">
      <AppHeader active="设置" />
      <Breadcrumb items={["数据通行", "设置"]} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "12px 24px 40px" }}>
        <h1 style={{ fontSize: 20, marginBottom: 16 }}>Provider / 规则源 / 角色</h1>

        <section className="gate-card" style={{ padding: 22, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <strong style={{ fontSize: 15 }}>Provider 凭证（server-side）</strong>
            {status.configured ? (
              <Badge color="green" variant="soft"><CheckCircledIcon /> 就绪</Badge>
            ) : (
              <Badge color="amber" variant="soft"><ExclamationTriangleIcon /> 未配置</Badge>
            )}
          </div>
          {status.configured ? (
            <div className="gate-card-flat" style={{ padding: 14, fontSize: 13.5, lineHeight: 1.9 }}>
              <div><span style={{ color: "var(--gate-ink-soft)" }}>Endpoint host：</span><span className="mono">{status.baseUrlHost}</span></div>
              <div><span style={{ color: "var(--gate-ink-soft)" }}>Model：</span><span className="mono">{status.model}</span></div>
              <div><span style={{ color: "var(--gate-ink-soft)" }}>凭证来源：</span><span className="mono">{status.source}</span></div>
              <div style={{ color: "var(--gate-ink-soft)", fontSize: 12.5, marginTop: 6 }}>
                密钥仅在服务端使用，绝不下发到浏览器。
              </div>
            </div>
          ) : (
            <Callout.Root color="amber">
              <Callout.Icon><ExclamationTriangleIcon /></Callout.Icon>
              <Callout.Text>
                未发现可用凭证。通行检查将进入降级模式（检查失败），不会伪造 Agent 结果。
              </Callout.Text>
            </Callout.Root>
          )}
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--gate-ink-soft)" }}>
            凭证发现顺序：{status.checkedSources.join(" → ")}
          </div>
        </section>

        <section className="gate-card" style={{ padding: 22, marginBottom: 20 }}>
          <strong style={{ fontSize: 15 }}>规则源版本</strong>
          <div className="gate-card-flat" style={{ padding: 14, marginTop: 12, fontSize: 13.5, lineHeight: 1.9 }}>
            <div>schema：<span className="mono">{manifest?.schema_version}</span></div>
            <div>目录字典：<span className="mono">{manifest?.code_dictionary_version}</span></div>
            <div>访问策略：<span className="mono">{manifest?.access_policy_version}</span></div>
            <div>发布规则：<span className="mono">{manifest?.release_rule_version}</span></div>
            <div>身份方法：<span className="mono">{manifest?.token_method}</span></div>
          </div>
          <div style={{ marginTop: 14 }}>
            <ResetSampleButton />
          </div>
        </section>

        <section className="gate-card" style={{ padding: 22, marginBottom: 20 }}>
          <strong style={{ fontSize: 15 }}>角色与权限边界</strong>
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--gate-ink-soft)", textAlign: "left" }}>
                  <th style={{ padding: "9px 10px", fontWeight: 500 }}>角色</th>
                  <th style={{ padding: "9px 10px", fontWeight: 500 }}>权限</th>
                  <th style={{ padding: "9px 10px", fontWeight: 500 }}>边界</th>
                </tr>
              </thead>
              <tbody>
                {ROLES.map((r) => (
                  <tr key={r.role} style={{ borderTop: "1px solid var(--gate-border)" }}>
                    <td style={{ padding: "11px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>{r.role}</td>
                    <td style={{ padding: "11px 10px", color: "var(--gate-ink-soft)", lineHeight: 1.55 }}>{r.can}</td>
                    <td style={{ padding: "11px 10px", color: "var(--gate-ink-soft)", lineHeight: 1.55 }}>{r.boundary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
