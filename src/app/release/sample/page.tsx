import { redirect } from "next/navigation";

// QR / 移动端入口：/release/sample -> 公开样例 Release。
export default function SampleRelease() {
  redirect("/release/REL-SAMPLE-01");
}
