import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-page flex flex-1 flex-col items-center justify-center py-24 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-muted">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
        Page not found
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-secondary">
        The page you&apos;re looking for doesn&apos;t exist or has been removed. Try the
        marketplace instead.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/explore" className="btn btn-primary">
          Browse the marketplace
        </Link>
        <Link href="/" className="btn btn-secondary">
          Go home
        </Link>
      </div>
    </div>
  );
}
