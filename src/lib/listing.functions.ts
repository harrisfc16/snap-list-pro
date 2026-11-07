import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";

import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { buildSku, buildSearchTitle, selectedCondition, cleanBrand, formatSpecificValue, formatPriceNote, cleanText, finalizeKeywords, formatSharedDescription, factualText, outputText, itemNumberOutput, STYLE_TERMS, BASIC_COLORS, SKU_CATEGORIES, normalizeColor, normalizeTitle, resolveCondition, validKeywords, withKeywordRecovery } from "./listing-rules";

const PhotoSchema = z.object({
  dataUrl: z.string().min(20),
  label: z.string().optional(),
});

const InputSchema = z.object({
  photos: z.array(PhotoSchema).min(1).max(8),
  brand: z.string().optional(),
  modelName: z.string().max(160).optional(),
  size: z.string().optional(),
  condition: z.string().optional(),
  notes: z.string().optional(),
  skuNumber: z.number().int().min(0).max(99999).optional(),
  itemType: z.string().optional(),
  color: z.string().optional(),
  includeItemNumber: z.boolean().default(true),
  consignment: z.boolean().default(false),
  consignerName: z.string().max(120).refine(name => !/[\r\n]/.test(name), "Use a single-line consigner name").default(""),
  skipStyleTags: z.boolean().default(false),
  listingDate: z.string().regex(/^\d{8}$/),
});

const ListingSchema = z.object({
  modelName: z.string(),
  brand: z.string(),
  itemType: z.string(),
  categoryCode: z.string().describe(`One of: ${SKU_CATEGORIES.join(", ")}`),
  title: z.string().describe("eBay title, max 80 characters"),
  itemSpecifics: z.record(z.string(), z.string()).describe("Key-value pairs like Brand, Size, Color, Material, Type, Model, Features. Only include fields you can determine."),
  description: z.string(),
  itemNumber: z.string(),
  priceList: z.number(),
  sku: z.string(),
  keywordsFallback: z.boolean(),
  categoryEbay: z.string().describe("Full eBay category path"),
  categoryPoshmark: z.string().describe("Full Poshmark category path"),
  keywords: z.array(z.string()).describe("up to 35, quality over count"),
  priceFloor: z.number(),
  priceNote: z.string().optional().default(""),
});

const looseString = z.preprocess((value) => (typeof value === "string" ? value : ""), z.string());

const ListingResultSchema = z.object({
  categoryCode: looseString,
  title: looseString,
  itemSpecifics: z.record(z.unknown()).transform(values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, formatSpecificValue(value)]))).catch({}),
  summary: looseString,
  styleLine: looseString,
  itemType: looseString,
  brand: looseString,
  modelName: looseString,
  department: looseString,
  size: looseString,
  color: looseString,
  material: looseString,
  fit: looseString,
  use: looseString,
  features: z.array(z.string()).catch([]),
  unusedRetailPackaging: z.boolean().catch(false),
  retailTagsAttached: z.boolean().catch(false),
  unwornWithoutTags: z.boolean().catch(false),
  visibleFlaw: z.boolean().catch(false),
  prominentColorCount: z.coerce.number().catch(0),
  multicolorPattern: z.boolean().catch(false),
  categoryEbay: looseString,
  categoryPoshmark: looseString,
  keywords: z.array(z.coerce.string()).catch([]),
  priceList: z.coerce.number().catch(0),
  priceFloor: z.coerce.number().catch(0),
  priceNote: looseString,
});

const DetectionResultSchema = z.object({
  unusedRetailPackaging: z.boolean().catch(false),
  photos: z.array(z.object({ index: z.coerce.number().catch(0), label: z.coerce.string().catch("") })).catch([]),
  brand: looseString,
  modelName: looseString,
  size: looseString,
  color: looseString,
  condition: looseString,
  itemType: looseString,
  retailTagsAttached: z.boolean().catch(false),
  visibleFlaw: z.boolean().catch(false),
  prominentColorCount: z.coerce.number().catch(0),
  multicolorPattern: z.boolean().catch(false),
});

const EMPTY_DETECTION = { photos: [], brand: "", modelName: "", size: "", color: "", condition: "", itemType: "" };

function aiErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (/too many requests|rate limit|\b429\b/i.test(message)) {
    return "AI is receiving too many photo requests right now. Please wait a moment, then try again.";
  }
  if (/credits|payment required|\b402\b/i.test(message)) {
    return "AI credits are exhausted for this workspace.";
  }
  return "AI could not finish this request. Please try again.";
}

function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  return JSON.parse(raw.slice(start, end + 1));
}

export const generateListing = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const userText = [
      "Generate an accurate resale listing from photos. Read only legible tag details and visually supported facts; omit unknowns. No invented brands, material, sizes, or flaws.",
      `User facts: Brand=${data.brand || "read tag"}; Model/product name=${data.modelName || "read only if confident"}; Size=${data.size || "read tag"}; Color=${normalizeColor(data.color || "") || "detect"}; Condition=${data.condition || "Excellent"}; Item type=${data.itemType || "detect"}; Notes=${data.notes || "none"}.`,
      `Photos: ${data.photos.map((p, i) => `${i+1}: ${p.label || "unlabeled"}`).join("; ")}`,
      `categoryCode: exactly one of ${SKU_CATEGORIES.join(", ")}. Use PET for pet supplies, ACC for jewelry/accessories, BAG for purses/bags, HOME for home goods; OTHER only if nothing fits. Category codes are inventory labels, never keywords or hashtags.`,
      "title: Target 75–80 characters, NEVER over 80. Ordered Brand + model/product name + specific buyer-search item type (biker shorts not generic athletic shorts) + department Womens/Mens/Kids + Size + basic color + 2–3 factual key details. No repeated words. Use all relevant available search terms, never invented padding. Max 80 characters. Plain text, no emojis or symbols EXCEPT a decimal period between digits: size 7.5 must remain 7.5, never 7 5. No filler words. Include NWT only if original retail tags visibly attached.",
      `Colors everywhere: only ${BASIC_COLORS.join(", ")}. Map shades to nearest basic color (sage/olive => Green, navy => Blue, burgundy => Red, blush => Pink). Multicolor only for 3+ prominent colors or multicolor print. No shade names in any output.`,
      "modelName: exact model/product line confidently read from tags/photos, otherwise empty. department: known Womens, Mens or Kids, otherwise empty. Features ordered by search value, only supported facts. User-edited modelName takes precedence.",
      "summary: 1-2 short factual sentences using ONLY facts from the user fields, Notes, or legible tags. If there are few facts, write one short sentence (for example 'Jade bangle bracelet in green.') or return an empty string. Never pad.",
      "Do not claim hand carved, polished, genuine, authentic, certified, solid, handmade, antique, or any grade or origin unless it appears in Notes or on a tag. Natural stone is allowed for stone items such as jade. Minimalist is allowed for simple, plain jewelry and accessories.",
      "styleLine: only when Notes or clearly visible facts support it, otherwise empty. No 'pairs well with' lines.",
      "features: only facts from Notes, tags or user fields, with no visual guesses. Apply the same rule to the title, itemSpecifics and keywords.",
      "summary must contain NO title, headings, keyword lists, hashtags, brand comparisons, other brands, emojis, measurements or promotional claims. No Step into, Elevate, Stunning, Introducing, industry-standard, top-tier. Only own brand may appear.",
      "Return factual fields brand, itemType (specific e.g. basket muzzle or wide leg pants, not Clothing), size, color, material, fit, use, features (short array), styleLine (only if Notes or clearly visible facts support it, otherwise empty). No measurements anywhere even if in Notes. Never suggest requesting measurements. App formats one description with separate lines and exactly 5 hashtags for all platforms under 900 characters.",
      "brand, modelName and size must be an empty string unless clearly legible on a tag or label. Never return Unknown, Unbranded, N/A, None or similar. When brand is empty, omit it everywhere: no Brand row, no brand keyword or hashtag, and start the title with the material or item type.",
      "itemSpecifics: only known fields. Brand, Size, Color, Material, Type, Fit, Use, Features where applicable. Omit clothing-only fields for non-clothing. Never measurements. Only own brand.",
      "retailTagsAttached: true ONLY if original retail hangtags attached; sewn-in care/brand/size labels do not count. unusedRetailPackaging: true only if original unopened/retail packaging is visible AND item visibly unused. unwornWithoutTags: true only if visibly unworn without tags. visibleFlaw: true only for clearly visible flaws.",
      `Selected condition is authoritative: ${selectedCondition(data.condition)}. Use that EXACT condition in all sections including summary, specifics and price. Do not substitute photo-inferred condition. NWT only if selected New with tags AND attached retail tags; NWOT only if selected New without tags AND visibly unworn.`,
      "prominentColorCount: number; multicolorPattern: boolean. Set color and specifics Color to Multicolor for 3+ prominent colors or multicolor pattern.",
      `The ONLY allowed aesthetic style terms are ${STYLE_TERMS.join(", ")}; choose only truly fitting ones. Older aesthetic lists are replaced entirely. Otherwise choose specific accurate fabric/fit/use/occasion terms. ${data.skipStyleTags ? "Skip style tags is YES: prohibit ALL of these aesthetic terms in EVERY output, including title, description, specifics, condition, categories, keywords, prices." : "Skip style tags is NO: use aesthetic terms only if genuinely supported."}`,
      "keywords: REQUIRED nonempty array, up to 35, quality over count; stop when relevant terms run out. No single-letter or size-only entries; size once as size M (actual size). No duplicates/near duplicates: recycled polyester, not also recycled polyester blend. Include known department (women's/men's) and accurate common item phrases such as bike shorts, gym shorts, workout shorts. Materials/claims only if tag or clearly visible; never guess spandex. Gorpcore only outdoor/technical hiking gear; athleisure only activewear/lounge. No running/hiking unless made for it. Most relevant first. Include known own brand, specific item type, basic color, size (preserve decimal), material, fit, use/occasion. Never category codes, other brands, inaccurate terms, or keyword stuffing. Never use the banned phrase old money, including compressed hashtags.",
      "Hashtags will use own brand, specific item type, basic color, plus two accurate style/feature/use terms; never size tags or category codes. Supply at least two accurate material/fit/use/features terms when supported.",
      "categoryEbay and categoryPoshmark: full platform category paths. priceList: ONE whole USD suggested list price for every platform. priceFloor: whole USD minimum. priceNote: specific known brand, selected condition and item type driving price; no vague sought-after claims. End exactly AI estimate. Verify against sold prices below. No alternate platform price fields.",
    ].join("\n");

    try {
      const request = async () => {
      const result = await generateText({
        model,
        maxRetries: 0,
        maxOutputTokens: 8000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${userText}\n\nReturn ONLY a valid JSON object with keys: categoryCode, title, itemSpecifics, summary, styleLine, brand, modelName, department, itemType, size, color, material, fit, use, features, categoryEbay, categoryPoshmark, keywords, priceList, priceFloor, priceNote, retailTagsAttached, unusedRetailPackaging, unwornWithoutTags, visibleFlaw, prominentColorCount, multicolorPattern. No markdown`,
              },
              ...data.photos.map((p) => ({
                type: "image" as const,
                image: p.dataUrl,
              })),
            ],
          },
        ],
      });

      let raw: unknown;
      try { raw = parseJsonObject(result.text); } catch { raw = {}; }
      const parsed = ListingResultSchema.parse(raw);
      const rawKeywords = raw && typeof raw === "object" && "keywords" in raw ? raw.keywords : undefined;
      return { ...parsed, keywords: validKeywords(rawKeywords) ? rawKeywords : [] };
      };
      const parsed = await withKeywordRecovery(request, (draft) => finalizeKeywords([], {
        brand: data.brand, itemType: data.itemType, color: data.color, size: data.size,
        title: draft.title, itemSpecifics: draft.itemSpecifics, tagsAttached: draft.retailTagsAttached,
      }, true));
      if (!parsed.title.trim()) return { ok: false as const, error: "AI returned an incomplete listing. Please generate again." };
      const clean = (value: string) => outputText(value, data.skipStyleTags);
      const condition = selectedCondition(data.condition);
      const tagsAttached = parsed.retailTagsAttached && condition === "New with tags";
      const suppliedSize = data.size || parsed.size || parsed.itemSpecifics.Size || "";
      let rawTitle = clean(parsed.title);
      if (suppliedSize && !/\bsize\b/i.test(rawTitle)) rawTitle = rawTitle.replace(suppliedSize, `Size ${suppliedSize}`);
      const modelName = clean(data.modelName ?? parsed.modelName);
      const title = buildSearchTitle({ brand: data.brand || parsed.brand || parsed.itemSpecifics.Brand || "", modelName, itemType: parsed.itemType || parsed.itemSpecifics.Type || data.itemType || "", department: parsed.department || parsed.itemSpecifics.Department || "", size: suppliedSize, color: normalizeColor(data.color || parsed.color || parsed.itemSpecifics.Color || "", parsed.prominentColorCount, parsed.multicolorPattern), features: [...parsed.features, parsed.material, parsed.fit, parsed.use], title: rawTitle, tagsAttached, skipStyleTags: data.skipStyleTags });
      const sku = buildSku(parsed.categoryCode, data.skuNumber ?? 1, data.listingDate);
      const itemNumber = itemNumberOutput(data.includeItemNumber, data.consignment, data.consignerName, sku);
      const itemSpecifics = Object.fromEntries(Object.entries(parsed.itemSpecifics)
        .filter(([key, value]) => !/measurement|chest|bust|waist|hips|inseam|sleeve length|length/i.test(key) && !/unknown|not visible|placeholder/i.test(value))
        .map(([key, value]) => [clean(key), clean(value)]).filter(([key, value]) => key && value));
      const detectedColor = normalizeColor(data.color || parsed.color || itemSpecifics.Color || itemSpecifics.color || "", parsed.prominentColorCount, parsed.multicolorPattern);
      if (detectedColor) { delete itemSpecifics.color; itemSpecifics.Color = detectedColor; }
      const ownBrand = data.brand || parsed.brand || itemSpecifics.Brand || itemSpecifics.brand || "";
      const size = data.size || parsed.size || itemSpecifics.Size || "";
      const specificType = parsed.itemType || itemSpecifics.Type || data.itemType || "";
      for (const key of Object.keys(itemSpecifics)) if (/condition/i.test(key)) itemSpecifics[key] = condition;
      if (modelName) itemSpecifics.Model = modelName;
      const keywords = finalizeKeywords(parsed.keywords, {
        brand: ownBrand, modelName, department: parsed.department || itemSpecifics.Department, material: parsed.material, use: parsed.use, itemType: specificType, color: detectedColor, size,
        title, itemSpecifics, tagsAttached, unwornWithoutTags: parsed.unwornWithoutTags && condition === "New without tags",
        skipStyleTags: data.skipStyleTags, categoryCode: parsed.categoryCode,
      }, parsed.keywordsFallback);
      const description = formatSharedDescription({
        title, summary: parsed.summary, styleLine: parsed.styleLine, brand: ownBrand,
        itemType: specificType, size, color: detectedColor, condition,
        material: parsed.material || itemSpecifics.Material || "", fit: parsed.fit || itemSpecifics.Fit || "",
        use: parsed.use, features: parsed.features, keywords, itemNumber,
        skipStyleTags: data.skipStyleTags, categoryCode: parsed.categoryCode,
      });
      const listing = {
        ...parsed, brand: ownBrand, itemType: specificType, modelName, title, sku, itemNumber, itemSpecifics, keywords, description,
        conditionDescription: formatConditionDescription(condition, parsed.conditionDescription, data.skipStyleTags),
        categoryEbay: clean(parsed.categoryEbay), categoryPoshmark: clean(parsed.categoryPoshmark), priceNote: formatPriceNote(clean(ownBrand), condition, clean(specificType)),
      };
      return { ok: true as const, listing };
    } catch (err) {
      console.error("generateListing failed", err);
      return { ok: false as const, error: aiErrorMessage(err) };
    }
  });

export type Listing = z.infer<typeof ListingSchema>;

export const analyzeUploadedPhotos = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ photos: z.array(z.string().min(20)).min(1).max(8) }).parse(input),
  )
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash-lite");

    try {
      const result = await generateText({
        model,
        maxRetries: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "Analyze these resale photos in one pass.",
                  "Return ONLY a JSON object with this exact shape: {\"photos\":[{\"index\":1,\"label\":\"Front\"}],\"brand\":\"\",\"modelName\":\"\",\"size\":\"\",\"color\":\"\",\"condition\":\"\",\"itemType\":\"\"}.",
                  "For every photo, return its 1-based index and the best label from this exact list: Front, Back, Side, Detail, Tag/Label, Flaw, Styled / On Model, Measurements, Measure — Bust/Chest, Measure — Waist, Measure — Hips, Measure — Length, Measure — Sleeve, Measure — Inseam, Measure — Shoulders, Measure — Rise, Measure — Thigh, Other.",
                  "If you see ANY measuring tape in a photo — especially pink, yellow, white, or flexible tailor tape — label that photo Measurements unless the measurement type is obvious, then use the specific Measure label.",
                  "Extract modelName only when model/product name is confidently legible on tags/photos, otherwise empty. Extract brand, size (preserve half sizes with decimal periods), color, condition, itemType. Return retailTagsAttached, visibleFlaw, unusedRetailPackaging booleans and prominentColorCount number and multicolorPattern boolean. Retail tags means attached original hangtags, NOT sewn-in labels. Default Excellent. Clothing with original hangtags => New with tags; non-clothing visibly unused in original unopened/retail packaging => New in box. Lower only for clear flaws.",
                  `Color must be one of ${BASIC_COLORS.join(", ")}; map sage/olive to Green, navy to Blue, burgundy to Red, blush to Pink, etc. Multicolor only for 3+ prominent colors or multicolor pattern.` ,
                  "itemType MUST be EXACTLY one of: Clothing, Shoes, Bags, Purses, Jewelry, Accessories, Electronics, Home, Collectibles, Beauty, Toys, Books, Other.",
                  "condition MUST be EXACTLY one of (case-sensitive, exact spelling): New with tags, New in box, New without tags, Excellent, Good, Fair. If a tag photo clearly shows NWT/NWOT/EUC, still map it to the closest allowed value. Default to 'Excellent' unless clear flaws justify a lower condition.",
                ].join("\n"),
              },
              ...data.photos.map((url) => ({ type: "image" as const, image: url })),
            ],
          },
        ],
      });
      const detection = DetectionResultSchema.parse(parseJsonObject(result.text));
      return { ok: true as const, ...detection, color: normalizeColor(detection.color, detection.prominentColorCount, detection.multicolorPattern), condition: resolveCondition(detection.retailTagsAttached, detection.visibleFlaw, detection.condition, "", detection.unusedRetailPackaging, detection.itemType) };
    } catch (err) {
      console.error("analyzeUploadedPhotos failed", err);
      return { ok: false as const, error: aiErrorMessage(err), ...EMPTY_DETECTION };
    }
  });

// Quick auto-label guess for a single uploaded photo
const PhotoLabels = ["Front", "Back", "Detail", "Tag/Label", "Measurements", "Other"] as const;

export const guessPhotoLabel = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ dataUrl: z.string().min(20) }).parse(input))
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash-lite");

    try {
      const result = await generateText({
        model,
        maxRetries: 0,
        output: Output.object({
          schema: z.object({ label: z.enum(PhotoLabels) }),
        }),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Classify this resale photo into ONE of: Front (full front of item), Back (full back of item), Detail (close-up of feature or flaw), Tag/Label (brand/size/care tag visible), Measurements (a tape measure — typically pink, yellow, or white — is laid across the item showing a measurement), Other. If you see ANY measuring tape in the photo, return 'Measurements'. Return only the label.",
              },
              { type: "image", image: data.dataUrl },
            ],
          },
        ],
      });
      return { label: result.output.label as string };
    } catch (err) {
      console.error("guessPhotoLabel failed", err);
      return { label: "" };
    }
  });

// Auto-detect item details from all uploaded photos
const DetailsSchema = z.object({
  brand: z.string().optional().describe("Brand name read from tag, or empty if unknown"),
  size: z.string().optional().describe("Size read from tag, or empty if unknown"),
  color: z.string().optional().describe("Primary color in plain English, or empty if unknown"),
  condition: z.string().optional().describe("One of: New with tags, New in box, New without tags, Excellent, Good, Fair. Empty if unsure."),
  itemType: z.string().optional().describe("One of: Clothing, Shoes, Bags, Accessories, Electronics, Home, Collectibles, Beauty, Toys, Books, Other. Empty if unsure."),
});

export const guessItemDetails = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ photos: z.array(z.string().min(20)).min(1).max(8) }).parse(input),
  )
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    try {
      const result = await generateText({
        model,
        maxRetries: 0,
        output: Output.object({ schema: DetailsSchema }),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Look at these resale photos and extract: brand, size (from size tag), color (plain English), condition (one of: New with tags, New without tags, Excellent, Good, Fair), and itemType (one of: Clothing, Shoes, Bags, Accessories, Electronics, Home, Collectibles, Beauty, Toys, Books, Other). If you cannot confidently determine any field, OMIT it or leave empty — do not guess.",
              },
              ...data.photos.map((url) => ({ type: "image" as const, image: url })),
            ],
          },
        ],
      });
      return result.output;
    } catch (err) {
      console.error("guessItemDetails failed", err);
      return {};
    }
  });