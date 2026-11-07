import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DEFAULT_CONDITION, resolveCondition, BASIC_COLORS, normalizeColor, soldSearchTerm, soldSearchLinks } from "@/lib/listing-rules";

import { analyzeUploadedPhotos, generateListing, type Listing } from "@/lib/listing.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ListFast — Cross-platform resale listings" },
      { name: "description", content: "Turn resale photos into one description for eBay, Poshmark, Depop and Mercari, with keywords and price suggestions." },
      { property: "og:title", content: "ListFast" },
      { property: "og:description", content: "Photo-to-listing assistant for eBay, Poshmark and Depop resellers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
const CONDITIONS = ["New with tags", "New in box", "New without tags", "Excellent", "Good", "Fair"];
const ITEM_TYPES = ["Clothing", "Shoes", "Bags", "Purses", "Jewelry", "Accessories", "Electronics", "Home", "Collectibles", "Beauty", "Toys", "Books", "Other"];
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

// Map common AI condition outputs (exact or fuzzy) onto our allowed list.
function matchCondition(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = String(raw).toLowerCase().trim();
  if (!text) return null;
  const aliasMap: Record<string, string> = {
    "new with tags": "New with tags",
    "new in box": "New in box",
    "nwt": "New with tags",
    "new w/ tags": "New with tags",
    "new with tag": "New with tags",
    "tags attached": "New with tags",
    "new without tags": "New without tags",
    "nwot": "New without tags",
    "new w/o tags": "New without tags",
    "new without tag": "New without tags",
    "no tags": "New without tags",
    "excellent": "Excellent",
    "euc": "Excellent",
    "excellent used condition": "Excellent",
    "like new": "Excellent",
    "mint": "Excellent",
    "near mint": "Excellent",
    "pristine": "Excellent",
    "good": "Good",
    "pre-owned": "Good",
    "preowned": "Good",
    "pre loved": "Good",
    "preloved": "Good",
    "gently used": "Good",
    "used": "Good",
    "very good": "Good",
    "fair": "Fair",
    "poor": "Fair",
    "worn": "Fair",
    "heavy wear": "Fair",
  };
  if (aliasMap[text]) return aliasMap[text];
  for (const c of CONDITIONS) {
    if (text === c.toLowerCase()) return c;
    if (text.includes(c.toLowerCase())) return c;
  }
  if (/new|nwt|nwot|mint|pristine|like new|euc/i.test(text)) return "Excellent";
  if (/used|good|pre[- ]?owned|pre[- ]?loved|worn|loved/i.test(text)) return "Good";
  if (/fair|poor|damaged|stain|hole|tear|heavy/i.test(text)) return "Fair";
  return null;
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
  const [modelName, setModelName] = useState("");
  const modelEdited = useRef(false);
  const [soldTerm, setSoldTerm] = useState("");
  const soldLinks = soldSearchLinks(soldTerm);
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState<string>(DEFAULT_CONDITION);
  const conditionEdited = useRef(false);
  const [notes, setNotes] = useState("");
  const [includeItemNumber, setIncludeItemNumber] = useState(true);
  const [consignment, setConsignment] = useState(false);
  const [consignerName, setConsignerName] = useState("");
  const [skipStyleTags, setSkipStyleTags] = useState(false);
  const [skuNumber, setSkuNumber] = useState<string>("1");
  const [color, setColor] = useState("");
  const [itemType, setItemType] = useState<string>("");
  const [aiFields, setAiFields] = useState<{ brand?: boolean; modelName?: boolean; size?: boolean; color?: boolean; condition?: boolean; itemType?: boolean }>({});
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
        if (res.modelName && !modelEdited.current) { setModelName(res.modelName); flags.modelName = true; }
        if (res.size && !size) { setSize(res.size); flags.size = true; }
        if (res.color && !color) { setColor(normalizeColor(res.color)); flags.color = true; }
        if (!conditionEdited.current) {
          const match = matchCondition(res.condition);
          if (match) { setCondition(resolveCondition(res.retailTagsAttached, res.visibleFlaw, match, notes, res.unusedRetailPackaging, res.itemType)); flags.condition = true; }
        }
        if (res.itemType && !itemType) {
          const match = ITEM_TYPES.find((t) => t.toLowerCase() === res.itemType.toLowerCase().trim());
          if (match) { setItemType(match); flags.itemType = true; }
        }
        setAiFields((f) => ({ ...f, ...flags }));
      })
      .catch(() => {})
      .finally(() => setDetecting(false));
  }, [photos, callAnalyzePhotos, brand, modelName, size, color, condition, itemType, aiFields, notes]);

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
    if (includeItemNumber && !consignment && (!Number.isFinite(skuN) || skuN < 0)) {
      toast.error("Enter a SKU number (e.g. 57)");
      return;
    }
    if (consignment && !consignerName.trim()) { toast.error("Enter the consigner’s name"); return; }
    setLoading(true);
    setListing(null);
    try {
      const result = await callGenerate({
        data: {
          photos: photos.map((p) => ({ dataUrl: p.dataUrl, label: p.label || undefined })),
          brand: brand || undefined,
          modelName: modelName || (modelEdited.current ? "" : undefined),
          size: SIZED_TYPES.has(itemType) || !itemType ? size || undefined : undefined,
          condition: condition || undefined,
          color: color || undefined,
          listingDate: localListingDate(),
          notes: [color ? `Color: ${color}` : "", notes].filter(Boolean).join(". ") || undefined,
          skuNumber: Number.isFinite(skuN) ? skuN : 1,
          includeItemNumber, consignment, consignerName, skipStyleTags,
          itemType: itemType || undefined,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setListing(result.listing as Listing);
      setSoldTerm(soldSearchTerm(result.listing.brand, result.listing.modelName, result.listing.itemType, result.listing.itemSpecifics.Material || result.listing.itemSpecifics.material || result.listing.material, notes));
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

  const skuTag = listing?.itemNumber ?? "";
  const description = listing?.description ?? "";

  const copyAll = () => {
    if (!listing) return;
    const specifics = Object.entries(listing.itemSpecifics)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    const text = [
      skuTag,
      ``,
      `TITLE (${listing.title.length}/80):`,
      listing.title,
      ``,
      `ITEM SPECIFICS:`,
      specifics,
      ``,
      `DESCRIPTION:`,
      description,
      ``,
      `KEYWORDS:`,
      listing.keywords.join(", "),
      ``,
      `EBAY CATEGORY: ${listing.categoryEbay}`,
      `POSHMARK CATEGORY: ${listing.categoryPoshmark}`,
      ``,
      `PRICES:`,
      `Suggested list price: $${listing.priceList}`,
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
                  <Button variant="ghost"
                    type="button"
                    onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-foreground/80 text-background text-xs hover:bg-foreground transition"
                    aria-label="Remove photo"
                  >
                    ×
                  </Button>
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
            <Field label="Model / product name" aiNote={aiFields.modelName}>
              <input value={modelName} onChange={e => { modelEdited.current = true; setModelName(e.target.value); setAiFields(f => ({ ...f, modelName: false })); }} className="input" placeholder="e.g. Earned It Short" maxLength={160} />
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
              <select value={color} onChange={(e) => { setColor(e.target.value); setAiFields((f) => ({ ...f, color: false })); }} className="input">
                <option value="">Auto-detect…</option>
                {BASIC_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Condition" aiNote={aiFields.condition}>
              <select
                value={condition}
                onChange={(e) => { conditionEdited.current = true; setCondition(e.target.value); setAiFields((f) => ({ ...f, condition: false })); }}
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
            <YesNo label="Include an item number?" value={includeItemNumber} onChange={setIncludeItemNumber} disabled={consignment} />
            <YesNo label="Consignment piece?" value={consignment} onChange={setConsignment} />
            {consignment && <Field label="Consigner's name"><input className="input" value={consignerName} maxLength={120} onChange={e => setConsignerName(e.target.value)} /></Field>}
            {includeItemNumber && !consignment && <Field label="SKU number">
              <input type="number" min={0} value={skuNumber} onChange={e => setSkuNumber(e.target.value)} className="input" placeholder="e.g. 57" />
            </Field>}
            <YesNo label="Skip style tags?" value={skipStyleTags} onChange={setSkipStyleTags} />
          </div>
        </section>

        {/* Generate */}
        <Button variant="ghost"
          onClick={generate}
          disabled={loading}
          className="w-full py-5 rounded-full bg-primary text-primary-foreground text-sm uppercase tracking-[0.25em] font-light hover:opacity-90 active:scale-[0.99] transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span>{PROGRESS_MESSAGES[progressIdx]}</span>
          ) : (
            <>Generate Listing</>
          )}
        </Button>
        {loading && (
          <p className="text-center text-xs text-muted-foreground font-light tracking-wide -mt-4">
            This can take 15–25 seconds — please hold on.
          </p>
        )}

        {/* Results */}
        {listing && (
          <div className="space-y-6 pt-2">
            <div className="flex justify-end">
              <Button variant="ghost"
                onClick={copyAll}
                className="px-5 py-2 rounded-full bg-primary text-primary-foreground text-xs uppercase tracking-[0.2em] font-light hover:opacity-90 transition"
              >
                Copy All
              </Button>
            </div>

            <ResultCard title="SKU" accent="sage" onCopy={() => copy(skuTag, "SKU")}>
              <p className="text-lg font-mono tracking-wide">{skuTag}</p>
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
              title="Description"
              accent="sage"
              onCopy={() => copy(description, "Description")}
            >
              <div className="whitespace-pre-wrap leading-relaxed text-sm font-light">{description}</div>
              <p className="text-xs mt-2 text-muted-foreground">{description.length} / 900 characters</p>
            </ResultCard>

            <ResultCard
              title="Keywords"
              accent="sage"
              onCopy={() => copy(listing.keywords.join(", "), "Keywords")}
            >
              {listing.keywordsFallback && <p className="text-xs text-muted-foreground mb-3">Keywords built from your item details.</p>}
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
                  `Suggested list price: $${listing.priceList}\nFloor: $${listing.priceFloor}\n${listing.priceNote}`,
                  "Prices",
                )
              }
            >
              <div className="grid sm:grid-cols-2 gap-3 mb-4">
                <PriceTile label="Suggested list price" value={`$${listing.priceList}`} />
                <PriceTile label="Floor" value={`$${listing.priceFloor}`} />
              </div>
              <p className="text-sm text-muted-foreground font-light leading-relaxed">{listing.priceNote}</p>
            </ResultCard>
            <ResultCard title="Check Sold Prices" accent="lavender">
              <Field label="Search term"><input className="input" value={soldTerm} onChange={e => setSoldTerm(e.target.value)} /></Field>
              <div className="flex flex-wrap gap-3 mt-4">
                <Button asChild variant="outline"><a href={soldLinks.ebay} target="_blank" rel="noopener noreferrer">eBay sold</a></Button>
                <Button asChild variant="outline"><a href={soldLinks.poshmark} target="_blank" rel="noopener noreferrer">Poshmark sold</a></Button>
                <Button asChild variant="outline"><a href={soldLinks.poshmarkListed} target="_blank" rel="noopener noreferrer">Poshmark listed</a></Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Sold buttons show what items actually sold for. Listed shows current asking prices. You may need to be logged in.</p>
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

function localListingDate(): string {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
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
  onCopy?: () => void;
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
        {onCopy && <Button variant="ghost"
          onClick={onCopy}
          className="text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition font-light"
        >
          Copy
        </Button>}
      </div>
      {children}
    </section>
  );
}

function YesNo({label, value, onChange, disabled = false}: {label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean}) {
  return <fieldset disabled={disabled} className="space-y-2 disabled:opacity-50">
    <legend className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-light">{label}</legend>
    <div className="inline-flex gap-1" role="group" aria-label={label}>
      <Button variant={value ? "default" : "outline"} size="sm" aria-pressed={value} onClick={() => onChange(true)}>Y</Button>
      <Button variant={!value ? "default" : "outline"} size="sm" aria-pressed={!value} onClick={() => onChange(false)}>N</Button>
    </div>
  </fieldset>;
}
