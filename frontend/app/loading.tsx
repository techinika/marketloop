export default function RootLoading() {
  return (
    <div className="flex flex-1 items-center justify-center py-32" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <span className="size-8 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  );
}
