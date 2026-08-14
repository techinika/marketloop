/**
 * Lowercased, deduped title words (length >= 2) used for Firestore prefix
 * search via `array-contains-any` on the `titleKeywords` field. Punctuation is
 * dropped so "iPhone 12" -> ["iphone", "12"]. This is deliberately simple
 * (exact keyword membership); Algolia/Typesense are the upgrade path if it
 * ever becomes insufficient.
 */
export function titleKeywords(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 2);
  return [...new Set(words)];
}
