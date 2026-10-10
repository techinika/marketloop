/**
 * HandiPattern — an original, abstracted geometric pattern drawn in the
 * visual tradition of Imigongo spirals and Agaseke banded weave (deliberately
 * simplified, not a copy of any single artisan's work).
 *
 * Render as a subtle full-size background texture (`<HandiPattern fill />`)
 * or as a short divider strip (`<HandiPattern divider />`). Use sparingly —
 * an accent, not wallpaper.
 */

const MOTIF_SIZE = 64;

/** One tile: concentric spiral arcs + diagonal weave bands. */
function Motif({ tone }: { tone: string }) {
  return (
    <g fill="none" stroke={tone} strokeWidth="1">
      {/* Weave bands (Agaseke-style) */}
      <path d="M0 8h64M0 40h64" strokeWidth="0.75" opacity="0.6" />
      <path d="M8 0v64M40 0v64" strokeWidth="0.75" opacity="0.6" />
      {/* Spiral motif (Imigongo-inspired) */}
      <path
        d="M20 32a12 12 0 1 1 12-12 12 12 0 0 1-12 12 8 8 0 1 1 8-8 8 8 0 0 1-8 8"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M44 26a6 6 0 1 1 6-6 6 6 0 0 1-6 6 3.5 3.5 0 1 1 3.5-3.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </g>
  );
}

export function HandiPattern({ className, tone }: { className?: string; tone?: string }) {
  const stroke = tone ?? "var(--color-ochre)";
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
    >
      <defs>
        <pattern
          id="handi-motif"
          width={MOTIF_SIZE}
          height={MOTIF_SIZE}
          patternUnits="userSpaceOnUse"
        >
          <Motif tone={stroke} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#handi-motif)" />
    </svg>
  );
}

/** Decorative section divider made from a strip of the motif. */
export function HandiDivider({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 32 8" className="h-2 w-full text-ochre/50" role="presentation">
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(${i * 8} 0)`} fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M2 6a3 3 0 1 1 3-3 3 3 0 0 1-3 3" strokeLinecap="round" />
            <path d="M8 1h4M8 7h4" opacity="0.6" />
          </g>
        ))}
      </svg>
    </div>
  );
}