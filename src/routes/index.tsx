import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ShieldCheck, Check, X, Bell, RefreshCw, BadgePercent, MinusCircle, ChevronRight } from "lucide-react";
import { CHECKOUTS, decide, inr, pct, stageLabel, paymentLabel, actionHeadline, type ActionOption, type CheckoutInput } from "@/lib/profitguard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Profit Guard — Choose the recovery action worth taking" },
    { name: "description", content: "Profit Guard recommends the most economically sensible recovery action for at-risk checkouts." },
    { property: "og:title", content: "Profit Guard — Choose the recovery action worth taking" },
    { property: "og:description", content: "A transparent recovery decision engine for abandoned checkouts." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ]}),
  component: ProfitGuard,
});

function ActionIcon({ kind, className }: { kind: ActionOption["kind"]; className?: string }) {
  if (kind === "retry") return <RefreshCw className={className} />;
  if (kind === "offer") return <BadgePercent className={className} />;
  if (kind === "none") return <MinusCircle className={className} />;
  return <Bell className={className} />;
}

function shortReasons(c: CheckoutInput): string[] {
  const out: string[] = [];
  if (c.checkout_stage === "payment") out.push("They reached the payment step, so they were close to buying.");
  else if (c.checkout_stage === "address") out.push("They filled in their address, so this was a real attempt to buy.");
  else out.push("They left early, at the cart, so purchase intent is still uncertain.");
  if (c.payment_status === "failed") out.push(`The payment failed (${c.payment_failure_reason ?? "declined"}), so a discount is not the first fix.`);
  else if (c.previous_orders >= 4) out.push(`They have bought from you ${c.previous_orders} times before.`);
  else if (c.time_spent_seconds > 240) out.push("They spent several minutes here, which indicates genuine interest.");
  else if (c.time_spent_seconds < 60) out.push("They spent less than a minute here, so this may have been casual browsing.");
  if (c.previous_recovery_attempts > 0) out.push(`${c.previous_recovery_attempts} earlier recovery attempt${c.previous_recovery_attempts > 1 ? "s" : ""} on this checkout did not convert.`);
  else if (c.hours_since_abandoned <= 12) out.push("The checkout is still fresh, so a light intervention can be timely.");
  else out.push("The checkout is going cold, so further intervention needs a clear reason.");
  return out.slice(0, 3);
}

function customerMessage(c: CheckoutInput, a: ActionOption) {
  if (a.kind === "retry") return `Hi! Your payment of ${inr(c.cart_value_inr)} didn't go through. Your order is saved — tap to retry.`;
  if (a.kind === "offer") return `Hi! Your cart of ${inr(c.cart_value_inr)} is still waiting. Here's ${inr(a.cost)} off to complete your order today.`;
  return `Hi! You left ${inr(c.cart_value_inr)} worth of items in your cart. Your order is still saved — tap to finish checking out.`;
}

type Status = "pending" | "approved" | "ignored";

function ProfitGuard() {
  const [selectedId, setSelectedId] = useState(CHECKOUTS[0]!.customer_id);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});

  const isResolved = (id: string) => statuses[id] === "approved" || statuses[id] === "ignored";
  const activeCheckouts = CHECKOUTS.filter((c) => !isResolved(c.customer_id));

  const selected = CHECKOUTS.find((c) => c.customer_id === selectedId)!;
  const decision = useMemo(() => decide(selected), [selected]);
  const status: Status = statuses[selectedId] ?? "pending";
  const action = decision.action;
  const reasons = shortReasons(selected);
  const isNone = action.kind === "none";
  const setStatus = (s: Status) => setStatuses((prev) => ({ ...prev, [selectedId]: s }));


  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border/70"><div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:px-8"><div className="flex min-w-0 items-center gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck className="h-4 w-4" /></span><span className="truncate text-[15px] font-semibold tracking-tight">Profit Guard</span></div><span className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground">DEMO MODE • SYNTHETIC DATA</span></div></header>
      <section className="mx-auto max-w-6xl px-5 pt-12 pb-10 sm:px-8 sm:pt-16"><h1 className="max-w-3xl text-3xl leading-[1.15] font-semibold tracking-tight text-balance sm:text-[42px]">Choose the recovery action worth taking.</h1><p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">Profit Guard looks at each at-risk checkout and recommends one sensible action: no intervention, a reminder, a payment retry, or a merchant-approved offer.</p></section>
      <section className="mx-auto grid max-w-6xl gap-8 px-5 pb-24 sm:px-8 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-10">
        <div><h2 className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">AT-RISK CHECKOUTS</h2>{activeCheckouts.length === 0 ? <div className="rounded-xl border border-border bg-card/60 px-4 py-8 text-center"><p className="text-sm font-medium">All caught up</p><p className="mt-1 text-xs text-muted-foreground">No checkouts need a decision right now.</p></div> : <ul className="space-y-2">{activeCheckouts.map((c) => { const active = c.customer_id === selectedId; return <li key={c.customer_id}><button onClick={() => setSelectedId(c.customer_id)} className={cn("w-full rounded-xl border px-4 py-3.5 text-left transition-colors", active ? "border-foreground/25 bg-card shadow-card" : "border-border bg-card/60 hover:bg-card")}><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{c.customer_id}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">Left at {stageLabel(c.checkout_stage)} · {paymentLabel(c)}</p></div><div className="shrink-0 text-right"><p className="text-sm font-semibold tabular-nums">{inr(c.cart_value_inr)}</p></div></div></button></li>; })}</ul>}</div>
        <div><h2 className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">PROFIT GUARD'S RECOMMENDATION</h2>
          {status === "approved" ? <div className="rounded-2xl border border-border bg-card p-7 shadow-card sm:p-10"><span className="inline-flex items-center gap-2 rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success"><Check className="h-3.5 w-3.5" /> Approved by merchant</span><h3 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">{action.kind === "retry" ? "Payment retry approved" : action.kind === "offer" ? `${inr(action.cost)} offer approved` : action.kind === "reminder" ? "Reminder approved" : "No action taken"} · {selected.customer_id}</h3>{!isNone && <div className="mt-6 max-w-md rounded-2xl rounded-bl-sm border border-border bg-muted/60 p-5"><p className="text-xs font-medium text-muted-foreground">Simulated customer message — demo only, nothing is actually sent</p><p className="mt-2.5 text-[15px] leading-relaxed">{customerMessage(selected, action)}</p></div>}<button onClick={() => setStatus("pending")} className="mt-7 text-sm font-medium text-muted-foreground hover:text-foreground">Undo</button></div> :
          <div className="rounded-2xl border border-border bg-card p-7 shadow-card sm:p-10"><p className="text-xs font-medium tracking-wide text-muted-foreground">{selected.customer_id} · {inr(selected.cart_value_inr)} cart · {paymentLabel(selected)}</p><div className="mt-4 flex items-center gap-3"><span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", isNone ? "bg-muted text-muted-foreground" : "bg-success-soft text-success")}><ActionIcon kind={action.kind} className="h-5 w-5" /></span><h3 className="text-2xl leading-tight font-semibold tracking-tight sm:text-[34px]">{actionHeadline(action)}</h3></div>
            {action.kind === "offer" && <div className="mt-7 rounded-2xl border border-success/30 bg-success-soft/40 p-6"><p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">RECOMMENDED OFFER</p><p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{inr(action.cost)}</p><p className="mt-2 text-sm text-muted-foreground">The smallest merchant-approved incentive the engine considers worthwhile for this checkout.</p></div>}
            <div className="mt-7"><p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">WHY</p><p className="mt-2 text-[15px] leading-relaxed">{decision.reason}</p><ul className="mt-4 space-y-2.5">{reasons.map((r) => <li key={r} className="flex gap-3 text-[14px] leading-relaxed text-muted-foreground"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/30" /><span>{r}</span></li>)}</ul></div>
            <div className="mt-7 rounded-2xl border border-border bg-muted/40 p-6"><p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">EXPECTED INCREMENTAL PROFIT</p><p className={cn("mt-1 text-3xl font-semibold tracking-tight tabular-nums", decision.netGain > 0 ? "text-success" : "text-muted-foreground")}>{decision.netGain > 0 ? `+${inr(decision.netGain)}` : inr(0)}</p><p className="mt-1 text-xs text-muted-foreground">vs. doing nothing · {isNone ? "no spend justified by the signals" : `estimated recovery chance ${pct(action.finalProb)}`}</p><p className="mt-4 border-t border-border pt-4 text-[13px] leading-relaxed text-muted-foreground">{decision.economics}</p></div>
            {action.kind === "offer" && <div className="mt-7 border-t border-border pt-6"><p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">MERCHANT-APPROVED OFFER</p><p className="mt-2 text-sm text-muted-foreground">This recommendation uses an offer already approved by the merchant. Profit Guard never creates or authorises a discount on its own.</p></div>}
            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border pt-6"><button onClick={() => setStatus("approved")} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"><Check className="h-4 w-4" />{action.kind === "offer" ? "Approve offer" : action.kind === "retry" ? "Approve payment retry" : action.kind === "reminder" ? "Approve reminder" : "Confirm no action"}</button><button onClick={() => setStatus("ignored")} className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"><X className="h-4 w-4" /> Ignore</button>{status === "ignored" && <span className="text-xs text-muted-foreground">Marked as ignored.</span>}</div>
          </div>}
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Recommendations are calculated from the checkout signals shown here (stage, payment status, history, timing) and the merchant's approved offers. This demo uses synthetic data only.</p>
        </div>
      </section>
    </main>
  );
}
