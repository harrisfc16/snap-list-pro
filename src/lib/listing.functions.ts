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
});

const ListingSchema = z.object({
  categoryCode: z.enum(["TOP", "BTM", "DRESS", "SHOE", "BAG", "ACC", "OUTER", "DENIM"]),
  title: z.string().describe("eBay title, max 80 characters"),
  itemSpecifics: z.object({
    Brand: z.string().optional(),
    Department: z.string().optional(),
    Size: z.string().optional(),
    Color: z.string().optional(),
    Style: z.string().optional(),
    Material: z.string().optional(),
    Type: z.string().optional(),
    Era: z.string().optional(),
  }),
  descriptionEbay: z.string().describe("eBay description, 3-5 short paragraphs"),
  conditionDescription: z.string().describe("eBay condition description, max 200 chars, factual"),
  descriptionPoshmark: z.string().describe("Poshmark description, friendlier tone, 2-4 short paragraphs"),
  categoryEbay: z.string().describe("Full eBay category path"),
  categoryPoshmark: z.string().describe("Full Poshmark category path"),
  keywords: z.array(z.string()).min(4).max(15),
  priceEbayLow: z.number(),
  priceEbayHigh: z.number(),
  pricePoshmark: z.number(),
  priceFloor: z.number(),
  priceNote: z.string(),
});

export const generateListing = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const userText = [
      "Generate a complete reseller listing for this clothing/shoe/accessory item from the photos and details below.",
      "",
      "Reading instructions:",
      "- Read brand, size, material from any tag/label photos.",
      "- If a tag value is unreadable, OMIT that itemSpecifics field entirely and DO NOT mention it in either description. Never write 'Not visible', 'Unknown', '[placeholder]', or similar.",
      "- Analyze the photos VISUALLY — colors, style, fit, era, condition. Don't rely only on text inputs.",
      "",
      "User-provided fields (use as ground truth if present):",
      `Brand: ${data.brand || "(let AI read tag)"}`,
      `Size: ${data.size || "(let AI read tag)"}`,
      `Condition: ${data.condition || "(not specified)"}`,
      `Notes: ${data.notes || "(none)"}`,
      "",
      "Photos (in order):",
      ...data.photos.map((p, i) => `Photo ${i + 1}: ${p.label || "unlabeled"}`),
      "",
      "Requirements:",
      "- categoryCode: pick ONE — TOP, BTM, DRESS, SHOE, BAG, ACC, OUTER, DENIM.",
      "- title: 75-80 chars, NEVER exceed 80. Format: Brand + Item Type + Size + Color + Key Descriptors. No punctuation, symbols, or filler words.",
      "- itemSpecifics: fill ONLY the fields you can actually determine; omit any you can't.",
      "- descriptionEbay: structured & factual. 1-2 sentence hook, then bullet points for material, fit, condition, design features, then a closing styling note. Keyword-dense, no casual language. After the final line, add a blank line then 'Keywords: ' followed by the keywords comma-separated. DO NOT mention shipping or returns.",
      "- conditionDescription: MAX 200 characters. Honest, factual; note whether any wear/distressing is intentional or actual.",
      "- descriptionPoshmark: casual, social, conversational. Energetic hook, then brand/size/material/condition/styling ideas, then a call to action. Last line: 8-12 hashtags lowercase no-spaces.",
      "- categoryEbay: full eBay category path (e.g. 'Women's Clothing > Tops > T-Shirts').",
      "- categoryPoshmark: full Poshmark category path.",
      "- keywords: 10-14 search terms. Mix factual (brand, type, size, color) with trending aesthetic tags ONLY if they genuinely match: normcore, scandi girl, Y2K, quiet luxury, cottagecore, dark academia, indie sleaze, coastal grandmother, balletcore, gorpcore, old money, vintage, grunge, streetwear.",
      "- prices (USD whole numbers): priceEbayLow/priceEbayHigh = realistic Buy-It-Now range based on brand, condition, current resale market. pricePoshmark = single list price (typically slightly above eBay high to allow for offers). priceFloor = absolute don't-go-below. priceNote: 1-2 sentences on what's driving the price.",
    ].join("\n");

    const result = await generateText({
      model,
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
const PhotoLabels = ["Front", "Back", "Detail", "Tag/Label", "Other"] as const;

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
                  "Classify this resale photo into ONE of: Front (full front), Back (full back), Detail (close-up of feature or flaw), Tag/Label (brand/size/care tag), Other. Return only the label.",
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