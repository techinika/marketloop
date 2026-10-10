"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { formatPrice, mediaUrl } from "@/lib/publicApi";
import type { Product } from "@/types";
import { cn } from "@/lib/cn";

/**
 * Small rotating gallery for the homepage hero. Cycles through a handful of
 * featured pieces with a gentle fade so the craft itself leads the landing page.
 */
export function HeroGallery({ products }: { products: Product[] }) {
  const withCover = useMemo(() => products.filter((p) => p.images.length > 0), [products]);
  const slides = withCover.slice(0, 3);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), 4200);
    return () => clearInterval(timer);
  }, [slides.length]);

  if (slides.length === 0) {
    return (
      <div className="relative aspect-square w-full max-w-lg overflow-hidden bg-surface-muted">
        <svg viewBox="0 0 200 200" className="size-full text-ochre/40" aria-hidden="true">
          {[16, 48, 80, 112, 144, 176].map((y) => (
            <g key={y} fill="none" stroke="currentColor" strokeWidth="1">
              <path d={`M0 ${y + 8}h200M0 ${y + 40}h200`} opacity="0.5" />
              <path
                d={`M${y} 0l0 200M${y + 32} 0l0 200`}
                opacity="0.5"
              />
            </g>
          ))}
        </svg>
      </div>
    );
  }

  const active = slides[index];
  void active;

  return (
    <div className="relative aspect-square w-full max-w-lg">
      <div className="relative h-full w-full overflow-hidden img-warm shadow-lifted">
        {slides.map((slide, i) => (
          <Link
            key={slide.id}
            href={`/product/${slide.id}`}
            className={cn(
              "absolute inset-0 block transition-opacity duration-700",
              i === index ? "opacity-100" : "opacity-0",
            )}
          >
            <Image
              src={mediaUrl(slide.images[0])}
              alt={slide.title}
              fill
              priority={i === 0}
              sizes="(max-width: 1024px) 100vw, 40vw"
              className="object-cover"
            />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-5 pb-4 pt-14">
              <span className={cn("badge", slide.productType === "made_to_order" ? "badge-ochre" : "badge-secondary")}>
                {slide.productType === "made_to_order" ? "Made to order" : "Ready to ship"}
              </span>
              <span className="mt-2 block text-lg font-medium text-white">{slide.title}</span>
              <span className="block text-sm text-white/80">
                {formatPrice(slide.priceAmount, slide.priceCurrency)}
              </span>
            </span>
          </Link>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="absolute -bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Show ${slide.title}`}
              onClick={() => setIndex(i)}
              className={cn(
                "size-2 rounded-full transition-colors",
                i === index ? "bg-accent" : "bg-border",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}