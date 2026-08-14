"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";

/** Interactive 1-5 star picker used by the delivery-confirmation flow. */
export function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (rating: number) => void;
}) {
  const [hovered, setHovered] = useState(0);

  return (
    <div
      className="flex items-center gap-1"
      role="radiogroup"
      aria-label="Your rating"
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const active = hovered >= n || (!hovered && value >= n);
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHovered(n)}
            className="rounded-md p-0.5 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg
              viewBox="0 0 24 24"
              fill={active ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn("size-7", active ? "text-amber-500" : "text-muted")}
              aria-hidden="true"
            >
              <path d="M11.5 2.5 14 7.6l5.6.8-4.05 3.9.95 5.6-5-2.6-5 2.6.95-5.6L3.3 8.4l5.6-.8z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

/** Compact read-only badge: ★ 4.5 (12). Renders nothing without a rating. */
export function RatingBadge({
  avgRating,
  ratingCount,
  className,
}: {
  avgRating: number | null | undefined;
  ratingCount?: number;
  className?: string;
}) {
  if (avgRating == null || avgRating <= 0) return null;
  const count = ratingCount ?? 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-secondary",
        className,
      )}
      title={`${avgRating} out of 5 from ${count} rating${count === 1 ? "" : "s"}`}
    >
      <span className="text-amber-500" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" className="size-3.5" aria-hidden="true">
          <path d="M11.5 2.5 14 7.6l5.6.8-4.05 3.9.95 5.6-5-2.6-5 2.6.95-5.6L3.3 8.4l5.6-.8z" />
        </svg>
      </span>
      <span className="font-semibold">{avgRating.toFixed(1)}</span>
      <span className="text-muted">({count})</span>
    </span>
  );
}
