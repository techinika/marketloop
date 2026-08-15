import DOMPurify from "isomorphic-dompurify";

/**
 * Safe server + client sanitizer for listing descriptions. Descriptions are
 * seller-authored HTML from the WYSIWYG editor, so every render path must go
 * through here before `dangerouslySetInnerHTML`. The allowlist mirrors what the
 * editor can actually emit (Tiptap StarterKit + Link): text formatting, lists,
 * headings, quotes, code blocks and links.
 */
export function sanitizeDescription(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "s",
      "strike",
      "del",
      "u",
      "mark",
      "code",
      "pre",
      "blockquote",
      "ol",
      "ul",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "a",
      "span",
      "sub",
      "sup",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "title", "start"],
  });
}

/**
 * Plain-text view of an HTML description (meta tags, search snippets, empty
 * checks). Strips markup and decodes the common entities, keeping whitespace
 * readable.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}