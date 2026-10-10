import type { ReactNode } from "react";

import { HandiDivider } from "@/components/HandiPattern";

/**
 * Shared shell for static content pages (legal, about, help): a consistent
 * eyebrow badge, headline, intro and styled prose body.
 */
export function ContentPage({
  eyebrow = "Handi",
  title,
  intro,
  updated,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex-1">
      <section className="border-b border-border bg-surface">
        <div className="container-page py-12 sm:py-16">
          <span className="badge badge-neutral">{eyebrow}</span>
          <h1 className="heading mt-4 text-4xl text-foreground sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-secondary">{intro}</p>
          {updated && <p className="mt-4 text-sm text-muted">Last updated {updated}</p>}
        </div>
      </section>

      <HandiDivider className="mx-auto max-w-6xl px-6 pt-8" />

      <section className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-3xl space-y-8 [&_h2]:heading [&_h2]:text-xl [&_h2]:text-foreground [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_p]:mt-2 [&_p]:text-sm [&_p]:leading-7 [&_p]:text-secondary [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_li]:text-sm [&_li]:leading-7 [&_li]:text-secondary [&_a]:font-medium [&_a]:text-accent-strong [&_a]:underline [&_a]:underline-offset-2">
          {children}
        </div>
      </section>
    </div>
  );
}
