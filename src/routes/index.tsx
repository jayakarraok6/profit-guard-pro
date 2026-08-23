import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ShieldCheck,
  ArrowRight,
  Check,
  X,
  Bell,
  BadgeIndianRupee,
  MinusCircle,
  Clock,
  Repeat,
  Layers,
  MessageSquare,
} from "lucide-react";
import { CHECKOUTS, decide, inr, stageLabel, type CheckoutInput, type ActionId } from "@/lib/profitguard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Profit Guard — Smart abandoned checkout recovery" },
      {
        name: "description",
        content:
          "Profit Guard recommends the cheapest sensible action for each abandoned checkout — reminder, small offer, or nothing at all — with clear reasoning and expected profit impact.",
      },
      { property: "og:title", content: "Profit Guard — Smart abandoned checkout recovery" },
      {
        property: "og:description",
        content:
          "Decide the cheapest sensible intervention for every abandoned checkout, without blindly giving away discounts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProfitGuard,
});

type Status = "pending" | "approved" | "ignored";

const actionIcon = (id: ActionId) =>
  id === "none" ? MinusCircle : id === "reminder" ? Bell : BadgeIndianRupee;

function ProfitGuard() {
  const [selectedId, setSelectedId] = useState<string>(CHECKOUTS[0]!.customer_id);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});

  const selected = useMemo(
    () => CHECKOUTS.find((c) => c.customer_id === selectedId)!,
    [selectedId],
  );
  const decision = useMemo(() => decide(selected), [selected]);
  const status = statuses[selected.customer_id] ?? "pending";

  const totals = useMemo(() => {
    let protectedValue = 0;
    let spend = 0;
    CHECKOUTS.forEach((c) => {
      const d = decide(c);
      protectedValue += Math.max(0, d.netGain);
      spend += d.action.cost;
    });
    return { protectedValue, spend };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-extrabold tracking-tight">Profit Guard</p>
              <p className="truncate text-xs text-muted-foreground">Checkout recovery, priced sensibly</p>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-warning/40 bg-warning-soft px-2.5 py-1 text-[11px] font-semibold text-foreground/80">
            Demo mode · synthetic data
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <section className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            The cheapest sensible way to recover an abandoned checkout
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Profit Guard reviews each abandoned checkout and recommends one action — do nothing, send a
            reminder, or a small ₹100–₹300 offer — based on expected profit, not guesswork. It refuses to
            spend your money when the evidence is weak.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Stat label="Checkouts in queue" value={String(CHECKOUTS.length)} />
            <Stat label="Expected profit protected" value={inr(totals.protectedValue)} tone="success" />
            <Stat label="Recommended discount spend" value={inr(totals.spend)} />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Abandoned checkouts
            </h2>
            <div className="space-y-2">
              {CHECKOUTS.map((c) => {
                const d = decide(c);
                const st = statuses[c.customer_id] ?? "pending";
                const active = c.customer_id === selectedId;
                return (
                  <button
                    key={c.customer_id}
                    onClick={() => setSelectedId(c.customer_id)}
                    className={cn(
                      "w-full rounded-xl border bg-card p-3.5 text-left transition-all",
                      active
                        ? "border-primary/60 shadow-lift ring-1 ring-primary/20"
                        : "border-border hover:border-primary/30 hover:shadow-card",
                    )}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{c.customer_id}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          Left at {stageLabel(c.checkout_stage)} · {c.previous_orders} past orders
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-bold tabular-nums">{inr(c.cart_value_inr)}</p>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <ActionPill id={d.action.id} label={d.action.label} compact />
                      {st !== "pending" && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            st === "approved"
                              ? "bg-success-soft text-success"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {st === "approved" ? "Approved" : "Ignored"}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-4">
            <RecommendationCard
              checkout={selected}
              decision={decision}
              status={status}
              onApprove={() =>
                setStatuses((s) => ({ ...s, [selected.customer_id]: "approved" }))
              }
              onIgnore={() => setStatuses((s) => ({ ...s, [selected.customer_id]: "ignored" }))}
              onReset={() => setStatuses((s) => ({ ...s, [selected.customer_id]: "pending" }))}
            />
          </section>
        </div>

        <p className="mx-auto mt-10 max-w-3xl text-center text-xs leading-relaxed text-muted-foreground">
          Prototype only. Profit Guard is an independent concept demo — it does not use real Razorpay data,
          real customer records, or send real customer communications. Price-sensitivity and
          recovery-probability values are synthetic prototype signals.
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-bold tabular-nums", tone === "success" && "text-success")}>{value}</p>
    </div>
  );
}

function ActionPill({ id, label, compact }: { id: ActionId; label: string; compact?: boolean }) {
  const Icon = actionIcon(id);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold",
        compact ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs",
        id === "none"
          ? "border-border bg-muted text-muted-foreground"
          : id === "reminder"
            ? "border-brand/25 bg-brand-soft text-brand"
            : "border-success/25 bg-success-soft text-success",
      )}
    >
      <Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {label}
    </span>
  );
}

function RecommendationCard({
  checkout,
  decision,
  status,
  onApprove,
  onIgnore,
  onReset,
}: {
  checkout: CheckoutInput;
  decision: ReturnType<typeof decide>;
  status: Status;
  onApprove: () => void;
  onIgnore: () => void;
  onReset: () => void;
}) {
  const a = decision.action;
  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className="border-b border-border/70 px-5 py-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-extrabold tracking-tight">{checkout.customer_id}</p>
              <p className="truncate text-xs text-muted-foreground">
                {inr(checkout.cart_value_inr)} cart · {checkout.estimated_margin_pct}% est. margin ·{" "}
                {inr(decision.margin)} margin
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold capitalize text-muted-foreground">
              {checkout.checkout_stage} stage
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Signal icon={Clock} label="Time on checkout" value={`${checkout.time_spent_seconds}s`} />
            <Signal icon={Repeat} label="Past orders" value={String(checkout.previous_orders)} />
            <Signal
              icon={Layers}
              label="Used discount before"
              value={checkout.previous_discount_used ? "Yes" : "No"}
            />
            <Signal
              icon={BadgeIndianRupee}
              label="Price sensitivity"
              value={`${Math.round(checkout.test_price_sensitivity * 100)}%`}
              hint="synthetic"
            />
          </div>
        </div>

        <div className="bg-gradient-to-b from-success-soft/50 to-transparent px-5 py-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Recommended action
          </p>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <h3 className="min-w-0 truncate text-2xl font-extrabold tracking-tight">{a.label}</h3>
            <ActionPill id={a.id} label={a.cost > 0 ? `${inr(a.cost)} cost` : "No spend"} />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-foreground/80">{decision.reason}</p>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Metric
              label="Recovery chance"
              value={`${Math.round(a.baseProb * 100)}% → ${Math.round(a.finalProb * 100)}%`}
            />
            <Metric label="Discount cost" value={inr(a.cost)} />
            <Metric
              label="Expected profit gain"
              value={(decision.netGain > 0 ? "+" : "") + inr(decision.netGain)}
              tone={decision.netGain > 0 ? "success" : undefined}
            />
          </div>

          {status === "pending" ? (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={onApprove}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Check className="h-4 w-4" /> Approve
              </button>
              <button
                onClick={onIgnore}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
              >
                <X className="h-4 w-4" /> Ignore
              </button>
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-border bg-card p-4">
              {status === "approved" ? (
                <>
                  <p className="flex items-center gap-2 text-sm font-semibold text-success">
                    <Check className="h-4 w-4" /> Action approved (simulated)
                  </p>
                  <div className="mt-3 rounded-lg bg-muted/70 p-3">
                    <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      <MessageSquare className="h-3.5 w-3.5" /> Simulated customer notification
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed">
                      {a.id === "none"
                        ? "No message sent. This checkout was left to convert on its own."
                        : a.id === "reminder"
                          ? `“Your ${inr(checkout.cart_value_inr)} order is still waiting. Finish checkout in one tap.”`
                          : `“Come back and save ${inr(a.cost)} on your ${inr(checkout.cart_value_inr)} order. Offer valid for 24 hours.”`}
                    </p>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Simulated outcome: recovery chance now {Math.round(a.finalProb * 100)}%, expected profit
                    impact {(decision.netGain > 0 ? "+" : "") + inr(decision.netGain)}.
                  </p>
                </>
              ) : (
                <p className="text-sm font-semibold text-muted-foreground">
                  Recommendation ignored. No action taken and no money spent.
                </p>
              )}
              <button
                onClick={onReset}
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
              >
                Reset this checkout <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          How the options compare
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Action</th>
                <th className="pb-2 text-right font-medium">Recovery</th>
                <th className="pb-2 text-right font-medium">Cost</th>
                <th className="pb-2 text-right font-medium">Expected gain</th>
              </tr>
            </thead>
            <tbody>
              {decision.options.map((o) => (
                <tr
                  key={o.id}
                  className={cn(
                    "border-t border-border/70",
                    o.id === a.id && "bg-success-soft/40 font-semibold",
                  )}
                >
                  <td className="py-2 pr-2">
                    {o.label}
                    {!o.allowed && (
                      <span className="ml-2 text-[11px] font-medium text-muted-foreground">blocked</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{Math.round(o.finalProb * 100)}%</td>
                  <td className="py-2 text-right tabular-nums">{inr(o.cost)}</td>
                  <td
                    className={cn(
                      "py-2 text-right tabular-nums",
                      o.id !== "none" && o.gainVsNothing > 0 && "text-success",
                    )}
                  >
                    {o.id === "none" ? "—" : (o.gainVsNothing > 0 ? "+" : "") + inr(o.gainVsNothing)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-4 space-y-1.5">
          {decision.guardrails.map((g) => (
            <li key={g} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              {g}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function Signal({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 px-2.5 py-2">
      <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" /> {label}
        {hint && <span className="text-[10px] italic opacity-70">({hint})</span>}
      </p>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
  );
}
