import { describe, expect, it } from "vitest";
import { formatCount, parseCatalog } from "./catalog";

describe("parseCatalog", () => {
  it("accepts metadata-only catalogs and ignores extra executable-looking fields", () => {
    const catalog = parseCatalog(
      JSON.stringify({
        count: 4,
        tweaks: [
          {
            id: 1,
            name: "A tweak",
            category: "Performance",
            risk: "low",
            command: "do not execute",
          },
        ],
      }),
      "free",
    );

    expect(catalog.tweaks).toEqual([
      { id: 1, name: "A tweak", category: "Performance", risk: "low" },
    ]);
    expect(formatCount(catalog)).toBe("1 records (file declares 4)");
  });

  it("rejects duplicate ids instead of making item selection ambiguous", () => {
    const record = { id: 1, name: "One", category: "System", risk: "low" };
    expect(() =>
      parseCatalog(JSON.stringify({ tweaks: [record, record] }), "premium"),
    ).toThrow(/duplicate id/);
  });

  it("rejects invalid metadata and oversized imports", () => {
    expect(() =>
      parseCatalog(
        JSON.stringify({ tweaks: [{ id: 1, name: "x", category: "y", risk: "unknown" }] }),
        "free",
      ),
    ).toThrow(/invalid metadata/);
    expect(() => parseCatalog(" ".repeat(2 * 1024 * 1024 + 1), "free")).toThrow(/2 MB/);
  });
});
