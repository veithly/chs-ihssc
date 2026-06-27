"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TextField, TextArea, Flex } from "@radix-ui/themes";
import { CopyIcon, CheckIcon, DownloadIcon, UpdateIcon } from "@radix-ui/react-icons";

export function CopyButton({ text, label = "复制回放链接" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="soft"
      size="2"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />} {done ? "已复制" : label}
    </Button>
  );
}

export function AuditExportButton({
  data,
  filename,
}: {
  data: unknown;
  filename: string;
}) {
  return (
    <Button
      variant="soft"
      size="2"
      data-audit-export
      onClick={() => {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <DownloadIcon /> 导出治理证据（JSON）
    </Button>
  );
}

export function ResetSampleButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="soft"
      color="gray"
      size="2"
      disabled={busy}
      onClick={async () => {
        if (!confirm("重置所有示例价格批次与运行记录？将清空当前 agent run / 核验 / 异常处置记录。")) return;
        setBusy(true);
        await fetch("/api/admin/reseed", { method: "POST" });
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? <UpdateIcon className="spin" /> : <UpdateIcon />} 重置示例数据
    </Button>
  );
}

export function ApprovalActions({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const [approver, setApprover] = useState("价格核验人");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    await fetch("/api/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId, decision, approver, notes }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <Flex direction="column" gap="2" data-approval-actions style={{ marginTop: 12 }}>
      <TextField.Root
        size="2"
        value={approver}
        onChange={(e) => setApprover(e.target.value)}
        placeholder="核验人"
      />
      <TextArea
        size="2"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="核验备注（将与智能体建议分开记录在回放中）"
      />
      <Flex gap="2">
        <Button color="green" disabled={busy} onClick={() => decide("approved")} data-approve>
          确认落地（可落地）
        </Button>
        <Button color="red" variant="soft" disabled={busy} onClick={() => decide("rejected")} data-reject>
          转异常处置
        </Button>
      </Flex>
    </Flex>
  );
}
