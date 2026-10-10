import Link from "next/link";

import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, type Crumb } from "@/lib/seo";

/**
 * Accessible breadcrumb trail that also emits matching BreadcrumbList JSON-LD.
 * The last crumb is rendered as the current page (not a link).
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  const lastIndex = items.length - 1;
  return (
    <>
      <JsonLd data={breadcrumbSchema(items)} />
      <nav aria-label="Breadcrumb" className={className}>
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {items.map((item, index) => (
            <li key={item.path} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">/</span>}
              {index === lastIndex ? (
                <span className="text-secondary">{item.name}</span>
              ) : (
                <Link
                  href={item.path}
                  className="transition-colors hover:text-accent-strong"
                >
                  {item.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
