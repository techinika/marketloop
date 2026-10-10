import { siteUrl } from "@/lib/env";

/** One step in a breadcrumb trail. `path` is root-relative ("/c/pottery"). */
export interface Crumb {
  name: string;
  path: string;
}

/** schema.org BreadcrumbList for a trail of crumbs (Home is added by callers). */
export function breadcrumbSchema(crumbs: Crumb[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${siteUrl}${crumb.path === "/" ? "" : crumb.path}`,
    })),
  };
}

/** schema.org Organization for the brand entity (name, logo, socials). */
export function organizationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Handi",
    url: siteUrl,
    logo: `${siteUrl}/icon.svg`,
    description:
      "Handi is the marketplace for handmade Rwandan craft — baskets, Imigongo art, wood carvings and more, commissioned directly from the artisans who make them.",
  };
}
