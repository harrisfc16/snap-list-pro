export const DEFAULT_CONDITION = "Excellent";
export const MAX_KEYWORDS = 35;

export function cleanText(text: string): string {
  return text.replace(/\bold[\s-]?money\b/gi, "").replace(/[ \t]{2,}/g, " ").trim();
}

export function normalizeColor(color: string, prominentColors: number = 0, multicolorPattern = false): string {
  const colors = color.split(/[,/&]|\band\b/i).map((c) => c.trim()).filter(Boolean);
  return prominentColors >= 3 || multicolorPattern || colors.length >= 3 || /multi[- ]?colou?r/i.test(color)
    ? "Multicolor" : cleanText(color);
}

export function hasNotedFlaw(notes: string): boolean {
  return notes.split(/[.!?;\n]/).some((line) =>
    !/\b(?:no|without|free of)\s+(?:visible\s+)?(?:flaws?|stains?|holes?|tears?|wear|damage|pilling)/i.test(line) &&
    /\b(?:stain(?:s|ed)?|hole(?:s)?|tear(?:s)?|torn|damage(?:d)?|flaw(?:s)?|pilling|fading|worn|wear|broken|scratch(?:es|ed)?)\b/i.test(line),
  );
}

export function resolveCondition(tagsAttached: boolean, visibleFlaw: boolean, suggested = "", notes = ""): string {
  if (visibleFlaw || hasNotedFlaw(notes)) return /fair|poor|heavy|major|broken|torn/i.test(suggested + " " + notes) ? "Fair" : "Good";
  return tagsAttached ? "New with tags" : DEFAULT_CONDITION;
}

export function buildSku(categoryCode: string, number: number, date: string): string {
  const category = /^(TOP|BTM|DRESS|SHOE|BAG|PURSE|JEWEL|ACC|OUTER|DENIM|ELEC|HOME|COLLECT|BEAUTY|TOY|BOOK|OTHER)$/.test(categoryCode) ? categoryCode : "OTHER";
  return `${date}-${category}-${String(number).padStart(3, "0")}`;
}

export function normalizeTitle(title: string, tagsAttached: boolean): string {
  const base = cleanText(title).replace(/\b(?:NWT|NWOT)\b/gi, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
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

export function finalizeKeywords(raw: string[], fields: { brand?: string; itemType?: string; color?: string; size?: string; title: string; itemSpecifics: Record<string, string>; tagsAttached: boolean; unwornWithoutTags?: boolean }, fallback = false): string[] {
  const core = [fields.brand, fields.itemType, fields.color, fields.size,
    ...Object.entries(fields.itemSpecifics).filter(([key]) => /brand|type|color|size|style|fit|material|fabric|pattern/i.test(key)).map(([, value]) => value),
    fields.tagsAttached ? "NWT" : ""];
  const candidates = [...core, ...raw, ...(fallback ? [fields.title, ...fields.title.split(/\s+/)] : [])];
  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate || /\bold[\s-]?money\b/i.test(candidate)) continue;
    for (const term of cleanText(candidate).replace(/#/g, "").split(",")) {
      const k = term.trim();
      if (!k || (!fields.tagsAttached && /\bNWT\b/i.test(k)) || (!fields.unwornWithoutTags && /\bNWOT\b/i.test(k))) continue;
      if (!unique.has(k.toLowerCase())) unique.set(k.toLowerCase(), k);
    }
  }
  return [...unique.values()].slice(0, MAX_KEYWORDS);
}

function descriptionBody(text: string, title: string, allowMeasurements: boolean): string {
  let body = cleanText(text).replace(/Item#\s*[^\s]+/gi, "").replace(/^Keywords:.*$/gim, "").replace(/#[\p{L}\p{N}_]+/gu, "");
  const lines = body.split("\n");
  if (lines[0]?.trim() === title || (lines.length > 1 && lines[1]?.trim() === "" && !/[.!?]$/.test(lines[0] ?? ""))) lines.shift();
  body = lines.filter((line) => !/^(?:elevate your wardrobe|step into|introducing|stunning|sophisticated)\b/i.test(line.trim()))
    .filter((line) => !/shipping|returns|not visible|unknown|\[placeholder\]/i.test(line))
    .filter((line) => allowMeasurements || !/\b(?:measurements?|inches|inch|cm|centimeters?|inseam)\b|\b\d+(?:\.\d+)?\s*["″]|\b(?:chest|bust|waist|hips?|length|sleeve|shoulders?|rise|thigh)\s*[:=]?\s*\d/i.test(line))
    .join("\n").trim();
  return body.replace(/\n{3,}/g, "\n\n");
}

export function formatDescription(platform: "ebay" | "poshmark" | "depop", text: string, title: string, sku: string, keywords: string[], tagsAttached: boolean): string {
  const header = `${title}\n\n`;
  const body = descriptionBody(text, title, platform === "depop").replace(/\b(?:NWT|NWOT)\b/gi, "").trim();
  const item = `Item# ${sku}`;
  const hashtagLimit = platform === "depop" ? 5 : 20;
  const hashtags = [...new Set(keywords.map((k) => `#${k.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()}`).filter((k) => k.length > 1))].slice(0, hashtagLimit).join(" ");
  const condition = tagsAttached ? "New with tags (NWT)." : "";
  const footer = platform === "ebay" ? `${item}\n\nKeywords: ${keywords.join(", ")}` : `${item}\n\n${hashtags}`;
  const contents = [body, condition].filter(Boolean).join("\n\n");
  if (platform === "poshmark") {
    const reservedWords = `${header} ${footer}`.split(/\s+/).filter(Boolean).length;
    return `${header}${contents.split(/\s+/).slice(0, 1000 - reservedWords).join(" ")}\n\n${footer}`;
  }
  // Reserve space for the title, SKU and keyword suffix before shortening the factual body.
  let suffix = `\n\n${footer}`;
  if (platform === "ebay" && suffix.length > 420) {
    const shortKeywords: string[] = [];
    for (const keyword of keywords) {
      if ((shortKeywords.join(", ") + ", " + keyword).length > 350) break;
      shortKeywords.push(keyword);
    }
    suffix = `\n\n${item}\n\nKeywords: ${shortKeywords.join(", ")}`;
  }
  const available = Math.max(0, 1000 - header.length - suffix.length);
  return `${header}${contents.slice(0, available).trim()}${suffix}`;
}