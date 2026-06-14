import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";

import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const PhotoSchema = z.object({
  dataUrl: z.string().min(20),
  label: z.string().optional(),
});

const InputSchema = z.object({
  photos: z.array(PhotoSchema).min(1).max(8),
  brand: z.string().optional(),
  size: z.string().optional(),
  condition: z.string().optional(),
  notes: z.string().optional(),
  skuNumber: z.number().int().min(0).max(99999).optional(),
  itemType: z.string().optional(),
});

const ListingSchema = z.object({
  categoryCode: z.string().describe("One of: TOP, BTM, DRESS, SHOE, BAG, ACC, OUTER, DENIM, ELEC, HOME, COLLECT, BEAUTY, TOY, BOOK, OTHER"),
  title: z.string().describe("eBay title, max 80 characters"),
  itemSpecifics: z.record(z.string(), z.string()).describe("Key-value pairs like Brand, Size, Color, Material, Type, Model, Features. Only include fields you can determine."),
  descriptionEbay: z.string().describe("eBay description, 3-5 short paragraphs"),
  conditionDescription: z.string().describe("eBay condition description, max 200 chars, factual"),
  descriptionPoshmark: z.string().describe("Poshmark description, friendlier tone, 2-4 short paragraphs"),
  categoryEbay: z.string().describe("Full eBay category path"),
  categoryPoshmark: z.string().describe("Full Poshmark category path"),
  keywords: z.array(z.string()).describe("18-25 high-traffic search keywords"),
  priceEbayLow: z.number(),
  priceEbayHigh: z.number(),
  pricePoshmark: z.number(),
  priceFloor: z.number(),
  priceNote: z.string().optional().default(""),
});

export const generateListing = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const userText = [
      "Generate a complete reseller listing for the item in the photos. Items may be clothing, shoes, bags, accessories, electronics, home goods, collectibles, beauty, toys, books, or other resale categories. Adapt your fields to the item type.",
      "",
      "Reading instructions:",
      "- Read brand, size, material from any tag/label photos.",
      "- If a photo is labeled 'Measurements' or with a body measurement (Bust/Waist/Hips/Length/Sleeve/Inseam/Shoulders), read the tape measure value and incorporate it into the description and itemSpecifics where useful.",
      "- If a tag value is unreadable, OMIT that itemSpecifics field entirely and DO NOT mention it in either description. Never write 'Not visible', 'Unknown', '[placeholder]', or similar.",
      "- Analyze the photos VISUALLY — colors, style, fit, era, condition. Don't rely only on text inputs.",
      "- For non-clothing items, skip Size/Material/Department and instead populate Type/Brand/Model/Features/Color where they apply.",
      "",
      "User-provided fields (use as ground truth if present):",
      `Brand: ${data.brand || "(let AI read tag)"}`,
      `Size: ${data.size || "(let AI read tag)"}`,
      `Condition: ${data.condition || "(not specified)"}`,
      `Item type: ${data.itemType || "(detect from photos)"}`,
      `Notes: ${data.notes || "(none)"}`,
      "",
      "Photos (in order):",
      ...data.photos.map((p, i) => `Photo ${i + 1}: ${p.label || "unlabeled"}`),
      "",
      "Requirements:",
      "- categoryCode: pick ONE — TOP, BTM, DRESS, SHOE, BAG, ACC, OUTER, DENIM, ELEC (electronics), HOME (home goods), COLLECT (collectibles), BEAUTY, TOY, BOOK, OTHER.",
      "- title: pack keywords aggressively. Target 78-80 chars, NEVER exceed 80. Use every available character. Order: Brand + Item Type + Model (if any) + Size + Color + 3-5 high-traffic search descriptors (style, fit, era, material, aesthetic, occasion). No filler words ('a', 'the', 'with'), no punctuation, no symbols. Maximize discoverability.",
      "- itemSpecifics: fill ONLY the fields you can actually determine; omit any you can't.",
      "- descriptionEbay: structured & factual. 1-2 sentence hook PACKED with searchable terms, then bullet points for material, fit/size, condition, design features, then a closing styling/use note. Extremely keyword-dense — work in synonyms, brand associations, style descriptors, era tags, and buyer search terms naturally. After the final line, add a blank line then 'Keywords: ' followed by ALL keywords comma-separated. DO NOT mention shipping or returns.",
      "- conditionDescription: MAX 200 characters. Honest, factual; note whether any wear/distressing is intentional or actual.",
      "- descriptionPoshmark: casual, social, conversational AND keyword-dense. Energetic hook, then brand/size/material/condition/styling ideas (work in synonyms, aesthetics, occasions, comparable brands). Last line: 15-20 hashtags lowercase no-spaces — mix factual tags with trending aesthetic tags.",
      "- categoryEbay: full eBay category path (e.g. 'Women's Clothing > Tops > T-Shirts').",
      "- categoryPoshmark: full Poshmark category path.",
      "- keywords: 18-25 high-traffic search terms. Be aggressive — include brand, item type, size, color, material, style, era, fit, occasion, comparable/competitor brands, popular synonyms (e.g. 'sweatshirt' AND 'crewneck' AND 'pullover'), condition qualifiers (preloved, vintage, EUC, NWT where accurate), and trending aesthetic tags ONLY if they genuinely match: normcore, scandi girl, Y2K, quiet luxury, cottagecore, dark academia, indie sleaze, coastal grandmother, balletcore, gorpcore, old money, vintage, grunge, streetwear, techwear. Prioritize discoverability.",
      "- prices (USD whole numbers): priceEbayLow/priceEbayHigh = realistic Buy-It-Now range based on brand, condition, current resale market. pricePoshmark = single list price (typically slightly above eBay high to allow for offers). priceFloor = absolute don't-go-below. priceNote: 1-2 sentences on what's driving the price.",
    ].join("\n");

    const result = await generateText({
      model,
      maxOutputTokens: 8000,
      output: Output.object({ schema: ListingSchema }),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            ...data.photos.map((p) => ({
              type: "image" as const,
              image: p.dataUrl,
            })),
          ],
        },
      ],
    });

    return result.output;
  });

export type Listing = z.infer<typeof ListingSchema>;

// Quick auto-label guess for a single uploaded photo
const PhotoLabels = ["Front", "Back", "Detail", "Tag/Label", "Measurements", "Other"] as const;

export const guessPhotoLabel = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ dataUrl: z.string().min(20) }).parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash-lite");

    try {
      const result = await generateText({
        model,
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
  condition: z.string().optional().describe("One of: New with tags, New without tags, Excellent, Good, Fair. Empty if unsure."),
  itemType: z.string().optional().describe("One of: Clothing, Shoes, Bags, Accessories, Electronics, Home, Collectibles, Beauty, Toys, Books, Other. Empty if unsure."),
});

export const guessItemDetails = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ photos: z.array(z.string().min(20)).min(1).max(8) }).parse(input),
  )
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    try {
      const result = await generateText({
        model,
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