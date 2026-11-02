import { describe, expect, test } from "bun:test";
import { buildSku, DEFAULT_CONDITION, finalizeKeywords, formatSharedDescription, descriptionHashtags, itemNumberOutput, SKU_CATEGORIES, outputText, normalizeColor, normalizeTitle, resolveCondition, withKeywordRecovery } from "./listing-rules";

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
    expect(normalizeColor("navy", 1)).toBe("Blue");
    expect(normalizeColor("sage")).toBe("Green");
    expect(normalizeColor("burgundy")).toBe("Red");
    expect(normalizeColor("blush")).toBe("Pink");
  });
  test("item number uses exact date/category/three-digit number", () => {
    expect(`Item# ${buildSku("DRESS", 1, "20260614")}`).toBe("Item# 20260614-DRESS-001");
  });
  test("NWT is evidence-gated and titles stay under 80 characters", () => {
    expect(normalizeTitle("Acme dress NWT", false)).toBe("Acme dress");
    expect(normalizeTitle("Acme " + "dress ".repeat(30), true).length).toBeLessThanOrEqual(80);
    expect(normalizeTitle("Acme dress", true)).toBe("Acme dress NWT");
  });
  const facts = {
    title: "Acme Wide Leg Pants Size 7.5 Green Pleated", summary: "Cotton pants with a wide leg fit.",
    size: "7.5", color: "Green", condition: "Excellent", styleLine: "Style: Workwear", brand: "Acme",
    itemType: "Pants", material: "Cotton", fit: "Wide leg", use: "Workwear", features: ["Pleated"],
    keywords: ["sage", "quiet luxury"], itemNumber: "20261102-BTM-001", skipStyleTags: false, categoryCode: "BTM",
  };
  test("item number defaults, opt-out and consignment precedence are exact", () => {
    expect(itemNumberOutput(true, false, "", "20261102-OTHER-001")).toBe("20261102-OTHER-001");
    expect(itemNumberOutput(false, false, "", "20261102-OTHER-001")).toBe("No Item #");
    expect(itemNumberOutput(true, true, "Jane", "20261102-OTHER-001")).toBe("No Item # (Jane)");
    expect(itemNumberOutput(false, true, " Jane ", "20261102-OTHER-001")).toBe("No Item # ( Jane )");
  });
  test("allowed categories include PET and exclude removed codes", () => {
    expect(SKU_CATEGORIES).toEqual(["TOP", "BTM", "DRESS", "SHOE", "BAG", "ACC", "OUTER", "DENIM", "PET", "HOME", "OTHER"]);
    expect(buildSku("PET", 1, "20261102")).toBe("20261102-PET-001");
    expect(buildSku("JEWEL", 1, "20261102")).toBe("20261102-OTHER-001");
  });
  test("description has shared plain title, separate details and item number last", () => {
    const text = formatSharedDescription(facts);
    expect(text.startsWith(facts.title + "\n\n")).toBe(true);
    expect(text).toContain("Size: 7.5\nColor: Green\nCondition: Excellent");
    expect(text.endsWith("\n\n20261102-BTM-001")).toBe(true);
    expect(text).not.toContain("Keywords:");
  });
  test("description including hashtags and item number is strictly under 900", () => {
    const text = formatSharedDescription({...facts, summary: "Cotton material with pleated detailing ".repeat(80)});
    expect(text.length).toBeLessThan(900);
    expect(text.endsWith(facts.itemNumber)).toBe(true);
  });
  test("no measurements, emoji, filler or comparison claims in description", () => {
    const text = formatSharedDescription({...facts, summary: "Step into stunning fashion. Cotton pants. Bust: 20 inches. Similar to Gucci. Industry-standard quality. 🛍️", styleLine: "Waist 30 cm"});
    expect(text).toContain("Cotton pants.");
    expect(text).not.toMatch(/Step into|stunning|Gucci|industry-standard|20 inches|30 cm|🛍/i);
  });
  test("exactly five hashtags: brand, type, color and two factual descriptors, no sizes or codes", () => {
    const tags = descriptionHashtags(facts);
    expect(tags).toEqual(["#acme", "#pants", "#green", "#cotton", "#wideleg"]);
    expect(tags).not.toContain("#75");
    expect(tags).not.toContain("#btm");
  });
  test("skip style tags removes all selected aesthetics across text and keywords", () => {
    expect(outputText("Vintage y2k quiet luxury green cotton", true)).toBe("green cotton");
    const terms = finalizeKeywords(["vintage", "quiet luxury", "cotton"], {...facts, itemSpecifics: {}, tagsAttached: false, skipStyleTags: true});
    expect(terms).not.toContain("vintage");
    expect(terms).not.toContain("quiet luxury");
    expect(formatSharedDescription({...facts, summary: "Vintage cotton pants.", skipStyleTags: true})).not.toMatch(/vintage|quietluxury/i);
  });
  test("half sizes preserve decimal period in title and keywords", () => {
    expect(normalizeTitle("Acme Shoes Size 7.5 Sage!", false)).toBe("Acme Shoes Size 7.5 Green");
    expect(finalizeKeywords(["7.5"], {...facts, itemSpecifics: {}, tagsAttached: false})).toContain("7.5");
  });
  test("unused retail packaging gives non-clothing New in box only", () => {
    expect(resolveCondition(false, false, "", "", true, "Electronics")).toBe("New in box");
    expect(resolveCondition(false, false, "", "", false, "Electronics")).toBe("Excellent");
    expect(resolveCondition(false, true, "Good", "", true, "Electronics")).toBe("Good");
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