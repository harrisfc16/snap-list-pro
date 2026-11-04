export const DEFAULT_CONDITION = "Excellent";
export const MAX_KEYWORDS = 35;
export const BASIC_COLORS = ["Black", "White", "Gray", "Brown", "Tan", "Cream", "Red", "Pink", "Orange", "Yellow", "Green", "Blue", "Purple", "Gold", "Silver", "Multicolor"] as const;
export const SKU_CATEGORIES = ["TOP", "BTM", "DRESS", "SHOE", "BAG", "ACC", "OUTER", "DENIM", "PET", "HOME", "OTHER"] as const;
export const STYLE_TERMS = ["vintage", "y2k", "streetwear", "gorpcore", "quiet luxury", "minimalist", "coquette", "balletcore", "grunge", "athleisure"];
const SHADES: Record<string, string> = {
  sage: "Green", olive: "Green", emerald: "Green", forest: "Green", mint: "Green", chartreuse: "Green", teal: "Blue", turquoise: "Blue", aqua: "Blue", navy: "Blue", cobalt: "Blue", indigo: "Blue", denimblue: "Blue", burgundy: "Red", maroon: "Red", wine: "Red", scarlet: "Red", crimson: "Red", blush: "Pink", rose: "Pink", fuchsia: "Pink", magenta: "Pink", coral: "Pink", lavender: "Purple", lilac: "Purple", plum: "Purple", mauve: "Purple", violet: "Purple", beige: "Tan", khaki: "Tan", camel: "Tan", taupe: "Tan", nude: "Tan", sand: "Tan", ivory: "Cream", ecru: "Cream", offwhite: "Cream", oatmeal: "Cream", charcoal: "Gray", grey: "Gray", slate: "Gray", rust: "Orange", peach: "Orange", terracotta: "Orange", mustard: "Yellow", ochre: "Yellow", chocolate: "Brown", espresso: "Brown", chestnut: "Brown", bronze: "Brown", copper: "Brown",
};
export function basicColorText(text: string): string {
  return text.replace(/\b(?:off[ -]?white|denim blue|light|dark|pale|dusty|bright|deep|soft|muted|neon|pastel|jewel[ -]?toned?)\s+(?=(?:black|white|gray|grey|brown|tan|cream|red|pink|orange|yellow|green|blue|purple|gold|silver|sage|navy|olive)\b)/gi, "")
    .replace(/\b(?:off[ -]?white|denim blue|[a-z]+)\b/gi, word => SHADES[word.toLowerCase().replace(/[ -]/g, "")] || word);
}
export function outputText(text: string, skipStyleTags = false): string {
  let result = basicColorText(cleanText(text)).replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]/gu, "");
  if (skipStyleTags) for (const term of STYLE_TERMS) result = result.replace(new RegExp(`\\b${term.replace(/ /g, "[ -]?")}\\b`, "gi"), "");
  return result.replace(/[ \t]{2,}/g, " ").trim();
}
export function itemNumberOutput(includeItemNumber: boolean, consignment: boolean, name: string, sku: string): string {
  return consignment ? `No Item # (${name})` : includeItemNumber ? sku : "No Item #";
}

export function cleanText(text: string): string {
  return text.replace(/\bold[\s-]?money\b/gi, "").replace(/[ \t]{2,}/g, " ").trim();
}

export function normalizeColor(color: string, prominentColors = 0, multicolorPattern = false): string {
  const parts = color.split(/[,/&]|\band\b/i).map(c => c.trim()).filter(Boolean);
  if (prominentColors >= 3 || multicolorPattern || parts.length >= 3 || /multi[- ]?colou?r/i.test(color)) return "Multicolor";
  const basic = basicColorText(color);
  return BASIC_COLORS.find(c => c !== "Multicolor" && new RegExp(`\\b${c}\\b`, "i").test(basic)) || "";
}

export function hasNotedFlaw(notes: string): boolean {
  return notes.split(/[.!?;\n]/).some((line) =>
    !/\b(?:no|without|free of)\s+(?:visible\s+)?(?:flaws?|stains?|holes?|tears?|wear|damage|pilling)/i.test(line) &&
    /\b(?:stain(?:s|ed)?|hole(?:s)?|tear(?:s)?|torn|damage(?:d)?|flaw(?:s)?|pilling|fading|worn|wear|broken|scratch(?:es|ed)?)\b/i.test(line),
  );
}

export function resolveCondition(tagsAttached: boolean, visibleFlaw: boolean, suggested = "", notes = "", unusedRetailPackaging = false, itemType = "Clothing"): string {
  if (visibleFlaw || hasNotedFlaw(notes)) return /fair|poor|heavy|major|broken|torn/i.test(suggested + " " + notes) ? "Fair" : "Good";
  if (itemType !== "Clothing" && unusedRetailPackaging) return "New in box";
  return tagsAttached && itemType === "Clothing" ? "New with tags" : DEFAULT_CONDITION;
}

export function buildSku(categoryCode: string, number: number, date: string): string {
  const category = /^(TOP|BTM|DRESS|SHOE|BAG|ACC|OUTER|DENIM|PET|HOME|OTHER)$/.test(categoryCode) ? categoryCode : "OTHER";
  return `${date}-${category}-${String(number).padStart(3, "0")}`;
}

export function normalizeTitle(title: string, tagsAttached: boolean): string {
  const base = outputText(title).replace(/\b(?:NWT|NWOT)\b/gi, "").replace(/(?<!\d)\.|\.(?!\d)|[^\p{L}\p{N}\s.]/gu, " ").replace(/\s+/g, " ").trim();
  const budget = tagsAttached ? 76 : 80;
  let trimmed = base;
  if (trimmed.length > budget) trimmed = trimmed.slice(0, budget).replace(/\s+\S*$/, "").trim();
  return `${trimmed}${tagsAttached ? " NWT" : ""}`.trim();
}

export function buildSearchTitle(fields: { brand: string; modelName: string; itemType: string; department: string; size: string; color: string; features: string[]; title: string; tagsAttached: boolean; skipStyleTags?: boolean }): string {
  const seen = new Set<string>();
  const titleWords = (text: string) => normalizeTitle(outputText(text, fields.skipStyleTags), false).split(/\s+/).filter(Boolean);
  const uniquePhrase = (text: string) => titleWords(text).filter(word => !seen.has(word.toLowerCase()));
  let title = "";
  const append = (phrase: string) => {
    const words = uniquePhrase(phrase);
    if (!words.length) return;
    const next = [title, words.join(" ")].filter(Boolean).join(" ");
    if (next.length > (fields.tagsAttached ? 76 : 80)) return;
    title = next;
    words.forEach(word => seen.add(word.toLowerCase()));
  };
  const department = /women/i.test(fields.department) ? "Womens" : /\bmen/i.test(fields.department) ? "Mens" : /kid|boy|girl|youth/i.test(fields.department) ? "Kids" : fields.department;
  [fields.brand, fields.modelName, fields.itemType, department, fields.size ? `Size ${fields.size}` : "", fields.color].forEach(append);
  // Keep factual feature phrases intact; skip a phrase that cannot fit and try the next.
  fields.features.forEach(append);
  if (title.length < 75) titleWords(fields.title).forEach(append);
  return normalizeTitle(title || fields.title, fields.tagsAttached);
}

export function selectedCondition(value = ""): string {
  return ["New with tags", "New in box", "New without tags", "Excellent", "Good", "Fair"].includes(value) ? value : DEFAULT_CONDITION;
}

export function formatConditionDescription(condition: string, text: string, skipStyleTags = false): string {
  const details = factualText(text, skipStyleTags).split(/(?<=[.!?])\s+/)
    .filter(line => !/\b(?:condition|excellent|good|fair|new|unused|unworn|NWT|NWOT|pre[- ]?owned|like new|mint|pristine|tags|packaging)\b/i.test(line)).join(" ");
  return `${selectedCondition(condition)}${details ? `. ${details}` : ""}`.slice(0, 200);
}

export function formatSpecificValue(value: unknown): string {
  return (Array.isArray(value) ? value.join(", ") : String(value)).split(/[,;|]\s*/).map(part => part.trim()).filter(Boolean).join(", ");
}

export function formatPriceNote(brand: string, condition: string, itemType: string): string {
  return `${brand || "Unbranded"} ${itemType || "item"}, ${selectedCondition(condition)} condition, informs the suggested list and floor prices. AI estimate. Verify against sold prices below.`;
}

export function soldSearchTerm(brand: string, modelName: string, itemType: string): string {
  return [brand.trim(), modelName.trim() || itemType.trim()].filter(Boolean).join(" ");
}

export function soldSearchLinks(term: string) {
  const query = encodeURIComponent(term.trim());
  return { ebay: `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Sold=1&LH_Complete=1`, poshmark: `https://poshmark.com/search?query=${query}&availability=sold_out&type=listings` };
}

export function validKeywords(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((k) => typeof k === "string" && k.trim().length > 0);
}

export async function withKeywordRecovery<T extends { keywords?: unknown }>(
  request: () => Promise<T>,
  fallback: (listing: T) => string[],
): Promise<Omit<T, "keywords"> & { keywords: string[]; keywordsFallback: boolean }> {
  let listing = await request();
  if (!validKeywords(listing.keywords)) listing = await request();
  const keywordsFallback = !validKeywords(listing.keywords);
  return { ...listing, keywords: keywordsFallback ? fallback(listing) : listing.keywords as string[], keywordsFallback };
}

export function finalizeKeywords(raw: string[], fields: { brand?: string; modelName?: string; department?: string; material?: string; use?: string; itemType?: string; color?: string; size?: string; title: string; itemSpecifics: Record<string, string>; tagsAttached: boolean; unwornWithoutTags?: boolean; skipStyleTags?: boolean; categoryCode?: string }, fallback = false): string[] {
  const department = /women/i.test(fields.department || "") ? "women's" : /\bmen/i.test(fields.department || "") ? "men's" : fields.department;
  const core = [fields.brand, fields.modelName, fields.itemType, department, fields.color, fields.size ? `size ${fields.size}` : "",
    ...Object.entries(fields.itemSpecifics).filter(([key]) => /brand|type|color|style|fit|material|fabric|pattern/i.test(key)).map(([, value]) => value),
    fields.tagsAttached ? "NWT" : ""];
  const candidates = [...core, ...raw, ...(fallback ? [fields.title] : [])];
  const unique = new Map<string, string>();
  const evidence = `${fields.material || ""} ${fields.itemSpecifics.Material || ""} ${fields.itemSpecifics.Fabric || ""}`.toLowerCase();
  const useEvidence = `${fields.itemType || ""} ${fields.use || ""} ${fields.itemSpecifics.Use || ""}`;
  for (const candidate of candidates) {
    if (!candidate || /\bold[\s-]?money\b/i.test(candidate)) continue;
    if (/\b(?:unknown|not visible|placeholder)\b/i.test(candidate)) continue;
    for (const term of outputText(candidate, fields.skipStyleTags).replace(/#/g, "").split(",")) {
      const k = term.trim();
      if (!k || /^[\p{L}\p{N}]$/u.test(k) || /^\d+(?:\.\d+)?$/.test(k) || /^(?:XS|S|M|L|XL|XXL|XXXL|\d+(?:\.\d+)?\s*(?:US|UK|EU)?)$/i.test(k) || SKU_CATEGORIES.includes(k.toUpperCase() as typeof SKU_CATEGORIES[number]) || (!fields.tagsAttached && /\bNWT\b/i.test(k)) || (!fields.unwornWithoutTags && /\bNWOT\b/i.test(k))) continue;
      if (/\bsize\b/i.test(k) && k.toLowerCase() !== `size ${fields.size || ""}`.toLowerCase()) continue;
      const materials = k.toLowerCase().match(/\b(?:cotton|polyester|spandex|elastane|nylon|silk|wool|linen|leather|rayon|viscose|cashmere|acrylic)\b/g) || [];
      if (materials.some(material => !new RegExp(`\\b${material}\\b`).test(evidence))) continue;
      if (/gorpcore|hiking/i.test(k) && !/outdoor|technical|hiking/i.test(useEvidence)) continue;
      if (/athleisure/i.test(k) && !/activewear|lounge|athletic|bike shorts|biker shorts|gym|workout/i.test(useEvidence)) continue;
      if (/running/i.test(k) && !/running/i.test(useEvidence)) continue;
      const key = k.toLowerCase().replace(/[’']/g, "").replace(/\s+blend\b/g, "").trim();
      const previous = unique.get(key);
      if (!previous || k.length < previous.length) unique.set(key, k);
    }
  }
  return [...unique.values()].slice(0, MAX_KEYWORDS);
}

export type DescriptionFacts = {
  title: string; summary: string; size: string; color: string; condition: string;
  styleLine: string; brand: string; itemType: string; material: string; fit: string;
  use: string; features: string[]; keywords: string[]; itemNumber: string;
  skipStyleTags: boolean; categoryCode: string;
};

export function factualText(text: string, skipStyleTags = false): string {
  return outputText(text, skipStyleTags).split(/\n|(?<=[.!?])\s+(?!\d)/)
    .filter(line => !/\b(?:step into|elevate|stunning|introducing|sophisticated|industry[- ]standard|top[- ]tier|comparable|similar to|inspired by|shipping|returns|unknown|not visible|placeholder|measurements?|inches|inch|centimeters?|cm|inseam)\b/i.test(line))
    .filter(line => !/\b\d+(?:\.\d+)?\s*["″]|\b(?:chest|bust|waist|hips?|length|sleeve|shoulders?|rise|thigh)\s*[:=]?\s*\d/i.test(line))
    .join(" ").replace(/#[\p{L}\p{N}_]+/gu, "").trim();
}

export function descriptionHashtags(facts: DescriptionFacts): string[] {
  const hashtag = (value: string) => outputText(value, facts.skipStyleTags).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const core = [facts.brand, facts.itemType, facts.color].map(hashtag).filter(Boolean);
  const terms = [facts.material, facts.fit, facts.use, ...facts.features, ...facts.keywords];
  const candidates = terms.filter(term => term && term !== facts.size && !/\d|\b(?:size|unknown|not visible|placeholder|new with tags|excellent|good|fair)\b/i.test(term))
    .map(hashtag).filter(term => term && !SKU_CATEGORIES.some(code => code.toLowerCase() === term) && !core.includes(term));
  // Use item-derived phrases if the model supplies fewer than two descriptors; never invent a style or brand.
  const fallbacks = [facts.color + facts.itemType, facts.brand + facts.itemType, facts.material + facts.itemType, facts.use + facts.itemType].map(hashtag);
  const unique = [...new Set([...core, ...candidates, ...fallbacks])]
    .filter(term => term && !SKU_CATEGORIES.some(code => code.toLowerCase() === term));
  return unique.slice(0, 5).map(term => `#${term}`);
}

export function formatSharedDescription(facts: DescriptionFacts): string {
  const title = facts.title;
  const summary = factualText(facts.summary, facts.skipStyleTags).split(/(?<=[.!?])\s+(?!\d)/).slice(0, 2).join(" ");
  const details = [facts.size ? `Size: ${outputText(facts.size)}` : "", facts.color ? `Color: ${normalizeColor(facts.color)}` : "", `Condition: ${outputText(facts.condition)}`].filter(Boolean).join("\n");
  const tags = descriptionHashtags(facts).join(" ");
  const suffix = `\n\n${tags}\n\n${facts.itemNumber}`;
  const style = factualText(facts.styleLine, facts.skipStyleTags);
  const fixed = `${title}\n\n\n\n${details}${suffix}`;
  let remaining = Math.max(0, 899 - fixed.length);
  const shorten = (text: string, budget: number) => text.length <= budget ? text : text.slice(0, budget).replace(/\s+\S*$/, "").trim();
  const prose = shorten(summary, remaining);
  remaining -= prose.length;
  const styleLine = style && remaining > 1 ? `\n${shorten(style, remaining - 1)}` : "";
  return `${title}\n\n${prose}\n\n${details}${styleLine}${suffix}`;
}

