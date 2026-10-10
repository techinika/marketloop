"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { formatPrice } from "@/lib/api";
import { observeAuthState, signInWithGoogle } from "@/lib/firebase";
import { createProduct } from "@/lib/products";
import { sanitizeDescription, stripHtml } from "@/lib/html";
import { contentTypeForFile, prepareImageFile, presignUploads, uploadToPresignedUrl } from "@/lib/upload";
import { CATEGORIES, type Currency, type DeliveryFeePayer, type Product, type ProductType } from "@/types";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { ListRowSkeleton } from "@/components/ui/Skeleton";
import { RichTextEditor } from "@/components/ui/RichTextEditor";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGES = 6;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

interface SelectedImage {
  id: string;
  file: File;
  previewUrl: string;
}

const OPTION_TYPES: Array<{ value: "text" | "choice" | "image_upload"; label: string }> = [
  { value: "text", label: "Short text" },
  { value: "choice", label: "Choice" },
  { value: "image_upload", label: "Image upload" },
];

interface OptionDraft {
  id: string;
  type: "text" | "choice" | "image_upload";
  label: string;
  required: boolean;
  priceAdjustment: string;
  choices: string;
}

function emptyOption(): OptionDraft {
  return {
    id: crypto.randomUUID(),
    type: "text",
    label: "",
    required: false,
    priceAdjustment: "",
    choices: "",
  };
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
  const [deliveryFeePayer, setDeliveryFeePayer] = useState<DeliveryFeePayer>("artisan");
  const [listingType, setListingType] = useState<ProductType>("made_to_order");
  const [productionTimeDays, setProductionTimeDays] = useState("");
  const [isCustomizable, setIsCustomizable] = useState(false);
  const [allowsReferenceUpload, setAllowsReferenceUpload] = useState(true);
  const [customizationOptions, setCustomizationOptions] = useState<OptionDraft[]>([]);
  const [tags, setTags] = useState("");
  const [materials, setMaterials] = useState("");
  const [region, setRegion] = useState("");
  const [quantityAvailable, setQuantityAvailable] = useState("");

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

  const addImageFiles = async (fileList: FileList | File[]) => {
    setError(null);
    const incoming = Array.from(fileList).filter((file) => IMAGE_MIME.has(file.type));
    if (incoming.length === 0) return;
    // Downscale/compress each image so phone photos upload fast and stay under
    // the server's 5MB cap even when the source file is much larger.
    const prepared = (await Promise.all(incoming.map((file) => prepareImageFile(file)))).filter(
      (file) => file.size <= MAX_IMAGE_BYTES,
    );
    if (prepared.length === 0) return;
    setImages((prev) => {
      const room = MAX_IMAGES - prev.length;
      const accepted = prepared.slice(0, room).map((file) => ({
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
    const productionDays = Number(productionTimeDays);
    if (!title.trim()) return setError("Title is required.");
    if (!stripHtml(description)) return setError("Description is required.");
    if (!category) return setError("Please choose a category.");
    if (!images.length) return setError("Add at least one image.");
    if (!Number.isFinite(price) || price <= 0) return setError("Enter a price greater than 0.");
    if (!Number.isInteger(productionDays) || productionDays < 1 || productionDays > 365) {
      return setError("Enter the production time in days (1-365).");
    }
    if (isCustomizable && customizationOptions.length === 0) {
      return setError("Add at least one customization question, or turn customization off.");
    }

    const options = isCustomizable
      ? customizationOptions.map((opt) => {
          const priceAdjustment = Number(opt.priceAdjustment) || 0;
          const choices =
            opt.type === "choice"
              ? opt.choices.split(/[\n,]+/).map((c) => c.trim()).filter(Boolean)
              : undefined;
          if (!opt.label.trim()) throw new Error("Every customization question needs a label.");
          if (opt.type === "choice" && (!choices || choices.length === 0)) {
            throw new Error("Choice questions need at least one choice.");
          }
          if (choices && new Set(choices).size !== choices.length) {
            throw new Error(`Choices for "${opt.label.trim()}" must be unique.`);
          }
          return {
            id: opt.id,
            type: opt.type,
            label: opt.label.trim(),
            required: opt.required,
            priceAdjustment,
            ...(choices ? { choices } : {}),
          };
        })
      : [];

    const tagList = tags.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean).slice(0, 20);
    const materialList = materials.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean).slice(0, 15);
    const regionValue = region.trim() || null;

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
        description: sanitizeDescription(description.trim()),
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
        productType: listingType,
        tags: tagList,
        materials: materialList,
        region: regionValue,
        ...(listingType === "made_to_order"
          ? {
              productionTimeDays: productionDays,
              isCustomizable,
              customizationOptions: options,
              allowsReferenceUpload,
              quantityAvailable: 0,
            }
          : {
              productionTimeDays: 0,
              isCustomizable: false,
              customizationOptions: [],
              allowsReferenceUpload: false,
              quantityAvailable: Math.max(1, Number(quantityAvailable)),
            }),
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
          <h2 className="heading mt-4 text-2xl text-foreground">
            Your craft is live
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
              Share another piece
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
          <h2 className="heading text-2xl text-foreground">Sign in to sell your craft</h2>
          <p className="mt-3 text-secondary">Share your handiwork with Rwanda and beyond — sign in with Google to get started.</p>
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
      <h1 className="heading text-2xl text-foreground sm:text-3xl">
        Sell your craft
      </h1>
      <p className="mt-1 text-sm text-muted">Share your craft with Rwanda and beyond. Great photos, a clear title, and a fair price get the best results.</p>

      {/* Listing type selector */}
      <SectionCard step="First" title="What are you sharing?" description="Choose how this piece comes to its new home.">
        <div className="flex gap-4">
          <label className="flex flex-col items-start rounded-xl border border-border bg-background p-4 cursor-pointer select-none">
            <input
              type="radio"
              name="listingType"
              value="made_to_order"
              checked={listingType === "made_to_order"}
              onChange={() => setListingType("made_to_order")}
              className="size-4 rounded border-border accent-accent"
            />
            <div>
              <p className="font-medium">Made to order</p>
              <p className="text-xs text-muted">I craft this piece after the order lands.</p>
            </div>
          </label>
          <label className="flex flex-col items-start rounded-xl border border-border bg-background p-4 cursor-pointer select-none">
            <input
              type="radio"
              name="listingType"
              value="ready_to_ship"
              checked={listingType === "ready_to_ship"}
              onChange={() => setListingType("ready_to_ship")}
              className="size-4 rounded border-border accent-accent"
            />
            <div>
              <p className="font-medium">Ready to ship</p>
              <p className="text-xs text-muted">Already finished; paid in full up front; stock is tracked.</p>
            </div>
          </label>
        </div>
      </SectionCard>

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
                placeholder="e.g. Hand-woven Agaseke peace basket"
                className="field w-full"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="description">
                Description
              </label>
              <RichTextEditor value={description} onChange={setDescription} />
              <p className="mt-1.5 text-xs text-muted">
                Supports rich text: bold, links, lists, headings, and quotes.
              </p>
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
                  placeholder="e.g. made from sisal, hand-dyed with natural pigments"
                  className="field w-full"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="tags">
                  Tags
                </label>
                <input
                  id="tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. traditional, gift, woven"
                  className="field w-full"
                />
                <p className="mt-1.5 text-xs text-muted">
                  Comma-separated discovery labels (up to 20).
                </p>
              </div>
              <div>
                <label className="field-label" htmlFor="materials">
                  Materials
                </label>
                <input
                  id="materials"
                  value={materials}
                  onChange={(e) => setMaterials(e.target.value)}
                  placeholder="e.g. sisal, sweet grass"
                  className="field w-full"
                />
                <p className="mt-1.5 text-xs text-muted">
                  Comma-separated materials (up to 15).
                </p>
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor="region">
                Region
              </label>
              <input
                id="region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                maxLength={60}
                placeholder="e.g. Kigali, Huye, Nyarubuye"
                className="field w-full"
              />
              <p className="mt-1.5 text-xs text-muted">
                Where the piece is made — shown on the listing and used in filters.
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          step="Step 3"
          title="Production & customization"
          description="How long this piece takes to make, and anything customers should answer at checkout."
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="production-time">
                  Production time <span className="text-danger">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="production-time"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="365"
                    value={productionTimeDays}
                    onChange={(e) => setProductionTimeDays(e.target.value)}
                    placeholder="e.g. 7"
                    className="field w-full"
                  />
                  <span className="flex shrink-0 items-center rounded-xl border border-border bg-surface px-3 text-sm text-secondary">
                    days
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  Shown at checkout so customers know when to expect their piece.
                </p>
              </div>
              <div>
                <span className="field-label">Customization</span>
                <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-background p-4">
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={isCustomizable}
                      onChange={(e) => {
                        setIsCustomizable(e.target.checked);
                        if (customizationOptions.length === 0) {
                          setCustomizationOptions([emptyOption()]);
                        }
                      }}
                      className="size-4 rounded border-border accent-accent"
                    />
                    This piece can be customized
                  </label>
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={allowsReferenceUpload}
                      onChange={(e) => setAllowsReferenceUpload(e.target.checked)}
                      className="size-4 rounded border-border accent-accent"
                    />
                    Customers can attach a reference image / brief
                  </label>
                </div>
              </div>
            </div>

            {isCustomizable && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">Questions customers must answer</p>
                  <button
                    type="button"
                    onClick={() => setCustomizationOptions((prev) => [...prev, emptyOption()])}
                    className="btn btn-secondary h-8 px-3 text-sm"
                  >
                    + Add question
                  </button>
                </div>
                {customizationOptions.map((opt, index) => (
                  <div
                    key={opt.id}
                    className="rounded-xl border border-border bg-background p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Question {index + 1}
                      </p>
                      <button
                        type="button"
                        aria-label="Remove question"
                        onClick={() => setCustomizationOptions((prev) => prev.filter((o) => o.id !== opt.id))}
                        className="text-xs font-medium text-danger hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="field-label" htmlFor={`opt-label-${opt.id}`}>
                          Question
                        </label>
                        <input
                          id={`opt-label-${opt.id}`}
                          value={opt.label}
                          onChange={(e) =>
                            setCustomizationOptions((prev) =>
                              prev.map((o) => (o.id === opt.id ? { ...o, label: e.target.value } : o)),
                            )
                          }
                          maxLength={80}
                          placeholder="e.g. Pick a size"
                          className="field w-full"
                        />
                      </div>
                      <div>
                        <label className="field-label" htmlFor={`opt-type-${opt.id}`}>
                          Answer type
                        </label>
                        <select
                          id={`opt-type-${opt.id}`}
                          value={opt.type}
                          onChange={(e) =>
                            setCustomizationOptions((prev) =>
                              prev.map((o) =>
                                o.id === opt.id
                                  ? { ...o, type: e.target.value as OptionDraft["type"] }
                                  : o,
                              ),
                            )
                          }
                          className="field w-full"
                        >
                          {OPTION_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="field-label" htmlFor={`opt-price-${opt.id}`}>
                          Price change ({priceCurrency})
                        </label>
                        <input
                          id={`opt-price-${opt.id}`}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          value={opt.priceAdjustment}
                          onChange={(e) =>
                            setCustomizationOptions((prev) =>
                              prev.map((o) =>
                                o.id === opt.id ? { ...o, priceAdjustment: e.target.value } : o,
                              ),
                            )
                          }
                          placeholder="0 = included, use + / - "
                          className="field w-full"
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={opt.required}
                            onChange={(e) =>
                              setCustomizationOptions((prev) =>
                                prev.map((o) =>
                                  o.id === opt.id ? { ...o, required: e.target.checked } : o,
                                ),
                              )
                            }
                            className="size-4 rounded border-border accent-accent"
                          />
                          Required
                        </label>
                      </div>
                      {opt.type === "choice" && (
                        <div className="sm:col-span-2">
                          <label className="field-label" htmlFor={`opt-choices-${opt.id}`}>
                            Choices (one per line, or comma-separated)
                          </label>
                          <textarea
                            id={`opt-choices-${opt.id}`}
                            value={opt.choices}
                            onChange={(e) =>
                              setCustomizationOptions((prev) =>
                                prev.map((o) => (o.id === opt.id ? { ...o, choices: e.target.value } : o)),
                              )
                            }
                            rows={2}
                            placeholder={"Small, Medium, Large"}
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard step="Step 4" title="Price & delivery">
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

            {listingType === "ready_to_ship" && (
              <div>
                <label className="field-label" htmlFor="quantity">
                  Quantity in stock
                </label>
                <input
                  id="quantity"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={quantityAvailable}
                  onChange={(e) => setQuantityAvailable(e.target.value)}
                  placeholder="e.g. 5"
                  className="field w-full sm:max-w-xs"
                />
                <p className="mt-1.5 text-xs text-muted">
                  How many are ready to ship. The listing shows &ldquo;Sold out&rdquo; at zero.
                </p>
              </div>
            )}

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
                  <option value="artisan">Artisan pays delivery</option>
                  <option value="buyer">Customer pays delivery</option>
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

        <SectionCard step="Step 5" title="Video" description="Optional — MP4 or MOV, max 50MB">
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
