import type { Tweak } from "./catalog";

const ACTION_ID = "reduce-ui-motion";

interface CatalogMapping {
  id: number;
  name: string;
  category: string;
  risk: Tweak["risk"];
  platform: string;
  actionId: string;
  warning?: string;
}

const CATALOG_MAPPINGS: CatalogMapping[] = [
  {
    id: 176,
    name: "Disable Transparency Effects",
    category: "Visual",
    risk: "low",
    platform: "Windows",
    actionId: "disable-transparency",
  },
  {
    id: 177,
    name: "Disable Window Animations",
    category: "Visual",
    risk: "low",
    platform: "Windows",
    actionId: ACTION_ID,
  },
  {
    id: 185,
    name: "Enable Dark Mode",
    category: "Visual",
    risk: "low",
    platform: "Windows",
    actionId: "enable-dark-mode",
  },
  {
    id: 201,
    name: "Show File Extensions",
    category: "Explorer",
    risk: "low",
    platform: "Windows",
    actionId: "show-file-extensions",
  },
  {
    id: 202,
    name: "Show Hidden Files",
    category: "Explorer",
    risk: "low",
    platform: "Windows",
    actionId: "show-hidden-files",
    warning: "This displays hidden files but does not change the separate protected-operating-system-files setting.",
  },
  {
    id: 204,
    name: "Open Explorer to This PC",
    category: "Explorer",
    risk: "low",
    platform: "Windows",
    actionId: "explorer-this-pc",
  },
  {
    id: 205,
    name: "Disable Quick Access Recent Files",
    category: "Explorer",
    risk: "low",
    platform: "Windows",
    actionId: "disable-quick-access-recent",
    warning: "This hides the recent-files list; it does not erase existing file history.",
  },
  {
    id: 206,
    name: "Disable Quick Access Frequent Folders",
    category: "Explorer",
    risk: "low",
    platform: "Windows",
    actionId: "disable-quick-access-frequent",
    warning: "This hides the frequent-folders list; it does not erase existing file history.",
  },
];

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
  warning?: string;
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
  appliedActionIds: string[],
): ApplyPlan {
  const items = tweaks.map((tweak): BatchItemResult => {
    const mapping = CATALOG_MAPPINGS.find(
      (candidate) =>
        candidate.id === tweak.id &&
        candidate.name === tweak.name &&
        candidate.category === tweak.category &&
        candidate.risk === tweak.risk,
    );
    if (!mapping) {
      return { id: tweak.id, name: tweak.name, category: tweak.category, risk: tweak.risk, status: "unsupported" };
    }
    if (mapping.platform !== platform) {
      return {
        ...tweak,
        status: "unsupported",
        platform: mapping.platform,
        warning: `This verified action is available on ${mapping.platform} only.`,
      };
    }
    if (!nativeRuntime || !nativeActionSupported) {
      return { ...tweak, status: "unavailable", platform: mapping.platform, warning: mapping.warning };
    }
    if (appliedActionIds.includes(mapping.actionId)) {
      return { ...tweak, status: "already-applied", actionId: mapping.actionId, platform: mapping.platform, warning: mapping.warning };
    }
    return { ...tweak, status: "ready", actionId: mapping.actionId, platform: mapping.platform, warning: mapping.warning };
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
