"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { useMe } from "@/lib/useMe";
import { fetchArtisanProfile, updateArtisanProfile } from "@/lib/products";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldSkeleton } from "@/components/ui/Skeleton";

const MAX_STORE_NAME = 60;
const MAX_STORE_REGION = 60;
const MAX_BIO = 500;
const MAX_SPECIALTIES = 10;
const MAX_SPECIALTY_LEN = 30;

export default function StorefrontSettingsPage() {
  const { firebaseUser: user } = useMe();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [storeName, setStoreName] = useState("");
  const [storeRegion, setStoreRegion] = useState("");
  const [storeBio, setStoreBio] = useState("");
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [specialtyDraft, setSpecialtyDraft] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const profile = await fetchArtisanProfile(user.uid);
        if (cancelled) return;
        setStoreName(profile.artisan.storeName ?? "");
        setStoreRegion(profile.artisan.storeRegion ?? "");
        setStoreBio(profile.artisan.storeBio ?? "");
        setSpecialties(profile.artisan.specialties ?? []);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load your storefront");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const addSpecialty = () => {
    const value = specialtyDraft.trim();
    if (!value) return;
    if (value.length > MAX_SPECIALTY_LEN) {
      toast({ title: "Specialty is too long", description: `Keep each specialty under ${MAX_SPECIALTY_LEN} characters.`, variant: "error" });
      return;
    }
    if (specialties.some((s) => s.toLowerCase() === value.toLowerCase())) {
      setSpecialtyDraft("");
      return;
    }
    if (specialties.length >= MAX_SPECIALTIES) {
      toast({ title: "That's the limit", description: `You can add up to ${MAX_SPECIALTIES} specialties.`, variant: "error" });
      return;
    }
    setSpecialties((prev) => [...prev, value]);
    setSpecialtyDraft("");
  };

  const removeSpecialty = (value: string) => {
    setSpecialties((prev) => prev.filter((s) => s !== value));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateArtisanProfile({
        storeName: storeName.trim() || null,
        storeRegion: storeRegion.trim() || null,
        storeBio: storeBio.trim() || null,
        specialties,
      });
      toast({ title: "Storefront updated", description: "Your public shop page now reflects these details." });
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : "Please try again.", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="container-page max-w-3xl py-10 sm:py-14">
        <EmptyState
          icon="inbox"
          title="Sign in to edit your storefront"
          description="Set your shop name, story, region and specialties so buyers know who they're supporting."
        >
          <Link href="/" className="btn btn-primary">
            Sign in
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="container-page max-w-3xl py-10 sm:py-14">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="heading text-2xl text-foreground sm:text-3xl">Storefront</h1>
          <p className="mt-1 text-sm text-muted">
            How buyers see your shop. Changes appear on your public artisan page.
          </p>
        </div>
        <Link href={`/artisan/${user.uid}`} className="btn btn-secondary">
          View public page
        </Link>
      </div>

      {loadError && <p className="mt-6 text-sm text-warning">{loadError} You can still fill this in below.</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6">
          <section className="card p-6">
            <p className="text-sm font-medium text-foreground">Shop identity</p>
            {loading ? (
              <div className="mt-4 space-y-4">
                <FieldSkeleton />
                <FieldSkeleton />
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="field-label">Store name</span>
                  <input
                    type="text"
                    value={storeName}
                    maxLength={MAX_STORE_NAME}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="e.g. Kigali Craft Studio"
                    className="field w-full"
                  />
                  <span className="text-xs text-muted">
                    Leave blank to use your account name. {MAX_STORE_NAME - storeName.length} characters left.
                  </span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="field-label">Region</span>
                  <input
                    type="text"
                    value={storeRegion}
                    maxLength={MAX_STORE_REGION}
                    onChange={(e) => setStoreRegion(e.target.value)}
                    placeholder="e.g. Kigali, Nyarugenge"
                    className="field w-full"
                  />
                </label>
              </div>
            )}
          </section>

          <section className="card p-6">
            <p className="text-sm font-medium text-foreground">Your story</p>
            <p className="mt-1 text-xs text-muted">Tell buyers about your craft, your workshop and what makes it special.</p>
            <textarea
              value={storeBio}
              maxLength={MAX_BIO}
              rows={6}
              onChange={(e) => setStoreBio(e.target.value)}
              placeholder="I've been weaving agaseke baskets for 12 years in Nyarugenge..."
              className="field mt-4 w-full resize-y"
            />
            <p className="mt-1.5 text-xs text-muted">
              {storeBio.length}/{MAX_BIO} characters
            </p>
          </section>

          <section className="card p-6">
            <p className="text-sm font-medium text-foreground">Specialties</p>
            <p className="mt-1 text-xs text-muted">
              Add up to {MAX_SPECIALTIES} tags (e.g. Agaseke Baskets, Imigongo Art) so buyers find you by craft.
            </p>
            <div className="mt-4 flex gap-3">
              <input
                type="text"
                value={specialtyDraft}
                maxLength={MAX_SPECIALTY_LEN}
                onChange={(e) => setSpecialtyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSpecialty();
                  }
                }}
                placeholder="Add a specialty and press Enter"
                className="field w-full"
              />
              <button
                type="button"
                onClick={addSpecialty}
                disabled={!specialtyDraft.trim() || specialties.length >= MAX_SPECIALTIES}
                className="btn btn-secondary shrink-0"
              >
                Add
              </button>
            </div>
            {specialties.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2">
                {specialties.map((s) => (
                  <li key={s}>
                    <span className="badge badge-secondary gap-1.5 pr-1.5">
                      {s}
                      <button
                        type="button"
                        onClick={() => removeSpecialty(s)}
                        aria-label={`Remove ${s}`}
                        className="flex size-4 items-center justify-center rounded-full opacity-70 transition-opacity hover:bg-black/10 hover:opacity-100"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="size-3" aria-hidden="true">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex justify-end">
            <button type="button" onClick={handleSave} disabled={saving || loading} className="btn btn-primary">
              {saving ? "Saving..." : "Save storefront"}
            </button>
          </div>
        </div>

        <aside className="card h-fit p-6">
          <p className="text-sm font-medium text-foreground">Tips for a great shop</p>
          <ul className="mt-3 flex flex-col gap-3 text-sm leading-6 text-secondary">
            <li className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              Use a clear store name buyers will remember.
            </li>
            <li className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              Mention your region so local buyers can find nearby makers.
            </li>
            <li className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              Keep the story short and personal — what you make and why.
            </li>
            <li className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              Verified sellers show a badge that builds buyer trust.
            </li>
          </ul>
          <Link href="/account/verification" className="btn btn-secondary mt-5 w-full">
            Get verified
          </Link>
        </aside>
      </div>
    </div>
  );
}
