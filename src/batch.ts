import type { Tweak } from "./catalog";

const ACTION_ID = "reduce-ui-motion";

const CATALOG_MAPPINGS = [
  {
    id: 177,
    name: "Disable Window Animations",
    category: "Visual",
    risk: "low",
    platform: "Windows",
    actionId: ACTION_ID,
  },
] as const;

export type BatchItemStatus =
  | "ready"
  | "unsupported"
  | "unavailable"
  | "already-applied"
  | "applied"
  | "failed"
  | "not-run";

export interface BatchItemResult {
  id: number;
  name: string;
  category: string;
  risk: Tweak["risk"];
  status: BatchItemStatus;
  actionId?: string;
  platform?: string;
}

export interface ApplyPlan {
  items: BatchItemResult[];
  actionIds: string[];
}

export interface BatchExecution {
  items: BatchItemResult[];
  failure?: { actionId: string; error: unknown };
}

export function buildApplyPlan(
  tweaks: Tweak[],
  platform: string,
  nativeRuntime: boolean,
  nativeActionSupported: boolean,
  actionAlreadyApplied: boolean,
): ApplyPlan {
  const items = tweaks.map((tweak): BatchItemResult => {
    const mapping = CATALOG_MAPPINGS.find(
      (candidate) =>
        candidate.id === tweak.id &&
        candidate.name === tweak.name &&
        candidate.category === tweak.category &&
        candidate.risk === tweak.risk,
    );
    if (!mapping || mapping.platform !== platform) {
      return { id: tweak.id, name: tweak.name, category: tweak.category, risk: tweak.risk, status: "unsupported" };
    }
    if (!nativeRuntime || !nativeActionSupported) {
      return { id: tweak.id, name: tweak.name, category: tweak.category, risk: tweak.risk, status: "unavailable" };
    }
    if (actionAlreadyApplied) {
      return { ...tweak, status: "already-applied", actionId: mapping.actionId, platform: mapping.platform };
    }
    return { ...tweak, status: "ready", actionId: mapping.actionId, platform: mapping.platform };
  });

  const actionIds = [...new Set(items.flatMap((item) => item.status === "ready" && item.actionId ? [item.actionId] : []))];
  return { items, actionIds };
}

export async function executeApplyPlan(
  plan: ApplyPlan,
  applyAction: (actionId: string) => Promise<unknown>,
): Promise<BatchExecution> {
  const applied = new Set<string>();
  const failed = new Set<string>();
  let failure: BatchExecution["failure"];
  const registeredActions = plan.items.filter(
    (item) =>
      item.status === "ready" &&
      CATALOG_MAPPINGS.some(
        (mapping) =>
          mapping.id === item.id &&
          mapping.name === item.name &&
          mapping.category === item.category &&
          mapping.risk === item.risk &&
          mapping.platform === item.platform &&
          mapping.actionId === item.actionId,
      ),
  );
  const actionIds = [...new Set(registeredActions.flatMap((item) => item.actionId ? [item.actionId] : []))];

  for (const actionId of actionIds) {
    try {
      await applyAction(actionId);
      applied.add(actionId);
    } catch (cause) {
      failed.add(actionId);
      failure = { actionId, error: cause };
      break;
    }
  }

  return {
    items: plan.items.map((item) => {
      if (item.status !== "ready") return item;
      const isRegistered = registeredActions.some(
        (candidate) => candidate.id === item.id && candidate.actionId === item.actionId,
      );
      if (!isRegistered) return { ...item, status: "unsupported" };
      if (!item.actionId) return { ...item, status: "unsupported" };
      if (applied.has(item.actionId)) return { ...item, status: "applied" };
      if (failed.has(item.actionId)) return { ...item, status: "failed" };
      return { ...item, status: "not-run" };
    }),
    ...(failure === undefined ? {} : { failure }),
  };
}
