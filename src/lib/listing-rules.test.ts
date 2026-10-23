import { describe, expect, test } from "bun:test";
import { buildSku, DEFAULT_CONDITION, finalizeKeywords, formatDescription, normalizeColor, normalizeTitle, resolveCondition, withKeywordRecovery } from "./listing-rules";

describe("listing requirements", () => {
  test("condition defaults to Excellent and tags are required for New with tags", () => {
    expect(DEFAULT_CONDITION).toBe("Excellent");
    expect(resolveCondition(false, false, "Good")).toBe("Excellent");
    expect(resolveCondition(true, false)).toBe("New with tags");
  });
  test("condition is lowered only for photo or noted flaws", () => {
    expect(resolveCondition(false, true, "Good")).toBe("Good");
    expect(resolveCondition(false, false, "", "Small stain on front")).toBe("Good");
    expect(resolveCondition(false, false, "", "No visible wear or stains")).toBe("Excellent");
  });
  test("three prominent colors and multicolor patterns normalize Color", () => {
    expect(normalizeColor("red, blue, green")).toBe("Multicolor");
    expect(normalizeColor("floral", 2, true)).toBe("Multicolor");
    expect(normalizeColor("navy", 1)).toBe("navy");
  });
  test("item number uses exact date/category/three-digit number", () => {
    expect(`Item# ${buildSku("DRESS", 1, "20260614")}`).toBe("Item# 20260614-DRESS-001");
  });
  test("NWT is evidence-gated and titles stay under 80 characters", () => {
    expect(normalizeTitle("Acme dress NWT", false)).toBe("Acme dress");
    expect(normalizeTitle("Acme " + "dress ".repeat(30), true).length).toBeLessThanOrEqual(80);
    expect(normalizeTitle("Acme dress", true)).toBe("Acme dress NWT");
  });
  test("all descriptions share a title-first opening and exact item number", () => {
    for (const platform of ["ebay", "poshmark", "depop"] as const) {
      const text = formatDescription(platform, "Cotton wide leg trousers.", "Acme Trousers 10 Sage", "20260614-DRESS-001", ["cotton"], false);
      expect(text.startsWith("Acme Trousers 10 Sage\n\n")).toBe(true);
      expect(text).toContain("Item# 20260614-DRESS-001");
    }
  });
  test("eBay complete copied description is at most 1000 characters", () => {
    expect(formatDescription("ebay", "Cotton fabric. ".repeat(200), "Acme Dress", "20260614-DRESS-001", Array.from({length: 35}, (_, i) => `keyword ${i}`), false).length).toBeLessThanOrEqual(1000);
  });
  test("Poshmark complete copied description is at most 1000 words", () => {
    expect(formatDescription("poshmark", "cotton ".repeat(2000), "Acme Dress", "20260614-DRESS-001", ["cotton"], false).split(/\s+/).length).toBeLessThanOrEqual(1000);
  });
  test("only Depop allows explicitly supplied measurements", () => {
    for (const platform of ["ebay", "poshmark"] as const) expect(formatDescription(platform, "Bust: 20 inches\nCotton fabric", "Acme Dress", "20260614-DRESS-001", [], false)).not.toContain("20 inches");
    expect(formatDescription("depop", "Bust: 20 inches", "Acme Dress", "20260614-DRESS-001", [], false)).toContain("20 inches");
  });
  test("Depop ends with no more than five hashtags", () => {
    const text = formatDescription("depop", "Cotton dress", "Acme Dress", "20260614-DRESS-001", ["acme", "dress", "cotton", "midi", "sage", "summer"], false);
    expect(text.match(/#/g)?.length).toBe(6); // Item# plus five hashtags.
    expect(text.endsWith("#sage")).toBe(true);
  });
  test("keywords include known fields, cap at 35, omit banned phrases and unsupported NWT", () => {
    const terms = finalizeKeywords(["old money", "NWT", ...Array.from({ length: 40 }, (_, i) => `style ${i}`)], { title: "Acme Dress", brand: "Acme", itemType: "Dress", size: "M", color: "Multicolor", itemSpecifics: {Material: "Cotton"}, tagsAttached: false });
    expect(terms.length).toBe(35);
    expect(terms.slice(0, 5)).toEqual(["Acme", "Dress", "Multicolor", "M", "Cotton"]);
    expect(terms).not.toContain("NWT");
    expect(terms).not.toContain("old money");
  });
  test("malformed keywords retry once then use fallback", async () => {
    let calls = 0;
    const result = await withKeywordRecovery(async () => { calls++; return {keywords: null}; }, () => ["Acme", "Dress"]);
    expect(calls).toBe(2);
    expect(result.keywords).toEqual(["Acme", "Dress"]);
    expect(result.keywordsFallback).toBe(true);
  });
  test("valid keywords never retry", async () => {
    let calls = 0;
    const result = await withKeywordRecovery(async () => { calls++; return {keywords: ["dress"]}; }, () => []);
    expect(calls).toBe(1);
    expect(result.keywordsFallback).toBe(false);
  });
  test("terminal provider errors are not retried", async () => {
    let calls = 0;
    await expect(withKeywordRecovery(async () => { calls++; throw new Error("403 denied"); }, () => [])).rejects.toThrow("403 denied");
    expect(calls).toBe(1);
  });
});