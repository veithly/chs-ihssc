import { Badge } from "@radix-ui/themes";
import type { ReleaseState } from "@/lib/types";

const COLOR: Record<ReleaseState, React.ComponentProps<typeof Badge>["color"]> = {
  待发布: "amber",
  检查中: "blue",
  纠错候选: "violet",
  隔离: "red",
  可发布: "green",
  需审批: "orange",
  检查失败: "gray",
};

export function StateBadge({
  state,
  size = "2",
}: {
  state: ReleaseState;
  size?: React.ComponentProps<typeof Badge>["size"];
}) {
  return (
    <Badge color={COLOR[state]} size={size} variant="soft" radius="full" data-release-state={state}>
      {state}
    </Badge>
  );
}
