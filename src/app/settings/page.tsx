import { Badge, Callout } from "@radix-ui/themes";
import { CheckCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { ResetSampleButton } from "@/components/ClientButtons";
import { DesktopPetToggle } from "@/components/DesktopPetToggle";
import { getProviderStatus } from "@/lib/env";
import { getManifest } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: { role: string; can: string; boundary: string }[] = [
  { role: "价格治理岗", can: "创建/打开价格批次，编辑价格明细，运行价格治理，查看状态与回放", boundary: "不能直接确认异常价格落地" },
  { role: "价格核验人", can: "确认/转处置核验对象，处理参考价涨幅与集采落地疑点", boundary: "不能改写价序原始 run" },
  { role: "集采落地专班", can: "核验中选价区域落地、执行价偏差和整改闭环", boundary: "不维护价格目录" },
  { role: "目录维护员", can: "维护医药价格目录快照，确认编码纠错提案", boundary: "不负责价格落地核验" },
  { role: "系统管理员", can: "配置 provider、凭证发现、规则源、价格适配器、保留策略、用户权限", boundary: "不替业务核验" },
  { role: "公开评委 / 演示用户", can: "运行整批价格治理、自由编辑价格行、导入价格批次、查看公开 replay", boundary: "不访问真实敏感数据，不跳过核验边界" },
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
            <span className="mono">设置 · Provider / 规则源 / 角色</span>
          </div>
          <h1 className="settings-title">Provider · 规则源 · 角色</h1>
        </header>

        <section className="gate-card settings-card">
          <div className="settings-card-head">
            <strong>Provider 凭证（server-side）</strong>
            {status.configured ? (
              <Badge color="green" variant="soft" radius="full">
                <CheckCircledIcon style={{ marginRight: 4 }} /> 就绪
              </Badge>
            ) : (
              <Badge color="amber" variant="soft" radius="full">
                <ExclamationTriangleIcon style={{ marginRight: 4 }} /> 未配置
              </Badge>
            )}
          </div>
          {status.configured ? (
            <div className="settings-kv">
              <Row label="Endpoint host" mono={status.baseUrlHost ?? "-"} />
              <Row label="Model" mono={status.model ?? "-"} />
              <Row label="凭证来源" mono={status.source ?? "-"} />
              <p className="settings-note">
                密钥仅在服务端使用，绝不下发到浏览器。
              </p>
            </div>
          ) : (
            <Callout.Root color="amber">
              <Callout.Icon><ExclamationTriangleIcon /></Callout.Icon>
              <Callout.Text>
                未发现可用凭证。价格治理将进入降级模式（检查失败），不会伪造价序结果。
              </Callout.Text>
            </Callout.Root>
          )}
          <div className="settings-source-order mono">
            凭证发现顺序：{status.checkedSources.join(" → ")}
          </div>
        </section>

        <section className="gate-card settings-card">
          <div className="settings-card-head">
            <strong>规则源版本</strong>
            <Badge color="blue" variant="soft" radius="full">{manifest?.procurement_channel_version}</Badge>
          </div>
          <div className="settings-kv">
            <Row label="Schema" mono={manifest?.schema_version ?? "-"} />
            <Row label="价格目录" mono={manifest?.code_dictionary_version ?? "-"} />
            <Row label="渠道策略" mono={manifest?.procurement_channel_version ?? "-"} />
            <Row label="治理规则" mono={manifest?.release_rule_version ?? "-"} />
            <Row label="参考价来源" mono={manifest?.token_method ?? "-"} />
          </div>
          <div style={{ marginTop: 14 }}>
            <ResetSampleButton />
          </div>
        </section>

        <section className="gate-card settings-card">
          <div className="settings-card-head">
            <strong>角色与权限边界</strong>
            <span className="settings-card-meta mono">{ROLES.length} roles</span>
          </div>
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>角色</th>
                  <th>权限</th>
                  <th>边界</th>
                </tr>
              </thead>
              <tbody>
                {ROLES.map((r) => (
                  <tr key={r.role}>
                    <td className="settings-role-cell">{r.role}</td>
                    <td>{r.can}</td>
                    <td className="settings-boundary-cell">{r.boundary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="gate-card settings-card">
          <div className="settings-card-head">
            <strong>陪伴</strong>
            <span className="settings-card-meta mono">彩蛋</span>
          </div>
          <div className="settings-kv">
            <DesktopPetToggle />
          </div>
        </section>
      </main>
    </div>
  );
}

function Row({ label, mono }: { label: string; mono?: string }) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <span className="mono settings-row-value">{mono ?? "-"}</span>
    </div>
  );
}
