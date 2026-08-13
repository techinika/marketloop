import type { ReactNode } from "react";

const KEYFRAMES = `
@keyframes hero-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
@keyframes hero-float-slow {
  0%, 100% { transform: translateY(0) rotate(-1.5deg); }
  50% { transform: translateY(-14px) rotate(1.5deg); }
}
@keyframes hero-orbit {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes hero-bob {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-6px) rotate(4deg); }
}
`;

function MiniIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
      {children}
    </span>
  );
}

const ICON_STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" {...ICON_STROKE} className={className} aria-hidden="true">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" />
    </svg>
  );
}

function BagIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" {...ICON_STROKE} className={className} aria-hidden="true">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

function TagIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" {...ICON_STROKE} className={className} aria-hidden="true">
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42Z" />
      <circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BoxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" {...ICON_STROKE} className={className} aria-hidden="true">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function CoinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" {...ICON_STROKE} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10" />
      <path d="M14.5 9.5a2.5 2.5 0 1 0-5 0c0 2.5 5 2.5 5 5a2.5 2.5 0 1 1-5 0" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" {...ICON_STROKE} strokeWidth={2.5} className={className} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function FloatingCard({
  className,
  animation,
  icon,
  label,
  sub,
}: {
  className: string;
  animation: string;
  icon: ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <div className={`absolute ${className}`} style={{ animation }}>
      <div className="card flex items-center gap-2.5 p-3 shadow-lifted">
        <MiniIcon>{icon}</MiniIcon>
        <div>
          <p className="text-xs font-semibold leading-none text-foreground">{label}</p>
          <p className="mt-1 text-[11px] leading-none text-muted">{sub}</p>
        </div>
      </div>
    </div>
  );
}

export function HeroIllustration() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden="true">
      <style>{KEYFRAMES}</style>

      <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-accent-soft via-surface to-surface-muted" />
      <div
        className="absolute inset-0 rounded-[2rem] opacity-40 [background-image:radial-gradient(circle_at_center,var(--color-border)_1px,transparent_1px)] [background-size:22px_22px]"
      />

      <div className="relative aspect-square">
        <div
          className="absolute left-1/2 top-1/2 h-[78%] w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-border"
          style={{ animation: "hero-orbit 30s linear infinite" }}
        >
          <span className="absolute left-1/2 top-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_4px_var(--color-accent-soft)]" />
        </div>
        <div className="absolute left-1/2 top-1/2 h-[58%] w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/70" />

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative">
            <span className="absolute -inset-8 animate-ping rounded-full bg-accent/15" />
            <div className="card relative flex size-32 flex-col items-center justify-center gap-2 shadow-lifted sm:size-36">
              <span className="relative flex size-14 items-center justify-center rounded-2xl bg-accent text-white sm:size-16">
                <ShieldIcon className="size-7 sm:size-8" />
                <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-accent-strong text-white shadow-lifted">
                  <CheckIcon className="size-3" />
                </span>
              </span>
              <span className="text-sm font-semibold tracking-tight text-foreground">Escrow secured</span>
              <span className="text-[11px] text-muted">Protected until delivery</span>
            </div>
          </div>
        </div>

        <FloatingCard
          className="left-0 top-4 sm:left-1 sm:top-8"
          animation="hero-float 5.5s ease-in-out infinite"
          icon={<BagIcon className="size-4.5" />}
          label="Marketplace"
          sub="Buy & sell"
        />

        <FloatingCard
          className="right-0 top-12 sm:right-1"
          animation="hero-float-slow 8s ease-in-out infinite"
          icon={<TagIcon className="size-4.5" />}
          label="Best offers"
          sub="Negotiate any price"
        />

        <FloatingCard
          className="bottom-10 left-2 sm:bottom-12"
          animation="hero-float-slow 9s ease-in-out infinite"
          icon={<BoxIcon className="size-4.5" />}
          label="Tracked delivery"
          sub="Confirmed by both sides"
        />

        <FloatingCard
          className="bottom-4 right-0 sm:bottom-6 sm:right-1"
          animation="hero-float 6.5s ease-in-out infinite"
          icon={<CoinIcon className="size-4.5" />}
          label="Seller wallet"
          sub="RWF & USD payouts"
        />

        <div
          className="absolute left-[46%] top-[8%] flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-white shadow-lifted"
          style={{ animation: "hero-bob 4.5s ease-in-out infinite" }}
        >
          <CheckIcon className="size-3" />
          Payment held
        </div>
      </div>
    </div>
  );
}
