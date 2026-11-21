import { describe, expect, it, vi } from "vitest";
import { buildApplyPlan, executeApplyPlan } from "./batch";
import type { Tweak } from "./catalog";

const mapped: Tweak = {
  id: 177,
  name: "Disable Window Animations",
  category: "Visual",
  risk: "low",
};
const unsupported: Tweak = {
  id: 178,
  name: "Disable Taskbar Animations",
  category: "Visual",
  risk: "low",
};

describe("catalog Apply All planning", () => {
  it("maps only the exact verified record on a supported Windows desktop", () => {
    const plan = buildApplyPlan([mapped, unsupported], "Windows", true, true, false);

    expect(plan.items.map(({ status }) => status)).toEqual(["ready", "unsupported"]);
    expect(plan.actionIds).toEqual(["reduce-ui-motion"]);
  });

  it("does not map near matches, other platforms, or unavailable desktop actions", () => {
    const renamed = { ...mapped, name: "Disable Every Animation" };
    const changedCategory = { ...mapped, category: "Performance" };

    expect(buildApplyPlan([renamed, changedCategory], "Windows", true, true, false).actionIds).toEqual([]);
    expect(buildApplyPlan([mapped], "Linux", true, true, false).items[0].status).toBe("unsupported");
    expect(buildApplyPlan([mapped], "Windows", true, false, false).items[0].status).toBe("unavailable");
    expect(buildApplyPlan([mapped], "Windows", false, false, false).items[0].status).toBe("unavailable");
  });

  it("refuses an unregistered ready item even if a caller fabricates a plan", async () => {
    const applyAction = vi.fn(async () => undefined);
    const result = await executeApplyPlan(
      {
        items: [{ ...mapped, status: "ready", actionId: "arbitrary-command", platform: "Windows" }],
        actionIds: ["arbitrary-command"],
      },
      applyAction,
    );

    expect(applyAction).not.toHaveBeenCalled();
    expect(result.items[0].status).toBe("unsupported");
  });

  it("makes no native call and reports unsupported entries when nothing is mapped", async () => {
    const plan = buildApplyPlan([unsupported], "macOS", true, true, false);
    const applyAction = vi.fn(async () => undefined);
    const result = await executeApplyPlan(plan, applyAction);

    expect(applyAction).not.toHaveBeenCalled();
    expect(result.items[0].status).toBe("unsupported");
    expect(result.failure).toBeUndefined();
  });

  it("applies only registered actions and reports each item's outcome", async () => {
    const plan = buildApplyPlan([mapped, unsupported], "Windows", true, true, false);
    const applyAction = vi.fn(async () => undefined);
    const result = await executeApplyPlan(plan, applyAction);

    expect(applyAction).toHaveBeenCalledTimes(1);
    expect(applyAction).toHaveBeenCalledWith("reduce-ui-motion");
    expect(result.items.map(({ status }) => status)).toEqual(["applied", "unsupported"]);
  });

  it("does not reapply an action already applied through the standalone control", async () => {
    const plan = buildApplyPlan([mapped], "Windows", true, true, true);
    const applyAction = vi.fn(async () => undefined);
    const result = await executeApplyPlan(plan, applyAction);

    expect(applyAction).not.toHaveBeenCalled();
    expect(result.items[0].status).toBe("already-applied");
  });

  it("does not report a failed native action as applied", async () => {
    const plan = buildApplyPlan([mapped], "Windows", true, true, false);
    const applyAction = vi.fn(async () => {
      throw new Error("write failed");
    });
    const result = await executeApplyPlan(plan, applyAction);

    expect(result.items[0].status).toBe("failed");
    expect(result.failure?.error).toMatchObject({ message: "write failed" });
  });
});
