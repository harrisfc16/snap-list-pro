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

export function finalizeKeywords(raw: string[], fields: { brand?: string; itemType?: string; color?: string; size?: string; title: string; itemSpecifics: Record<string, string>; tagsAttached: boolean; unwornWithoutTags?: boolean; skipStyleTags?: boolean; categoryCode?: string }, fallback = false): string[] {
  const core = [fields.brand, fields.itemType, fields.color, fields.size,
    ...Object.entries(fields.itemSpecifics).filter(([key]) => /brand|type|color|size|style|fit|material|fabric|pattern/i.test(key)).map(([, value]) => value),
    fields.tagsAttached ? "NWT" : ""];
  const candidates = [...core, ...raw, ...(fallback ? [fields.title, ...fields.title.split(/\s+/)] : [])];
  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate || /\bold[\s-]?money\b/i.test(candidate)) continue;
    for (const term of outputText(candidate, fields.skipStyleTags).replace(/#/g, "").split(",")) {
      const k = term.trim();
      if (!k || SKU_CATEGORIES.includes(k.toUpperCase() as typeof SKU_CATEGORIES[number]) || (!fields.tagsAttached && /\bNWT\b/i.test(k)) || (!fields.unwornWithoutTags && /\bNWOT\b/i.test(k))) continue;
      if (!unique.has(k.toLowerCase())) unique.set(k.toLowerCase(), k);
    }
  }
  return [...unique.values()].slice(0, MAX_KEYWORDS);
}

