import type { Order } from "@/types";
import { cn } from "@/lib/cn";

const PAID = new Set(["held", "released", "refunded", "refund_requested"]);

type StepState = "done" | "current" | "upcoming" | "danger";

const DONE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const ALERT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

/**
 * Escrow lifecycle stepper: Payment secured → Delivery confirmed → Funds released.
 * Handles the dispute ("under review") and refund states introduced with the
 * delivery-confirmation flow.
 */
export function StepTracker({ order }: { order: Order }) {
  const paid = PAID.has(order.escrowStatus);
  const hasDispute = order.hasDispute === true;
  const bothConfirmed = order.buyerConfirmedDelivery && order.sellerConfirmedDelivery;
  const released = order.escrowStatus === "released";
  const refunding = order.escrowStatus === "refunded" || order.escrowStatus === "refund_requested";

  if (!paid) {
    return (
      <div className="rounded-card border border-border bg-background px-4 py-3 text-sm text-secondary">
        Payment hasn&apos;t been secured yet — this order is awaiting payment.
      </div>
    );
  }

  let steps: Array<{ label: string; state: StepState }>;
  if (hasDispute) {
    steps = [
      { label: "Payment secured", state: "done" },
      {
        label: "Delivery confirmed",
        state: bothConfirmed ? "done" : "current",
      },
      { label: "Under review", state: "danger" },
    ];
  } else if (refunding) {
    steps = [
      { label: "Payment secured", state: "done" },
      { label: "Delivery confirmed", state: "done" },
      {
        label: order.escrowStatus === "refunded" ? "Refunded" : "Refund requested",
        state: order.escrowStatus === "refunded" ? "done" : "current",
      },
    ];
  } else {
    steps = [
      { label: "Payment secured", state: "done" },
      {
        label: "Delivery confirmed",
        state: bothConfirmed || released ? "done" : "current",
      },
      { label: "Funds released", state: released ? "done" : "upcoming" },
    ];
  }

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
                  step.state === "danger" && "border-danger bg-danger-soft text-danger",
                  step.state === "upcoming" && "border-border bg-surface text-muted",
                )}
              >
                {step.state === "done" ? DONE_ICON : step.state === "danger" ? ALERT_ICON : index + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-xs font-medium",
                  step.state === "current" || step.state === "danger" ? "text-foreground" : "text-muted",
                )}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div className="mx-2 mb-5 h-0.5 flex-1 rounded-full bg-border">
                <div
                  className={cn(
                    "h-0.5 rounded-full transition-all duration-500",
                    step.state === "done" ? "w-full bg-accent" : "w-0",
                    step.state === "danger" && "w-full bg-danger",
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
