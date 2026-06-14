import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { analyzeUploadedPhotos, generateListing, type Listing } from "@/lib/listing.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ListFast — AI listings for eBay & Poshmark resellers" },
      { name: "description", content: "Upload photos, get a full eBay + Poshmark listing: title, specifics, descriptions, keywords, category, price." },
      { property: "og:title", content: "ListFast" },
      { property: "og:description", content: "AI listing generator for clothing resellers." },
    ],
  }),
  component: ListFast,
});

type Photo = {
  id: string;
  dataUrl: string;
  label: string;
  manual?: boolean;
};

const LABEL_GROUPS: { group: string; options: string[] }[] = [
  { group: "Overview", options: ["Front", "Back", "Side", "Detail", "Tag/Label", "Flaw", "Styled / On Model"] },
  { group: "Measurements", options: [
    "Measurements",
    "Measure — Bust/Chest",
    "Measure — Waist",
    "Measure — Hips",
    "Measure — Length",
    "Measure — Sleeve",
    "Measure — Inseam",
    "Measure — Shoulders",
    "Measure — Rise",
    "Measure — Thigh",
  ]},
  { group: "Other", options: ["Other"] },
];
const ALL_LABELS = LABEL_GROUPS.flatMap((g) => g.options);
const ORDER_DEFAULTS = ["Front", "Back", "Detail", "Tag/Label", "Detail", "Detail", "Measurements", "Other"];
const CONDITIONS = ["New with tags", "New without tags", "Excellent", "Good", "Fair"];
const ITEM_TYPES = ["Clothing", "Shoes", "Bags", "Accessories", "Electronics", "Home", "Collectibles", "Beauty", "Toys", "Books", "Other"];
const SIZED_TYPES = new Set(["Clothing", "Shoes"]);
const MEASURABLE_TYPES = new Set(["Clothing"]);
const PROGRESS_MESSAGES = [
  "Analyzing your item... ✨",
  "Reading your tags... 🏷️",
  "Pricing the market... 💰",
  "Drafting your title... ✍️",
  "Picking the perfect keywords... 🔑",
  "Polishing the descriptions... 📝",
  "Almost there... 📦",
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function downscaleImage(file: File, maxDim = 1600, quality = 0.82): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function ListFast() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");
  const [skuNumber, setSkuNumber] = useState<string>("1");
  const [color, setColor] = useState("");
  const [itemType, setItemType] = useState<string>("");
  const [aiFields, setAiFields] = useState<{ brand?: boolean; size?: boolean; color?: boolean; condition?: boolean; itemType?: boolean }>({});
  const [detecting, setDetecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const callGenerate = useServerFn(generateListing);
  const callAnalyzePhotos = useServerFn(analyzeUploadedPhotos);

  useEffect(() => {
    if (!loading) return;
    setProgressIdx(0);
    const t = setInterval(() => setProgressIdx((i) => (i + 1) % PROGRESS_MESSAGES.length), 2500);
    return () => clearInterval(t);
  }, [loading]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const room = 8 - photos.length;
    if (room <= 0) {
      toast.error("8 photo max — remove one to add another");
      return;
    }
    const toAdd = arr.slice(0, room);
    const next: Photo[] = [];
    for (const f of toAdd) {
      const dataUrl = await downscaleImage(f);
      next.push({ id: crypto.randomUUID(), dataUrl, label: "" });
    }
    const startIdx = photos.length;
    // Seed labels by upload order immediately so something is always visible.
    const seeded = next.map((p, i) => ({
      ...p,
      label: ORDER_DEFAULTS[startIdx + i] || "Other",
    }));
    setPhotos((p) => [...p, ...seeded]);
    // Auto-detect photo labels and item details in one call to avoid rate limits.
    const allUrls = [...photos.map((p) => p.dataUrl), ...next.map((p) => p.dataUrl)];
    setDetecting(true);
    callAnalyzePhotos({ data: { photos: allUrls } })
      .then((res) => {
        if (!res?.ok) {
          return;
        }
        const labelsByIndex = new Map(res.photos.map((photo) => [photo.index - 1, photo.label]));
        setPhotos((ps) =>
          ps.map((photo, index) => {
            const label = labelsByIndex.get(index);
            return label && ALL_LABELS.includes(label) && !photo.manual ? { ...photo, label } : photo;
          }),
        );
        const flags: typeof aiFields = {};
        if (res.brand && !brand) { setBrand(res.brand); flags.brand = true; }
        if (res.size && !size) { setSize(res.size); flags.size = true; }
        if (res.color && !color) { setColor(res.color); flags.color = true; }
        if (!condition) {
          const match = matchCondition(res.condition);
          if (match) { setCondition(match); flags.condition = true; }
        }
        if (res.itemType && !itemType) {
          const match = ITEM_TYPES.find((t) => t.toLowerCase() === res.itemType.toLowerCase().trim());
          if (match) { setItemType(match); flags.itemType = true; }
        }
        setAiFields((f) => ({ ...f, ...flags }));
      })
      .catch(() => {})
      .finally(() => setDetecting(false));
  }, [photos, callAnalyzePhotos, brand, size, color, condition, itemType, aiFields]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  };

  const generate = async () => {
    if (photos.length === 0) {
      toast.error("Add at least one photo first 📸");
      return;
    }
    const skuN = parseInt(skuNumber, 10);
    if (!Number.isFinite(skuN) || skuN < 0) {
      toast.error("Enter a SKU number (e.g. 57)");
      return;
    }
    setLoading(true);
    setListing(null);
    try {
      const result = await callGenerate({
        data: {
          photos: photos.map((p) => ({ dataUrl: p.dataUrl, label: p.label || undefined })),
          brand: brand || undefined,
          size: SIZED_TYPES.has(itemType) || !itemType ? size || undefined : undefined,
          condition: condition || undefined,
          notes: [color ? `Color: ${color}` : "", notes].filter(Boolean).join(". ") || undefined,
          skuNumber: skuN,
          itemType: itemType || undefined,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setListing(result.listing as Listing);
      toast.success("Boom — ready to post! 🚀");
    } catch (err) {
      console.error(err);
      toast.error("Hmm, that didn't work. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${what} copied! 📋`);
  };

  const sku = listing ? buildSku(listing.categoryCode, parseInt(skuNumber, 10) || 0) : "";
  const itemNum = parseInt(skuNumber, 10) || 0;
  const skuTag = listing ? `Item# ${itemNum} | SKU: ${sku}` : "";
  const ebayDescription = listing ? `${listing.descriptionEbay}\n\n${skuTag}` : "";
  const poshmarkDescription = listing ? `${listing.descriptionPoshmark}\n\n${skuTag}` : "";

  const copyAll = () => {
    if (!listing) return;
    const specifics = Object.entries(listing.itemSpecifics)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    const text = [
      `SKU: ${sku}`,
      ``,
      `TITLE (${listing.title.length}/80):`,
      listing.title,
      ``,
      `ITEM SPECIFICS:`,
      specifics,
      ``,
      `EBAY DESCRIPTION:`,
      ebayDescription,
      ``,
      `CONDITION DESCRIPTION (${listing.conditionDescription.length}/200):`,
      listing.conditionDescription,
      ``,
      `POSHMARK DESCRIPTION:`,
      poshmarkDescription,
      ``,
      `KEYWORDS:`,
      listing.keywords.join(", "),
      ``,
      `EBAY CATEGORY: ${listing.categoryEbay}`,
      `POSHMARK CATEGORY: ${listing.categoryPoshmark}`,
      ``,
      `PRICES:`,
      `eBay BIN: $${listing.priceEbayLow}–$${listing.priceEbayHigh}`,
      `Poshmark: $${listing.pricePoshmark}`,
      `Floor: $${listing.priceFloor}`,
      listing.priceNote,
    ].join("\n");
    copy(text, "Everything");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="px-6 pt-16 pb-10 text-center">
        <h1 className="font-serif text-5xl sm:text-6xl font-light tracking-wide text-foreground">
          ListFast
        </h1>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-muted-foreground font-light">
          The reseller's editorial assistant
        </p>
        <div className="mx-auto mt-6 h-px w-16 bg-border" />
      </header>

      <main className="mx-auto max-w-3xl px-5 sm:px-8 pb-16 space-y-8">
        {/* Photo upload */}
        <section className="bg-card rounded-2xl p-8 border border-border">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="font-serif text-2xl font-light tracking-wide">Photographs</h2>
            <span className="text-xs uppercase tracking-widest text-muted-foreground">{photos.length} / 8</span>
          </div>

          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-xl border border-dashed border-border bg-background/40 hover:bg-background/70 transition p-10 text-center"
          >
            <p className="font-serif text-xl font-light tracking-wide">Drop photographs here</p>
            <p className="mt-2 text-sm text-muted-foreground font-light">
              or click to browse — include brand, size, and care tags for best results
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>

          {photos.length > 0 && (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {photos.map((p) => (
                <div key={p.id} className="relative group">
                  <img
                    src={p.dataUrl}
                    alt="upload"
                    className="w-full aspect-square object-cover rounded-lg border border-border"
                  />
                  <button
                    type="button"
                    onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-foreground/80 text-background text-xs hover:bg-foreground transition"
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                  <select
                    value={p.label}
                    onChange={(e) =>
                      setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, label: e.target.value, manual: true } : x)))
                    }
                    className="mt-2 w-full text-xs rounded-md border border-border bg-card text-foreground px-2 py-1.5 font-light tracking-wide"
                  >
                    <option value="">Label…</option>
                    {LABEL_GROUPS.map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.options.map((l) => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Fields */}
        <section className="bg-card rounded-2xl p-8 border border-border">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="font-serif text-2xl font-light tracking-wide">Details</h2>
            {detecting && (
              <span className="text-xs uppercase tracking-widest text-muted-foreground font-light">
                analyzing…
              </span>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Item type" aiNote={aiFields.itemType}>
              <select
                value={itemType}
                onChange={(e) => { setItemType(e.target.value); setAiFields((f) => ({ ...f, itemType: false })); }}
                className="input"
              >
                <option value="">Auto-detect…</option>
                {ITEM_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Brand" aiNote={aiFields.brand}>
              <input
                value={brand}
                onChange={(e) => { setBrand(e.target.value); setAiFields((f) => ({ ...f, brand: false })); }}
                className="input"
                placeholder="e.g. Acne Studios"
              />
            </Field>
            <Field label="Size" aiNote={aiFields.size}>
                <input
                  value={size}
                  onChange={(e) => { setSize(e.target.value); setAiFields((f) => ({ ...f, size: false })); }}
                  className="input"
                  placeholder="e.g. M / 10 US"
                />
            </Field>
            <Field label="Color" aiNote={aiFields.color}>
              <input
                value={color}
                onChange={(e) => { setColor(e.target.value); setAiFields((f) => ({ ...f, color: false })); }}
                className="input"
                placeholder="e.g. cream, navy"
              />
            </Field>
            <Field label="Condition" aiNote={aiFields.condition}>
              <select
                value={condition}
                onChange={(e) => { setCondition(e.target.value); setAiFields((f) => ({ ...f, condition: false })); }}
                className="input"
              >
                <option value="">Select…</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={MEASURABLE_TYPES.has(itemType) ? "Notes (flaws, measurements, fit)" : "Notes (model, specs, condition details)"}>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input"
                placeholder={MEASURABLE_TYPES.has(itemType) ? "Flaws, measurements, fit" : "Model #, specs, accessories"}
              />
            </Field>
            <Field label="SKU number">
              <input
                type="number"
                min={0}
                value={skuNumber}
                onChange={(e) => setSkuNumber(e.target.value)}
                className="input"
                placeholder="e.g. 57"
              />
            </Field>
          </div>
        </section>

        {/* Generate */}
        <button
          onClick={generate}
          disabled={loading}
          className="w-full py-5 rounded-full bg-primary text-primary-foreground text-sm uppercase tracking-[0.25em] font-light hover:opacity-90 active:scale-[0.99] transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span>{PROGRESS_MESSAGES[progressIdx]}</span>
          ) : (
            <>Generate Listing</>
          )}
        </button>
        {loading && (
          <p className="text-center text-xs text-muted-foreground font-light tracking-wide -mt-4">
            This can take 15–25 seconds — please hold on.
          </p>
        )}

        {/* Results */}
        {listing && (
          <div className="space-y-6 pt-2">
            <div className="flex justify-end">
              <button
                onClick={copyAll}
                className="px-5 py-2 rounded-full bg-primary text-primary-foreground text-xs uppercase tracking-[0.2em] font-light hover:opacity-90 transition"
              >
                Copy All
              </button>
            </div>

            <ResultCard title="SKU" accent="sage" onCopy={() => copy(sku, "SKU")}>
              <p className="text-lg font-mono tracking-wide">{sku}</p>
            </ResultCard>

            <ResultCard title="eBay Title" accent="peach" onCopy={() => copy(listing.title, "Title")}>
              <p className="text-base">{listing.title}</p>
              <p className={`text-xs mt-2 tracking-wide ${listing.title.length > 80 ? "text-destructive" : "text-muted-foreground"}`}>
                {listing.title.length} / 80 characters
              </p>
            </ResultCard>

            <ResultCard
              title="Item Specifics"
              accent="lavender"
              onCopy={() =>
                copy(
                  Object.entries(listing.itemSpecifics)
                    .filter(([, v]) => v)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join("\n"),
                  "Item specifics",
                )
              }
            >
              <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
                {Object.entries(listing.itemSpecifics)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 border-b border-border py-2">
                      <dt className="text-sm font-light uppercase tracking-wider text-muted-foreground">{k.replace(/([A-Z])/g, " $1").trim()}</dt>
                      <dd className="text-sm text-right text-foreground">{v as string}</dd>
                    </div>
                  ))}
              </dl>
            </ResultCard>

            <ResultCard
              title="eBay Description"
              accent="sage"
              onCopy={() => copy(ebayDescription, "eBay description")}
            >
              <div className="whitespace-pre-wrap leading-relaxed text-sm font-light">{ebayDescription}</div>
            </ResultCard>

            <ResultCard
              title="Condition Description"
              accent="peach"
              onCopy={() => copy(listing.conditionDescription, "Condition description")}
            >
              <div className="whitespace-pre-wrap leading-relaxed text-sm font-light">{listing.conditionDescription}</div>
              <p className={`text-xs mt-2 tracking-wide ${listing.conditionDescription.length > 200 ? "text-destructive" : "text-muted-foreground"}`}>
                {listing.conditionDescription.length} / 200 characters
              </p>
            </ResultCard>

            <ResultCard
              title="Poshmark Description"
              accent="lavender"
              onCopy={() => copy(poshmarkDescription, "Poshmark description")}
            >
              <div className="whitespace-pre-wrap leading-relaxed text-sm font-light">{poshmarkDescription}</div>
            </ResultCard>

            <ResultCard
              title="Keywords"
              accent="sage"
              onCopy={() => copy(listing.keywords.join(", "), "Keywords")}
            >
              <div className="flex flex-wrap gap-2">
                {listing.keywords.map((k) => (
                  <span
                    key={k}
                    className="px-3 py-1 rounded-full text-xs font-light tracking-wide border border-border bg-background"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </ResultCard>

            <ResultCard
              title="Suggested Categories"
              accent="peach"
              onCopy={() => copy(`eBay: ${listing.categoryEbay}\nPoshmark: ${listing.categoryPoshmark}`, "Categories")}
            >
              <div className="space-y-2 text-sm font-light">
                <div>
                  <span className="uppercase tracking-wider text-xs text-muted-foreground">eBay — </span>
                  <span>{listing.categoryEbay}</span>
                </div>
                <div>
                  <span className="uppercase tracking-wider text-xs text-muted-foreground">Poshmark — </span>
                  <span>{listing.categoryPoshmark}</span>
                </div>
              </div>
            </ResultCard>

            <ResultCard
              title="Price Suggestion"
              accent="lavender"
              onCopy={() =>
                copy(
                  `eBay BIN: $${listing.priceEbayLow}–$${listing.priceEbayHigh}\nPoshmark: $${listing.pricePoshmark}\nFloor: $${listing.priceFloor}\n${listing.priceNote}`,
                  "Prices",
                )
              }
            >
              <div className="grid sm:grid-cols-3 gap-3 mb-4">
                <PriceTile label="eBay BIN" value={`$${listing.priceEbayLow}–$${listing.priceEbayHigh}`} />
                <PriceTile label="Poshmark" value={`$${listing.pricePoshmark}`} />
                <PriceTile label="Floor" value={`$${listing.priceFloor}`} />
              </div>
              <p className="text-sm text-muted-foreground font-light leading-relaxed">{listing.priceNote}</p>
            </ResultCard>
          </div>
        )}

        <footer className="text-center text-xs text-muted-foreground py-10 font-light tracking-widest uppercase">
          ListFast · For Resellers · Not affiliated with eBay or Poshmark
        </footer>
      </main>

      <style>{`
        .input {
          width: 100%;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          border: 1px solid var(--border);
          background: var(--input);
          color: var(--foreground);
          font-size: 0.9rem;
          font-weight: 300;
          letter-spacing: 0.01em;
          transition: border-color 0.15s;
        }
        .input:focus { outline: none; border-color: var(--primary); }
        .input::placeholder { color: var(--muted-foreground); font-weight: 300; }
      `}</style>
    </div>
  );
}

function buildSku(categoryCode: string, num: number): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}-${categoryCode}-${String(num).padStart(3, "0")}`;
}

function PriceTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-4 text-center">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-light">{label}</div>
      <div className="mt-1 font-serif text-xl font-light">{value}</div>
    </div>
  );
}

function Field({ label, children, aiNote }: { label: string; children: React.ReactNode; aiNote?: boolean }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between mb-2">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-light">{label}</span>
        {aiNote && (
          <span className="text-[10px] italic text-muted-foreground font-light tracking-wide">AI suggested</span>
        )}
      </span>
      {children}
    </label>
  );
}

function ResultCard({
  title,
  onCopy,
  children,
  accent = "sage",
}: {
  title: string;
  onCopy: () => void;
  children: React.ReactNode;
  accent?: "sage" | "peach" | "lavender";
}) {
  const accentColor =
    accent === "peach" ? "var(--peach)" : accent === "lavender" ? "var(--lavender)" : "var(--sage)";
  return (
    <section
      className="bg-card rounded-2xl p-7 border border-border"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif text-xl font-light tracking-wide">{title}</h3>
        <button
          onClick={onCopy}
          className="text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition font-light"
        >
          Copy
        </button>
      </div>
      {children}
    </section>
  );
}
