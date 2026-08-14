"use client";

import { useRouter } from "next/navigation";

export default function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  return (
    <div className="container-page flex flex-1 flex-col items-center justify-center py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Couldn&apos;t load this page
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-secondary">
        {error.message || "An unexpected error occurred."}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <button type="button" onClick={() => router.back()} className="btn btn-secondary">
          Go back
        </button>
      </div>
    </div>
  );
}
