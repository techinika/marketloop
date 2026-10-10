import type { Order, ProductionStatus } from "@/types";
import { cn } from "@/lib/cn";

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

const PAID = new Set(["held", "released", "refunded", "refund_requested"]);

/** Milestone labels for the made-to-order lifecycle, by payment plan. */
function productionMilestones(deposit: boolean): string[] {
  return deposit
    ? ["Deposit secured", "In production", "Ready — pay remaining", "Delivery confirmed", "Funds released"]
    : ["Payment secured", "In production", "Ready for delivery", "Delivery confirmed", "Funds released"];
}

/** Maps a production status to per-milestone states (5 milestones). */
function productionStates(ps: ProductionStatus, deposit: boolean): StepState[] {
  const allDone: StepState[] = ["done", "done", "done", "done", "done"];
  switch (ps) {
    case "in_production":
      return ["done", "current", "upcoming", "upcoming", "upcoming"];
    case "awaiting_final_payment":
      return ["done", "done", "current", "upcoming", "upcoming"];
    case "awaiting_delivery":
      return ["done", "done", "done", "current", "upcoming"];
    case "released":
      return allDone;
    default:
      return deposit ? ["done", "current", "upcoming", "upcoming", "upcoming"] : ["done", "current", "upcoming", "upcoming", "upcoming"];
  }
}

function renderSteps(steps: Array<{ label: string; state: StepState }>) {
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

/**
 * Order lifecycle stepper. New made-to-order orders run the production
 * lifecycle (Deposit → In production → Ready → Delivery → Released); legacy
 * orders without a production status fall back to the escrow tracker.
 */
export function StepTracker({ order }: { order: Order }) {
  const ps = order.productionStatus;
  const deposit = order.paymentPlan === "deposit";
  const hasDispute = order.hasDispute === true;
  const released = order.escrowStatus === "released";
  const paid = PAID.has(order.escrowStatus);

  // Terminal production states render a dedicated short tracker.
  if (ps === "cancelled_by_mutual_agreement") {
    return renderSteps([
      { label: "Payment secured", state: "done" },
      { label: "In production", state: "done" },
      { label: "Cancelled (mutual)", state: "danger" },
    ]);
  }
  if (ps === "cancelled_forfeited") {
    return renderSteps([
      { label: "Payment secured", state: "done" },
      { label: "In production", state: "done" },
      { label: "Deposit forfeited", state: "danger" },
    ]);
  }
  if (ps === "refunded" || order.escrowStatus === "refunded") {
    return renderSteps([
      { label: "Payment secured", state: "done" },
      { label: "Refunded", state: "done" },
    ]);
  }

  if (ps === undefined) {
    // Legacy escrow-only lifecycle (pre made-to-order).
    const bothConfirmed = order.buyerConfirmedDelivery && order.artisanConfirmedDelivery;
    if (!paid) {
      return (
        <div className="rounded-card border border-border bg-background px-4 py-3 text-sm text-secondary">
          Payment hasn&apos;t been secured yet — this order is awaiting payment.
        </div>
      );
    }
    if (hasDispute) {
      return renderSteps([
        { label: "Payment secured", state: "done" },
        { label: "Delivery confirmed", state: bothConfirmed ? "done" : "current" },
        { label: "Under review", state: "danger" },
      ]);
    }
    if (order.escrowStatus === "refund_requested") {
      return renderSteps([
        { label: "Payment secured", state: "done" },
        { label: "Refund requested", state: "current" },
      ]);
    }
    return renderSteps([
      { label: "Payment secured", state: "done" },
      { label: "Delivery confirmed", state: bothConfirmed || released ? "done" : "current" },
      { label: "Funds released", state: released ? "done" : "upcoming" },
    ]);
  }

  if (!paid) {
    return (
      <div className="rounded-card border border-border bg-background px-4 py-3 text-sm text-secondary">
        Payment hasn&apos;t been secured yet — this order is awaiting payment.
      </div>
    );
  }

  if (hasDispute) {
    return renderSteps([
      { label: "Payment secured", state: "done" },
      { label: "In production / delivery", state: ["released"].includes(ps) ? "done" : "current" },
      { label: "Under review", state: "danger" },
    ]);
  }

  const states = productionStates(ps, deposit);
  const milestones = productionMilestones(deposit);
  return renderSteps(milestones.map((label, index) => ({ label, state: states[index]! })));
}