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
  description: z.string().describe("4-5 short paragraphs"),
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
      "Generate an eBay listing for this clothing or shoe item from the photos and details below.",
      "",
      "Critical instructions:",
      "- Read brand name from any brand/neck tag photo.",
      "- Read size from the size tag photo and note if US/EU/UK.",
      "- Transcribe FULL material composition from the care tag (e.g. '95% Cotton, 5% Elastane').",
      "- Transcribe FULL care instructions from the care tag in plain English (wash temp, dry method, iron, bleach, dry clean).",
      "- Read country of origin if visible ('Made in...').",
      "- If a tag value is unreadable, write 'Not visible' rather than guessing.",
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
      "- itemSpecifics: fill all fields you can determine.",
      "- description: 4-5 short paragraphs — opening hook, item details, full material composition, full care instructions in plain English, condition notes + shipping/returns line.",
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