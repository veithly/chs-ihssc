import { Badge } from "@radix-ui/themes";
import type { ReleaseState } from "@/lib/types";

const COLOR: Record<ReleaseState, React.ComponentProps<typeof Badge>["color"]> = {
  待治理: "amber",
  监测中: "blue",
  纠错候选: "violet",
  异常处置: "red",
  可落地: "green",
  需核验: "orange",
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
