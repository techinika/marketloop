"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { formatPrice } from "@/lib/api";
import { observeAuthState, signInWithGoogle } from "@/lib/firebase";
import { createProduct } from "@/lib/products";
import { contentTypeForFile, presignUploads, uploadToPresignedUrl } from "@/lib/upload";
import { CATEGORIES, type Currency, type DeliveryFeePayer, type Product } from "@/types";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { ListRowSkeleton } from "@/components/ui/Skeleton";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGES = 6;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

interface SelectedImage {
  id: string;
  file: File;
  previewUrl: string;
}

function SectionCard({
  step,
  title,
  description,
  children,
}: {
  step?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-6">
      <div className="mb-4 flex items-baseline gap-2">
        {step && (
          <span className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
            {step}
          </span>
        )}
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {description && <p className="-mt-3 mb-4 text-sm text-muted">{description}</p>}
      {children}
    </section>
  );
}

export function SellForm() {
  const { toast } = useToast();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("");
  const [conditionNote, setConditionNote] = useState("");
  const [priceAmount, setPriceAmount] = useState("");
  const [priceCurrency, setPriceCurrency] = useState<Currency>("RWF");
  const [isNegotiable, setIsNegotiable] = useState(false);
  const [isBiddingEnabled, setIsBiddingEnabled] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState("");
  const [deliveryFeePayer, setDeliveryFeePayer] = useState<DeliveryFeePayer>("seller");

  const [images, setImages] = useState<SelectedImage[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<(Product & { id: string }) | null>(null);
  const [copied, setCopied] = useState(false);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return observeAuthState((user) => setAuthed(!!user));
  }, []);

  useEffect(() => {
    const urls = images.map((img) => img.previewUrl);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [images]);

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSigningIn(false);
    }
  };

  const addImageFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter(
      (file) => IMAGE_MIME.has(file.type) && file.size <= MAX_IMAGE_BYTES,
    );
    if (incoming.length === 0) return;
    setImages((prev) => {
      const room = MAX_IMAGES - prev.length;
      const accepted = incoming.slice(0, room).map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      return [...prev, ...accepted];
    });
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    setImages((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const handleVideoChange = (file: File | null) => {
    setError(null);
    if (!file) {
      setVideoFile(null);
      return;
    }
    const type = contentTypeForFile(file);
    if (type !== "video/mp4" && type !== "video/quicktime") {
      setError("Video must be MP4 or MOV.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError("Video must be 50MB or smaller.");
      return;
    }
    setVideoFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const price = Number(priceAmount);
    if (!title.trim()) return setError("Title is required.");
    if (!description.trim()) return setError("Description is required.");
    if (!category) return setError("Please choose a category.");
    if (!images.length) return setError("Add at least one image.");
    if (!Number.isFinite(price) || price <= 0) return setError("Enter a price greater than 0.");

    setSubmitting(true);
    try {
      const uploadFiles = [...images.map((img) => img.file)];
      if (videoFile) uploadFiles.push(videoFile);

      const uploads = await presignUploads(uploadFiles);
      await Promise.all(
        uploads.map((upload, i) => uploadToPresignedUrl(upload, uploadFiles[i]!)),
      );

      const imageKeys = uploads.slice(0, images.length).map((u) => u.key);
      const videoUpload = uploads[images.length];

      const product = (await createProduct({
        title: title.trim(),
        description: description.trim(),
        category,
        priceAmount: price,
        priceCurrency,
        isNegotiable,
        isBiddingEnabled,
        conditionNote: conditionNote.trim(),
        images: imageKeys,
        videoUrl: videoUpload?.key ?? null,
        deliveryFee: Number(deliveryFee) || 0,
        deliveryFeePayer,
      })) as Product & { id: string };

      setCreated(product);
      toast({
        title: "Product listed",
        description: `${product.title} is now live on the marketplace.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Listing failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div className="container-page flex justify-center py-16">
        <div className="card w-full max-w-xl p-8 text-center">
          <span className="badge badge-success">Listed</span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
            Your item is live
          </h2>
          <p className="mt-3 text-lg text-secondary">
            {created.title} — {formatPrice(created.priceAmount, created.priceCurrency)}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={`/product/${created.id}`} className="btn btn-primary">
              View listing
            </Link>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${window.location.origin}/product/${created.id}`,
                  );
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setError("Could not copy the link.");
                }
              }}
              className="btn btn-secondary"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
          <div className="mt-8">
            <Link href="/sell/new" className="text-sm font-medium text-accent-strong hover:underline">
              List another item
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (authed === false) {
    return (
      <div className="container-page flex justify-center py-16">
        <div className="card w-full max-w-xl p-8 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Sign in to sell</h2>
          <p className="mt-3 text-secondary">You need to sign in with Google before listing an item.</p>
          <button
            type="button"
            onClick={handleSignIn}
            disabled={signingIn}
            className="btn btn-primary mt-6"
          >
            {signingIn ? "Signing in..." : "Sign in with Google"}
          </button>
          {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        </div>
      </div>
    );
  }

  if (authed === null) {
    return (
      <div className="container-page max-w-xl py-16">
        <div className="space-y-4">
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="container-page max-w-2xl py-8 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        List an item
      </h1>
      <p className="mt-1 text-sm text-muted">Photos, a clear title, and a fair price get the best results.</p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6">
        <SectionCard
          step="Step 1"
          title="Photos"
          description={`${images.length}/6 — JPG, PNG or WEBP, up to 5MB each`}
        >
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addImageFiles(e.dataTransfer.files);
            }}
            onClick={() => imageInputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-background px-4 py-10 text-center transition-colors hover:border-accent hover:bg-accent-soft"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-surface text-muted shadow-soft">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="m17 8-5-5-5 5" />
                <path d="M12 3v12" />
              </svg>
            </span>
            <span className="mt-2 text-sm font-medium text-foreground">
              Drag photos here or click to browse
            </span>
            <span className="text-xs text-muted">The first photo is your cover image</span>
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addImageFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {images.length > 0 && (
            <ul className="mt-4 grid grid-cols-3 gap-3">
              {images.map((img, index) => (
                <li key={img.id} className="group relative overflow-hidden rounded-xl border border-border bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.previewUrl} alt="" className="aspect-square w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/50 to-transparent p-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label="Move left"
                        disabled={index === 0}
                        onClick={() => moveImage(index, -1)}
                        className="flex size-7 items-center justify-center rounded-full bg-white/90 text-sm font-medium text-foreground disabled:opacity-40"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        aria-label="Move right"
                        disabled={index === images.length - 1}
                        onClick={() => moveImage(index, 1)}
                        className="flex size-7 items-center justify-center rounded-full bg-white/90 text-sm font-medium text-foreground disabled:opacity-40"
                      >
                        →
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => removeImage(img.id)}
                      className="flex size-7 items-center justify-center rounded-full bg-white/90 text-sm font-medium text-danger"
                    >
                      ✕
                    </button>
                  </div>
                  {index === 0 && (
                    <span className="absolute left-1.5 top-1.5 badge badge-accent bg-white/90">
                      Cover
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard step="Step 2" title="Details">
          <div className="flex flex-col gap-4">
            <div>
              <label className="field-label" htmlFor="title">
                Title
              </label>
              <input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                placeholder="e.g. iPhone 12 — gently used"
                className="field w-full"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="description">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="Condition, reason for selling, what's included..."
                className="field w-full"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="category">
                  Category
                </label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="field w-full"
                >
                  <option value="">Choose a category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="condition">
                  Condition note
                </label>
                <input
                  id="condition"
                  value={conditionNote}
                  onChange={(e) => setConditionNote(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. used 6 months, minor scratches"
                  className="field w-full"
                />
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard step="Step 3" title="Price & delivery">
          <div className="flex flex-col gap-4">
            <div>
              <label className="field-label" htmlFor="price">
                Price
              </label>
              <div className="flex gap-3">
                <input
                  id="price"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="any"
                  value={priceAmount}
                  onChange={(e) => setPriceAmount(e.target.value)}
                  placeholder="0"
                  className="field flex-1"
                />
                <div className="flex shrink-0 rounded-xl border border-border bg-surface p-1">
                  {(["RWF", "USD"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPriceCurrency(c)}
                      className={cn(
                        "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                        priceCurrency === c
                          ? "bg-accent text-white"
                          : "text-secondary hover:text-foreground",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="delivery-fee">
                  Delivery fee
                </label>
                <input
                  id="delivery-fee"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={deliveryFee}
                  onChange={(e) => setDeliveryFee(e.target.value)}
                  placeholder="0 = free delivery"
                  className="field w-full"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="fee-payer">
                  Delivery paid by
                </label>
                <select
                  id="fee-payer"
                  value={deliveryFeePayer}
                  onChange={(e) => setDeliveryFeePayer(e.target.value as DeliveryFeePayer)}
                  className="field w-full"
                >
                  <option value="seller">Seller pays delivery</option>
                  <option value="buyer">Buyer pays delivery</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-background p-4">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={isNegotiable}
                  onChange={(e) => setIsNegotiable(e.target.checked)}
                  className="size-4 rounded border-border accent-accent"
                />
                Price is negotiable
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={isBiddingEnabled}
                  onChange={(e) => setIsBiddingEnabled(e.target.checked)}
                  className="size-4 rounded border-border accent-accent"
                />
                Allow bidding on this item
              </label>
            </div>
          </div>
        </SectionCard>

        <SectionCard step="Step 4" title="Video" description="Optional — MP4 or MOV, max 50MB">
          {videoFile ? (
            <div className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3">
              <span className="truncate text-sm text-foreground">{videoFile.name}</span>
              <button
                type="button"
                onClick={() => setVideoFile(null)}
                className="btn btn-danger-ghost h-8 px-3 text-sm"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="field w-full cursor-pointer text-secondary transition-colors hover:border-accent"
            >
              Add a video
            </button>
          )}
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/quicktime"
            hidden
            onChange={(e) => handleVideoChange(e.target.files?.[0] ?? null)}
          />
        </SectionCard>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button type="submit" disabled={submitting} className="btn btn-primary w-full">
          {submitting ? "Listing your item..." : "List item"}
        </button>
      </form>
    </div>
  );
}
