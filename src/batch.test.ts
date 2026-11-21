import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildApplyPlan, executeApplyPlan } from "./batch";
import { parseCatalog, type CatalogTier, type Tweak } from "./catalog";

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
  it("loads both bundled catalogs and exposes only the reviewed mappings", () => {
    const supportedIds = [176, 177, 185, 201, 202, 204, 205, 206];
    const bundledCatalogs: Array<{ tier: CatalogTier; count: number }> = [
      { tier: "free", count: 274 },
      { tier: "premium", count: 842 },
    ];

    for (const { tier, count } of bundledCatalogs) {
      const text = readFileSync(new URL(`../public/catalogs/${tier}.json`, import.meta.url), "utf8");
      const catalog = parseCatalog(text, tier);
      const plan = buildApplyPlan(catalog.tweaks, "Windows", true, true, []);

      expect(catalog.tweaks).toHaveLength(count);
      expect(plan.items.filter(({ status }) => status === "ready").map(({ id }) => id)).toEqual(supportedIds);
    }
  });

  it("maps only the exact verified record on a supported Windows desktop", () => {
    const plan = buildApplyPlan([mapped, unsupported], "Windows", true, true, []);

    expect(plan.items.map(({ status }) => status)).toEqual(["ready", "unsupported"]);
    expect(plan.actionIds).toEqual(["reduce-ui-motion"]);
  });

  it("registers the reversible visual and Explorer mappings", () => {
    const items: Tweak[] = [
      { id: 176, name: "Disable Transparency Effects", category: "Visual", risk: "low" },
      mapped,
      { id: 185, name: "Enable Dark Mode", category: "Visual", risk: "low" },
      { id: 201, name: "Show File Extensions", category: "Explorer", risk: "low" },
      { id: 202, name: "Show Hidden Files", category: "Explorer", risk: "low" },
      { id: 204, name: "Open Explorer to This PC", category: "Explorer", risk: "low" },
      { id: 205, name: "Disable Quick Access Recent Files", category: "Explorer", risk: "low" },
      { id: 206, name: "Disable Quick Access Frequent Folders", category: "Explorer", risk: "low" },
    ];
    const plan = buildApplyPlan(items, "Windows", true, true, []);

    expect(plan.items.map(({ status }) => status)).toEqual(items.map(() => "ready"));
    expect(plan.actionIds).toEqual([
      "disable-transparency",
      "reduce-ui-motion",
      "enable-dark-mode",
      "show-file-extensions",
      "show-hidden-files",
      "explorer-this-pc",
      "disable-quick-access-recent",
      "disable-quick-access-frequent",
    ]);
    expect(plan.items.find((item) => item.id === 202)?.warning).toContain("hidden files");
  });

  it("reports each mapped outcome when a multi-action batch fails partway through", async () => {
    const items: Tweak[] = [
      { id: 176, name: "Disable Transparency Effects", category: "Visual", risk: "low" },
      mapped,
      { id: 185, name: "Enable Dark Mode", category: "Visual", risk: "low" },
      { id: 201, name: "Show File Extensions", category: "Explorer", risk: "low" },
    ];
    const plan = buildApplyPlan(items, "Windows", true, true, []);
    const applyAction = vi.fn(async (actionId: string) => {
      if (actionId === "enable-dark-mode") throw new Error("registry write failed");
    });
    const result = await executeApplyPlan(plan, applyAction);

    expect(applyAction.mock.calls.map(([actionId]) => actionId)).toEqual([
      "disable-transparency",
      "reduce-ui-motion",
      "enable-dark-mode",
    ]);
    expect(result.items.map(({ status }) => status)).toEqual(["applied", "applied", "failed", "not-run"]);
    expect(result.failure?.actionId).toBe("enable-dark-mode");
  });

  it("does not map near matches, other platforms, or unavailable desktop actions", () => {
    const renamed = { ...mapped, name: "Disable Every Animation" };
    const changedCategory = { ...mapped, category: "Performance" };

    expect(buildApplyPlan([renamed, changedCategory], "Windows", true, true, []).actionIds).toEqual([]);
    expect(buildApplyPlan([mapped], "Linux", true, true, []).items[0].status).toBe("unsupported");
    expect(buildApplyPlan([mapped], "Windows", true, false, []).items[0].status).toBe("unavailable");
    expect(buildApplyPlan([mapped], "Windows", false, false, []).items[0].status).toBe("unavailable");
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
    const plan = buildApplyPlan([unsupported], "macOS", true, true, []);
    const applyAction = vi.fn(async () => undefined);
    const result = await executeApplyPlan(plan, applyAction);

    expect(applyAction).not.toHaveBeenCalled();
    expect(result.items[0].status).toBe("unsupported");
    expect(result.failure).toBeUndefined();
  });

  it("applies only registered actions and reports each item's outcome", async () => {
    const plan = buildApplyPlan([mapped, unsupported], "Windows", true, true, []);
    const applyAction = vi.fn(async () => undefined);
    const result = await executeApplyPlan(plan, applyAction);

    expect(applyAction).toHaveBeenCalledTimes(1);
    expect(applyAction).toHaveBeenCalledWith("reduce-ui-motion");
    expect(result.items.map(({ status }) => status)).toEqual(["applied", "unsupported"]);
  });

  it("does not reapply an action already applied through the standalone control", async () => {
    const plan = buildApplyPlan([mapped], "Windows", true, true, ["reduce-ui-motion"]);
    const applyAction = vi.fn(async () => undefined);
    const result = await executeApplyPlan(plan, applyAction);

    expect(applyAction).not.toHaveBeenCalled();
    expect(result.items[0].status).toBe("already-applied");
  });

  it("does not report a failed native action as applied", async () => {
    const plan = buildApplyPlan([mapped], "Windows", true, true, []);
    const applyAction = vi.fn(async () => {
      throw new Error("write failed");
    });
    const result = await executeApplyPlan(plan, applyAction);

    expect(result.items[0].status).toBe("failed");
    expect(result.failure?.error).toMatchObject({ message: "write failed" });
  });
});
