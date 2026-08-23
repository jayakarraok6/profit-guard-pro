import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ShieldCheck, Check, X, Bell, MessageSquare, ChevronRight } from "lucide-react";
import { CHECKOUTS, decide, inr, stageLabel, type CheckoutInput } from "@/lib/profitguard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Profit Guard — Recover abandoned sales, spend less" },
      {
        name: "description",
        content:
          "Profit Guard tells an online merchant the cheapest sensible way to recover each abandoned checkout — a reminder, a small offer, or nothing at all.",
      },
      { property: "og:title", content: "Profit Guard — Recover abandoned sales, spend less" },
      {
        property: "og:description",
        content:
          "The cheapest sensible action for every abandoned checkout, in plain language. No blind discounting.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProfitGuard,
});

/** Short, human reasons for the chosen action. Presentation only. */
function reasonsFor(c: CheckoutInput, actionCost: number, base: number, final: number): string[] {
  const out: string[] = [];
  if (c.checkout_stage === "payment") {
    out.push("They reached the payment step, so they were close to buying.");
  } else if (c.checkout_stage === "address") {
    out.push("They filled in their address, so this was a real attempt to buy.");
  } else {
    out.push("They left early, at the cart — intent here is still uncertain.");
  }

  if (c.previous_orders >= 4) {
    out.push(`They have bought from you ${c.previous_orders} times before, so they don't need convincing on price.`);
  } else if (c.time_spent_seconds > 240) {
    out.push("They spent several minutes on the checkout, which usually means genuine interest.");
  } else if (c.time_spent_seconds < 60) {
    out.push("They spent less than a minute here, so this may have been casual browsing.");
  }

  if (actionCost === 0) {
    out.push(
      `A free nudge already moves the chance of recovery from about ${Math.round(base * 100)}% to ${Math.round(
        final * 100,
      )}%. Paying for a discount would not add enough to be worth it.`,
    );
  } else {
    out.push(
      `${inr(actionCost)} off is the smallest offer that clearly pays for itself — it lifts recovery from about ${Math.round(
        base * 100,
      )}% to ${Math.round(final * 100)}%.`,
    );
  }
  return out.slice(0, 3);
}

function headline(actionId: string, cost: number) {
  if (actionId === "none") return "DO NOTHING";
  if (cost === 0) return "SEND A REMINDER";
  return `OFFER ${inr(cost)}`;
}

function customerMessage(c: CheckoutInput, actionId: string, cost: number) {
  if (cost === 0)
    return `Hi! You left ${inr(c.cart_value_inr)} worth of items in your cart. Your order is still saved — tap to finish checking out.`;
  return `Hi! Your cart of ${inr(c.cart_value_inr)} is still waiting. Here's ${inr(
    cost,
  )} off to complete your order today.`;
}

type Status = "pending" | "approved" | "ignored";

function ProfitGuard() {
  const [selectedId, setSelectedId] = useState(CHECKOUTS[0]!.customer_id);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});

  const selected = CHECKOUTS.find((c) => c.customer_id === selectedId)!;
  const decision = useMemo(() => decide(selected), [selected]);
  const status: Status = statuses[selectedId] ?? "pending";
  const action = decision.action;
  const reasons = reasonsFor(selected, action.cost, action.baseProb, action.finalProb);
  const showUpside = action.id !== "none" && decision.netGain >= 25;

  const setStatus = (s: Status) => setStatuses((prev) => ({ ...prev, [selectedId]: s }));

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/70">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="h-4.5 w-4.5" />
            </span>
            <span className="truncate text-[15px] font-semibold tracking-tight">Profit Guard</span>
          </div>
          <span className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground">
            DEMO MODE • SYNTHETIC DATA
          </span>
        </div>
      </header>

      {/* Purpose */}
      <section className="mx-auto max-w-6xl px-5 pt-12 pb-10 sm:px-8 sm:pt-16">
        <h1 className="max-w-3xl text-3xl leading-[1.15] font-semibold tracking-tight text-balance sm:text-[42px]">
          Recover abandoned sales without giving away more money than necessary.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          Pick an abandoned checkout. Profit Guard works out whether a reminder, a small offer, or
          nothing at all is the right move — and explains why in plain language.
        </p>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-5 pb-24 sm:px-8 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-10">
        {/* List */}
        <div>
          <h2 className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">
            ABANDONED CHECKOUTS
          </h2>
          <ul className="space-y-2">
            {CHECKOUTS.map((c) => {
              const st = statuses[c.customer_id] ?? "pending";
              const active = c.customer_id === selectedId;
              return (
                <li key={c.customer_id}>
                  <button
                    onClick={() => setSelectedId(c.customer_id)}
                    className={cn(
                      "w-full rounded-xl border px-4 py-3.5 text-left transition-colors",
                      active
                        ? "border-foreground/25 bg-card shadow-card"
                        : "border-border bg-card/60 hover:bg-card",
                    )}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.customer_id}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          Left at {stageLabel(c.checkout_stage)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">{inr(c.cart_value_inr)}</p>
                        <p
                          className={cn(
                            "mt-0.5 text-[11px] font-medium",
                            st === "approved"
                              ? "text-success"
                              : st === "ignored"
                                ? "text-muted-foreground"
                                : "text-warning",
                          )}
                        >
                          {st === "approved" ? "Actioned" : st === "ignored" ? "Ignored" : "Needs review"}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Detail */}
        <div>
          <h2 className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">
            RECOMMENDATION
          </h2>

          {status === "approved" ? (
            <div className="rounded-2xl border border-border bg-card p-7 shadow-card sm:p-10">
              <span className="inline-flex items-center gap-2 rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success">
                <Check className="h-3.5 w-3.5" /> Approved
              </span>
              <h3 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
                {action.cost === 0 ? "Reminder sent" : `${inr(action.cost)} offer sent`} to{" "}
                {selected.customer_id}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                This is what the customer receives (simulated).
              </p>
              <div className="mt-6 max-w-md rounded-2xl rounded-bl-sm border border-border bg-muted/60 p-5">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" /> Message to customer
                </div>
                <p className="mt-2.5 text-[15px] leading-relaxed">
                  {customerMessage(selected, action.id, action.cost)}
                </p>
              </div>
              <button
                onClick={() => setStatus("pending")}
                className="mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Undo <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-7 shadow-card sm:p-10">
              <p className="text-xs font-medium tracking-wide text-muted-foreground">
                For {selected.customer_id} · {inr(selected.cart_value_inr)} cart
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span
                  className={cn(
                    "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
                    action.id === "none" ? "bg-muted text-muted-foreground" : "bg-success-soft text-success",
                  )}
                >
                  <Bell className="h-5 w-5" />
                </span>
                <h3 className="text-3xl leading-none font-semibold tracking-tight sm:text-[40px]">
                  {headline(action.id, action.cost)}
                </h3>
              </div>

              <ul className="mt-7 space-y-3.5">
                {reasons.map((r) => (
                  <li key={r} className="flex gap-3 text-[15px] leading-relaxed">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/30" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>

              {showUpside && (
                <div className="mt-7 flex flex-wrap gap-x-10 gap-y-4 border-t border-border pt-6">
                  <div>
                    <p className="text-xs text-muted-foreground">Estimated upside</p>
                    <p className="mt-1 text-lg font-semibold text-success tabular-nums">
                      +{inr(decision.netGain)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Merchant keeps</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {inr(decision.margin - action.cost)}
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setStatus("approved")}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Check className="h-4 w-4" />
                  Approve recommendation
                </button>
                <button
                  onClick={() => setStatus("ignored")}
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                  Ignore
                </button>
                {status === "ignored" && (
                  <span className="text-xs text-muted-foreground">Marked as ignored.</span>
                )}
              </div>
            </div>
          )}

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Recommendations are calculated live from cart value, margin, checkout stage and past
            behaviour. Offers that would cost more than they return are never suggested.
          </p>
        </div>
      </section>
    </main>
  );
}
