export type CatalogTier = "free" | "premium";

export interface Tweak {
  id: number;
  name: string;
  category: string;
  risk: "low" | "medium" | "high";
}

export interface Catalog {
  tier: CatalogTier;
  tweaks: Tweak[];
  declaredCount?: number;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TWEAKS = 2_000;

export function parseCatalog(text: string, tier: CatalogTier): Catalog {
  if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) {
    throw new Error("Catalog is larger than the 2 MB import limit.");
  }

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!input || typeof input !== "object" || !("tweaks" in input)) {
    throw new Error("Expected a catalog object with a tweaks array.");
  }

  const raw = (input as { tweaks?: unknown }).tweaks;
  if (!Array.isArray(raw) || raw.length > MAX_TWEAKS) {
    throw new Error("The catalog must contain at most 2,000 tweak records.");
  }

  const ids = new Set<number>();
  const tweaks = raw.map((entry, index): Tweak => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Tweak ${index + 1} is not an object.`);
    }
    const item = entry as Record<string, unknown>;
    if (
      !Number.isSafeInteger(item.id) ||
      typeof item.id !== "number" ||
      item.id < 1 ||
      ids.has(item.id)
    ) {
      throw new Error(`Tweak ${index + 1} has a missing, invalid, or duplicate id.`);
    }
    if (
      typeof item.name !== "string" ||
      item.name.trim().length === 0 ||
      item.name.length > 160 ||
      typeof item.category !== "string" ||
      item.category.trim().length === 0 ||
      item.category.length > 80 ||
      !["low", "medium", "high"].includes(String(item.risk).toLowerCase())
    ) {
      throw new Error(`Tweak ${index + 1} has invalid metadata.`);
    }
    ids.add(item.id);
    return {
      id: item.id,
      name: item.name.trim(),
      category: item.category.trim(),
      risk: String(item.risk).toLowerCase() as Tweak["risk"],
    };
  });

  const declaredCount = (input as { count?: unknown }).count;
  return {
    tier,
    tweaks,
    declaredCount:
      typeof declaredCount === "number" && Number.isSafeInteger(declaredCount)
        ? declaredCount
        : undefined,
  };
}

export function formatCount(catalog: Catalog): string {
  if (catalog.declaredCount !== undefined && catalog.declaredCount !== catalog.tweaks.length) {
    return `${catalog.tweaks.length} records (file declares ${catalog.declaredCount})`;
  }
  return `${catalog.tweaks.length} records`;
}
