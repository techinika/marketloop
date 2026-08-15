"use client";

import { useMemo } from "react";

import { sanitizeDescription } from "@/lib/html";
import { cn } from "@/lib/cn";

// Looks like actual markup (opposed to legacy plain-text descriptions).
const HAS_MARKUP = /<\/?[a-z][\s\S]*>/i;

/**
 * Renders a listing description as rich text. Always sanitizes before
 * injecting HTML; legacy plain-text descriptions are escaped and wrapped in
 * paragraphs so newlines survive.
 */
export function RichText({ html, className }: { html: string; className?: string }) {
  const safeHtml = useMemo(() => {
    if (!html.trim()) return "";
    if (!HAS_MARKUP.test(html)) {
      const escaped = html
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      const paragraphs = escaped
        .split(/\n\s*\n/)
        .map((block) => block.replace(/\n/g, "<br>").trim())
        .filter(Boolean);
      return paragraphs.map((p) => `<p>${p}</p>`).join("");
    }
    return sanitizeDescription(html);
  }, [html]);

  return <div className={cn("rich-text", className)} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}