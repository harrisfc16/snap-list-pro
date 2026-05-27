import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { generateListing, type Listing } from "@/lib/listing.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SnapList — Photo to eBay listing in seconds" },
      { name: "description", content: "Snap your clothing or shoes, get a ready-to-paste eBay listing with tags auto-digitized." },
      { property: "og:title", content: "SnapList" },
      { property: "og:description", content: "Photo-to-listing assistant for eBay resellers." },
    ],
  }),
  component: SnapList,
});

type Photo = {
  id: string;
  dataUrl: string;
  label: string;
};

const LABELS = ["Front", "Back", "Brand tag", "Size tag", "Care tag", "Detail", "Flaw", "Other"];
const CONDITIONS = ["New with tags", "New without tags", "Excellent", "Good", "Fair"];
const PROGRESS_MESSAGES = [
  "Reading your tags... 🏷️",
  "Decoding care symbols... 🧺",
  "Drafting your title... ✍️",
  "Picking the perfect keywords... 🔑",
  "Polishing the description... ✨",
  "Almost there — boxing it up... 📦",
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

function SnapList() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const callGenerate = useServerFn(generateListing);

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
    setPhotos((p) => [...p, ...next]);
  }, [photos.length]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  };

  const generate = async () => {
    if (photos.length === 0) {
      toast.error("Add at least one photo first 📸");
      return;
    }
    setLoading(true);
    setListing(null);
    try {
      const result = await callGenerate({
        data: {
          photos: photos.map((p) => ({ dataUrl: p.dataUrl, label: p.label || undefined })),
          brand: brand || undefined,
          size: size || undefined,
          condition: condition || undefined,
          notes: notes || undefined,
        },
      });
      setListing(result as Listing);
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

  return (
    <div className="min-h-screen bg-background">
      <header
        className="px-6 py-10 sm:py-14 text-center text-white"
        style={{ background: "var(--gradient-hero)" }}
      >
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight drop-shadow-sm">
          SnapList <span className="inline-block animate-bounce">📸</span>
        </h1>
        <p className="mt-3 text-lg sm:text-xl font-medium opacity-95">
          Snap it. List it. Sell it. — Let's flip this!
        </p>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-6">
        {/* Photo upload */}
        <section className="bg-card rounded-3xl p-6 shadow-[var(--shadow-soft)] border border-border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold">📸 Photos</h2>
            <span className="text-sm font-semibold text-muted-foreground">{photos.length} / 8</span>
          </div>

          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-2xl border-2 border-dashed border-pink/60 bg-secondary/40 hover:bg-secondary transition p-8 text-center"
          >
            <p className="text-2xl">📷✨</p>
            <p className="mt-2 font-semibold">Drop photos here or click to upload</p>
            <p className="mt-1 text-sm text-muted-foreground">
              📸 Tip: Include the brand tag, size tag, and care label for best results
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
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {photos.map((p) => (
                <div key={p.id} className="relative group">
                  <img
                    src={p.dataUrl}
                    alt="upload"
                    className="w-full aspect-square object-cover rounded-xl border border-border"
                  />
                  <button
                    type="button"
                    onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}
                    className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-destructive text-destructive-foreground font-bold shadow-md hover:scale-110 transition"
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                  <select
                    value={p.label}
                    onChange={(e) =>
                      setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, label: e.target.value } : x)))
                    }
                    className="mt-1 w-full text-xs rounded-lg border border-border bg-card px-2 py-1"
                  >
                    <option value="">Label…</option>
                    {LABELS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Fields */}
        <section className="bg-card rounded-3xl p-6 shadow-[var(--shadow-soft)] border border-border">
          <h2 className="text-xl font-bold mb-4">🧾 Quick details (optional)</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Brand" placeholder="AI will read the tag if blank">
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="input"
                placeholder="e.g. Nike"
              />
            </Field>
            <Field label="Size" placeholder="AI will read the tag if blank">
              <input
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="input"
                placeholder="e.g. M / 10 US"
              />
            </Field>
            <Field label="Condition">
              <select value={condition} onChange={(e) => setCondition(e.target.value)} className="input">
                <option value="">Select…</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Notes">
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input"
                placeholder="Flaws, measurements, fit…"
              />
            </Field>
          </div>
        </section>

        {/* Generate */}
        <button
          onClick={generate}
          disabled={loading}
          className="w-full py-5 rounded-3xl text-white text-xl font-extrabold shadow-[var(--shadow-soft)] hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-70 disabled:cursor-not-allowed"
          style={{ background: "var(--gradient-cta)" }}
        >
          {loading ? (
            <span className="inline-flex items-center gap-3">
              <span className="inline-block animate-spin">✨</span>
              {PROGRESS_MESSAGES[progressIdx]}
            </span>
          ) : (
            <>Generate Listing ✨</>
          )}
        </button>
        {loading && (
          <p className="text-center text-sm text-muted-foreground -mt-2">
            This can take 15–25 seconds with multiple photos — hang tight!
          </p>
        )}

        {/* Results */}
        {listing && (
          <div className="space-y-5 pt-2">
            <ResultCard title="📝 eBay Title" onCopy={() => copy(listing.title, "Title")}>
              <p className="text-lg font-semibold">{listing.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{listing.title.length} / 80 characters</p>
            </ResultCard>

            <ResultCard
              title="🏷️ Item Specifics"
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
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                {Object.entries(listing.itemSpecifics)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 border-b border-border/60 py-1">
                      <dt className="font-semibold">{k.replace(/([A-Z])/g, " $1").trim()}</dt>
                      <dd className="text-right text-muted-foreground">{v as string}</dd>
                    </div>
                  ))}
              </dl>
            </ResultCard>

            <ResultCard title="✨ Description" onCopy={() => copy(listing.description, "Description")}>
              <div className="whitespace-pre-wrap leading-relaxed">{listing.description}</div>
            </ResultCard>

            <ResultCard title="📂 Suggested Category" onCopy={() => copy(listing.category, "Category")}>
              <p>{listing.category}</p>
            </ResultCard>

            <ResultCard
              title="🔑 Keywords"
              onCopy={() => copy(listing.keywords.join(", "), "Keywords")}
            >
              <div className="flex flex-wrap gap-2">
                {listing.keywords.map((k) => (
                  <span
                    key={k}
                    className="px-3 py-1 rounded-full text-sm font-medium"
                    style={{ background: "color-mix(in oklab, var(--mint) 50%, white)" }}
                  >
                    {k}
                  </span>
                ))}
              </div>
            </ResultCard>
          </div>
        )}

        <footer className="text-center text-xs text-muted-foreground py-6">
          Made with ❤️ for resellers. SnapList isn't affiliated with eBay.
        </footer>
      </main>

      <style>{`
        .input {
          width: 100%;
          padding: 0.625rem 0.875rem;
          border-radius: 0.75rem;
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--foreground);
          font-size: 0.95rem;
        }
        .input:focus { outline: 2px solid var(--purple); outline-offset: 1px; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; placeholder?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold mb-1">{label}</span>
      {children}
    </label>
  );
}

function ResultCard({
  title,
  onCopy,
  children,
}: {
  title: string;
  onCopy: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-3xl p-6 shadow-[var(--shadow-soft)] border border-border">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold">{title}</h3>
        <button
          onClick={onCopy}
          className="px-3 py-1.5 rounded-full text-sm font-semibold bg-secondary hover:bg-yellow transition"
        >
          📋 Copy
        </button>
      </div>
      {children}
    </section>
  );
}
