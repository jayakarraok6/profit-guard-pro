import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ShieldCheck, Check, X, Bell, RefreshCw, BadgePercent, MinusCircle, AlertTriangle } from "lucide-react";
import { CHECKOUTS, decide, inr, pct, stageLabel, paymentLabel, actionHeadline, type ActionOption, type CheckoutInput } from "@/lib/profitguard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Profit Guard — Choose the recovery action worth taking" },
    { name: "description", content: "Profit Guard recommends the most economically sensible recovery action for at-risk checkouts, with audit trail and stopping rules." },
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

const actionLabel = (a: ActionOption) =>
  a.kind === "retry" ? "Payment retry" : a.kind === "offer" ? `${inr(a.cost)} offer` : a.kind === "reminder" ? "Reminder" : "No action";

type Outcome = "awaiting" | "recovered" | "not_recovered";
type Record_ = {
  customer_id: string;
  cart_value_inr: number;
  action: string;
  kind: ActionOption["kind"];
  cost: number;
  status: "approved" | "ignored";
  outcome: Outcome;
  at: string;
};

const now = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function ProfitGuard() {
  const [selectedId, setSelectedId] = useState(CHECKOUTS[0]!.customer_id);
  const [records, setRecords] = useState<Record<string, Record_>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const activeCheckouts = CHECKOUTS.filter((c) => !records[c.customer_id]);
  const selected = CHECKOUTS.find((c) => c.customer_id === selectedId)!;
  const decision = useMemo(() => decide(selected), [selected]);
  const action = decision.action;
  const reasons = shortReasons(selected);
  const isNone = action.kind === "none";
  const record = records[selectedId];

  const history = Object.values(records).sort((a, b) => (a.at < b.at ? 1 : -1));

  const revenueAtRisk = CHECKOUTS.reduce((s, c) => s + c.cart_value_inr, 0);
  const recoveredValue = history.filter((r) => r.outcome === "recovered").reduce((s, r) => s + r.cart_value_inr, 0);
  const interventionCost = history.filter((r) => r.outcome === "recovered").reduce((s, r) => s + r.cost, 0);
  const approvedCount = history.filter((r) => r.status === "approved").length;
  const notRecoveredCount = history.filter((r) => r.outcome === "not_recovered").length;
  const unresolvedCount = CHECKOUTS.length - history.filter((r) => r.outcome === "recovered" || r.outcome === "not_recovered" || r.status === "ignored").length;
  const recoveryRate = revenueAtRisk > 0 ? recoveredValue / revenueAtRisk : 0;

  const write = (patch: Partial<Record_>, base?: Record_) =>
    setRecords((prev) => {
      const existing = base ?? prev[selectedId];
      if (!existing) return prev;
      return { ...prev, [selectedId]: { ...existing, ...patch } };
    });

  const approve = () => {
    setConfirmOpen(false);
    setRecords((prev) => ({
      ...prev,
      [selectedId]: {
        customer_id: selected.customer_id,
        cart_value_inr: selected.cart_value_inr,
        action: actionLabel(action),
        kind: action.kind,
        cost: action.cost,
        status: "approved",
        outcome: action.kind === "none" ? "not_recovered" : "awaiting",
        at: now(),
      },
    }));
  };

  const ignore = () =>
    setRecords((prev) => ({
      ...prev,
      [selectedId]: {
        customer_id: selected.customer_id,
        cart_value_inr: selected.cart_value_inr,
        action: actionLabel(action),
        kind: action.kind,
        cost: 0,
        status: "ignored",
        outcome: "not_recovered",
        at: now(),
      },
    }));

  const undo = () => setRecords((prev) => { const n = { ...prev }; delete n[selectedId]; return n; });

  const resolvedCount = history.filter((r) => r.outcome === "recovered" || r.outcome === "not_recovered").length;

  const metrics = [
    { label: "CUSTOMERS IN QUEUE", value: String(activeCheckouts.length) },
    { label: "REVENUE AT RISK", value: inr(revenueAtRisk) },
    { label: "REVENUE RECOVERED (DEMO)", value: inr(recoveredValue) },
    { label: "RECOVERY RATE", value: pct(recoveryRate) },
    { label: "APPROVED ACTIONS", value: String(approvedCount) },
    { label: "RESOLVED", value: String(resolvedCount) },
  ];

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border/70"><div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:px-8"><div className="flex min-w-0 items-center gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck className="h-4 w-4" /></span><span className="truncate text-[15px] font-semibold tracking-tight">Profit Guard</span></div><span className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground">DEMO MODE • SYNTHETIC DATA</span></div></header>

      <section className="mx-auto max-w-6xl px-5 pt-12 pb-8 sm:px-8 sm:pt-16"><h1 className="max-w-3xl text-3xl leading-[1.15] font-semibold tracking-tight text-balance sm:text-[42px]">Choose the recovery action worth taking.</h1><p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">Profit Guard looks at each at-risk checkout and recommends one sensible action: no intervention, a reminder, a payment retry, or a merchant-approved offer.</p></section>

      <section className="mx-auto max-w-6xl px-5 pb-10 sm:px-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">{m.label}</p>
              <p className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight">{m.value}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Recovered revenue only increases when a merchant marks an approved intervention as recovered in this demo. {notRecoveredCount > 0 && `${notRecoveredCount} intervention${notRecoveredCount > 1 ? "s" : ""} did not recover and ${notRecoveredCount > 1 ? "are" : "is"} escalated to manual review.`}</p>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-5 pb-16 sm:px-8 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-10">
        <div><h2 className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">AT-RISK CHECKOUTS</h2>{activeCheckouts.length === 0 ? <div className="rounded-xl border border-border bg-card/60 px-4 py-8 text-center"><p className="text-sm font-medium">All caught up</p><p className="mt-1 text-xs text-muted-foreground">No checkouts need a decision right now.</p></div> : <ul className="space-y-2">{activeCheckouts.map((c) => { const active = c.customer_id === selectedId; return <li key={c.customer_id}><button onClick={() => setSelectedId(c.customer_id)} className={cn("w-full rounded-xl border px-4 py-3.5 text-left transition-colors", active ? "border-foreground/25 bg-card shadow-card" : "border-border bg-card/60 hover:bg-card")}><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{c.customer_id}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">Left at {stageLabel(c.checkout_stage)} · {paymentLabel(c)}</p></div><div className="shrink-0 text-right"><p className="text-sm font-semibold tabular-nums">{inr(c.cart_value_inr)}</p></div></div></button></li>; })}</ul>}</div>

        <div><h2 className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">PROFIT GUARD'S RECOMMENDATION</h2>

          {record ? (
            <div className="rounded-2xl border border-border bg-card p-7 shadow-card sm:p-10">
              <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold", record.status === "approved" ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>
                {record.status === "approved" ? <><Check className="h-3.5 w-3.5" /> Approved by merchant</> : <><X className="h-3.5 w-3.5" /> Ignored by merchant</>}
              </span>
              <h3 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">{record.action} · {record.customer_id}</h3>

              {record.status === "approved" && !isNone && (
                <div className="mt-6 max-w-md rounded-2xl rounded-bl-sm border border-border bg-muted/60 p-5">
                  <p className="text-xs font-medium text-muted-foreground">Simulated customer message — demo only, nothing is actually sent</p>
                  <p className="mt-2.5 text-[15px] leading-relaxed">{customerMessage(selected, action)}</p>
                </div>
              )}

              {record.status === "approved" && record.outcome === "awaiting" && (
                <div className="mt-7 rounded-2xl border border-border bg-muted/40 p-6">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">DEMO OUTCOME — NOT YET KNOWN</p>
                  <p className="mt-2 text-sm text-muted-foreground">Approving an action does not recover revenue. Record the simulated outcome of this bounded intervention.</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button onClick={() => write({ outcome: "recovered" })} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"><Check className="h-4 w-4" /> Mark recovered (demo)</button>
                    <button onClick={() => write({ outcome: "not_recovered" })} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"><X className="h-4 w-4" /> Mark not recovered (demo)</button>
                  </div>
                </div>
              )}

              {record.outcome === "recovered" && (
                <div className="mt-7 rounded-2xl border border-success/30 bg-success-soft/40 p-6">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">SIMULATED OUTCOME · RECOVERED</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-success">{inr(record.cart_value_inr)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Order value recovered in this demo · intervention cost {inr(record.cost)}</p>
                </div>
              )}

              {record.outcome === "not_recovered" && (
                <div className="mt-7 rounded-2xl border border-border bg-muted/40 p-6">
                  <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" /> STOPPING RULE APPLIED</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">The bounded intervention did not recover this checkout. Profit Guard stops here and escalates to manual merchant review instead of automatically spending more. No further offer will be recommended for this checkout.</p>
                </div>
              )}

              <button onClick={undo} className="mt-7 text-sm font-medium text-muted-foreground hover:text-foreground">Undo and return to queue</button>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-7 shadow-card sm:p-10"><p className="text-xs font-medium tracking-wide text-muted-foreground">{selected.customer_id} · {inr(selected.cart_value_inr)} cart · {paymentLabel(selected)}</p><div className="mt-4 flex items-center gap-3"><span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", isNone ? "bg-muted text-muted-foreground" : "bg-success-soft text-success")}><ActionIcon kind={action.kind} className="h-5 w-5" /></span><h3 className="text-2xl leading-tight font-semibold tracking-tight sm:text-[34px]">{actionHeadline(action)}</h3></div>
              {action.kind === "offer" && <div className="mt-7 rounded-2xl border border-success/30 bg-success-soft/40 p-6"><p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">RECOMMENDED OFFER</p><p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{inr(action.cost)}</p><p className="mt-2 text-sm text-muted-foreground">The smallest merchant-approved incentive the engine considers worthwhile for this checkout. Profit Guard never exceeds the merchant's approved offer limits.</p></div>}
              <div className="mt-7"><p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">WHY</p><p className="mt-2 text-[15px] leading-relaxed">{decision.reason}</p><ul className="mt-4 space-y-2.5">{reasons.map((r) => <li key={r} className="flex gap-3 text-[14px] leading-relaxed text-muted-foreground"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/30" /><span>{r}</span></li>)}</ul></div>
              <div className="mt-7 rounded-2xl border border-border bg-muted/40 p-6"><p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">EXPECTED INCREMENTAL PROFIT</p><p className={cn("mt-1 text-3xl font-semibold tracking-tight tabular-nums", decision.netGain > 0 ? "text-success" : "text-muted-foreground")}>{decision.netGain > 0 ? `+${inr(decision.netGain)}` : inr(0)}</p><p className="mt-1 text-xs text-muted-foreground">vs. doing nothing · {isNone ? "no spend justified by the signals" : `estimated recovery chance ${pct(action.finalProb)}`}</p><p className="mt-4 border-t border-border pt-4 text-[13px] leading-relaxed text-muted-foreground">{decision.economics}</p></div>
              <div className="mt-7 rounded-2xl border border-border p-6"><p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">STOPPING RULES &amp; ESCALATION</p><ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-muted-foreground"><li>· One bounded intervention per checkout — no automatic follow-ups.</li><li>· No intervention once recovery attempts are exhausted or evidence is weak.</li><li>· Offers never exceed the merchant's approved list ({selected.allowed_offers_inr.map((o) => inr(o)).join(", ") || "none approved"}).</li><li>· If the intervention does not recover the order, Profit Guard stops and escalates to manual merchant review.</li></ul></div>
              <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border pt-6"><button onClick={() => setConfirmOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"><Check className="h-4 w-4" />{action.kind === "offer" ? "Approve offer" : action.kind === "retry" ? "Approve payment retry" : action.kind === "reminder" ? "Approve reminder" : "Confirm no action"}</button><button onClick={ignore} className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"><X className="h-4 w-4" /> Ignore</button></div>
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Recommendations are calculated from the checkout signals shown here (stage, payment status, history, timing) and the merchant's approved offers. This demo uses synthetic data only — no real payments, messages, or Razorpay data.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <h2 className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">AUDIT TRAIL (DEMO)</h2>
        {history.length === 0 ? (
          <div className="rounded-xl border border-border bg-card/60 px-4 py-8 text-center text-xs text-muted-foreground">No merchant decisions recorded yet.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card/60">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead><tr className="border-b border-border text-[10px] font-semibold tracking-[0.12em] text-muted-foreground"><th className="px-4 py-3">CUSTOMER</th><th className="px-4 py-3">ACTION</th><th className="px-4 py-3">DECISION</th><th className="px-4 py-3">OUTCOME</th><th className="px-4 py-3">CART</th><th className="px-4 py-3">TIME</th></tr></thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.customer_id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-medium">{r.customer_id}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.action}</td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">{r.status}</td>
                    <td className={cn("px-4 py-3", r.outcome === "recovered" ? "text-success font-medium" : "text-muted-foreground")}>{r.outcome === "recovered" ? "Recovered" : r.outcome === "awaiting" ? "Awaiting outcome" : "Not recovered · escalated"}</td>
                    <td className="px-4 py-3 tabular-nums">{inr(r.cart_value_inr)}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{r.at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {recoveredValue > 0 && <p className="mt-3 text-xs text-muted-foreground">Simulated intervention spend on recovered orders: {inr(interventionCost)}.</p>}
      </section>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
            <h3 className="text-lg font-semibold tracking-tight">Confirm merchant approval</h3>
            <p className="mt-2 text-sm text-muted-foreground">You are approving one bounded recovery action. Nothing is actually sent — this is a demo.</p>
            <dl className="mt-4 space-y-2 rounded-xl border border-border bg-muted/40 p-4 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Customer</dt><dd className="font-medium">{selected.customer_id}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Action</dt><dd className="font-medium">{actionLabel(action)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Cost to merchant</dt><dd className="font-medium tabular-nums">{inr(action.cost)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Cart value</dt><dd className="font-medium tabular-nums">{inr(selected.cart_value_inr)}</dd></div>
            </dl>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button onClick={() => setConfirmOpen(false)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={approve} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Confirm approval</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
