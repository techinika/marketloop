import type { Order } from "@/types";
import { cn } from "@/lib/cn";

const PAID = new Set(["held", "released", "refunded", "refund_requested"]);

/**
 * Escrow lifecycle stepper: Payment secured → Delivery confirmed → Funds released.
 * Renders a connected line of steps with done / current / upcoming states.
 */
export function StepTracker({ order }: { order: Order }) {
  const paid = PAID.has(order.escrowStatus);
  const bothConfirmed = order.buyerConfirmedDelivery && order.sellerConfirmedDelivery;
  const released = order.escrowStatus === "released";

  if (!paid) {
    return (
      <div className="rounded-card border border-border bg-background px-4 py-3 text-sm text-secondary">
        Payment hasn&apos;t been secured yet — this order is awaiting payment.
      </div>
    );
  }

  type StepState = "done" | "current" | "upcoming";
  const steps: Array<{ label: string; state: StepState }> = [
    { label: "Payment secured", state: "done" },
    {
      label: "Delivery confirmed",
      state: bothConfirmed || released ? "done" : "current",
    },
    { label: "Funds released", state: released ? "done" : "upcoming" },
  ];

  return (
    <ol className="flex items-center">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        return (
          <li key={step.label} className={cn("flex items-center", isLast ? "flex-none" : "flex-1")}>
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  step.state === "done" && "border-accent bg-accent text-white",
                  step.state === "current" && "border-accent bg-accent-soft text-accent-strong",
                  step.state === "upcoming" && "border-border bg-surface text-muted",
                )}
              >
                {step.state === "done" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-xs font-medium",
                  step.state === "current" ? "text-foreground" : "text-muted",
                )}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div className="mx-2 mb-5 h-0.5 flex-1 rounded-full bg-border">
                <div
                  className={cn(
                    "h-0.5 rounded-full bg-accent transition-all duration-500",
                    step.state === "done" ? "w-full" : "w-0",
                  )}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
