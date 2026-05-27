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
});

const ListingSchema = z.object({
  title: z.string().describe("eBay title, max 80 characters"),
  itemSpecifics: z.object({
    Brand: z.string().optional(),
    Department: z.string().optional(),
    Size: z.string().optional(),
    SizeType: z.string().optional(),
    Color: z.string().optional(),
    Style: z.string().optional(),
    Material: z.string().optional(),
    CountryOfOrigin: z.string().optional(),
    Type: z.string().optional(),
    CareInstructions: z.string().optional(),
  }),
  descriptionEbay: z.string().describe("eBay description, 3-5 short paragraphs"),
  descriptionPoshmark: z.string().describe("Poshmark description, friendlier tone, 2-4 short paragraphs"),
  category: z.string(),
  keywords: z.array(z.string()).min(4).max(15),
});

export const generateListing = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const userText = [
      "Generate listings for this clothing or shoe item from the photos and details below.",
      "",
      "Reading instructions:",
      "- Read brand name from any brand/neck tag photo.",
      "- Read size from the size tag photo and note if US/EU/UK.",
      "- Transcribe FULL material composition from the care tag (e.g. '95% Cotton, 5% Elastane').",
      "- Transcribe FULL care instructions from the care tag in plain English (wash temp, dry method, iron, bleach, dry clean).",
      "- Read country of origin if visible ('Made in...').",
      "- If a tag value is unreadable, OMIT that itemSpecifics field entirely and DO NOT mention it in either description. Never write 'Not visible', 'Unknown', '[placeholder]', or similar.",
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
      "- title: max 80 chars, keyword-optimized (brand, item type, size, color, key features).",
      "- itemSpecifics: fill ONLY the fields you can actually determine; omit any you can't.",
      "- descriptionEbay: 3-5 short paragraphs — opening hook, item details, material composition (only if known), care instructions in plain English (only if known), condition notes. DO NOT include any shipping or returns sentence. After the final paragraph, add a blank line then 'Keywords: ' followed by the keywords comma-separated.",
      "- descriptionPoshmark: 2-4 short paragraphs, friendlier and more casual tone. Same omission rules for unknown material/care. After the final paragraph, add a blank line then the keywords as hashtags (e.g. '#nike #athleisure #size8'), lowercase, no spaces within each tag.",
      "- category: full eBay category path.",
      "- keywords: 8-12 search terms.",
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
const PhotoLabels = ["Front", "Back", "Brand tag", "Size tag", "Care tag", "Detail", "Flaw", "Other"] as const;

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
                  "Classify this resale photo into ONE of: Front (full front of garment/shoe), Back, Brand tag (neck/brand label), Size tag, Care tag (washing/material label), Detail (close-up of feature), Flaw (damage/wear), Other. Return only the label.",
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