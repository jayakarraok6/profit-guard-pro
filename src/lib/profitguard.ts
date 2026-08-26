export type CheckoutStage = "cart" | "address" | "payment";
export type PaymentStatus = "not_attempted" | "failed" | "abandoned_at_gateway";

/** The situation. Inputs never contain a decision. */
export interface CheckoutInput {
  customer_id: string;
  cart_value_inr: number;
  checkout_stage: CheckoutStage;
  payment_status: PaymentStatus;
  /** How long ago the checkout was abandoned, in hours. */
  hours_since_abandoned: number;
  /** Time the shopper spent in the checkout before leaving. */
  time_spent_seconds: number;
  previous_orders: number;
  previous_recovery_attempts: number;
  previous_recovery_succeeded: boolean;
  previous_discount_used: boolean;
  /** Merchant-approved offer amounts (₹). Profit Guard can never exceed this set. */
  allowed_offers_inr: number[];
  /** Optional — omitted when the merchant has not provided margin data. */
  estimated_margin_pct?: number;
  payment_failure_reason?: string;
}

export type ActionKind = "none" | "reminder" | "retry" | "offer";

export interface ActionOption {
  id: string;
  kind: ActionKind;
  label: string;
  cost: number;
  baseProb: number;
  liftProb: number;
  finalProb: number;
  expectedProfit: number;
  gainVsNothing: number;
  allowed: boolean;
  blockedReason?: string | undefined;
}

export interface Decision {
  action: ActionOption;
  options: ActionOption[];
  margin: number;
  marginAssumed: boolean;
  baseProb: number;
  minGain: number;
  reason: string;
  economics: string;
  guardrails: string[];
  netGain: number;
  expectedRecoveredValue: number;
  errors: string[];
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Default margin assumption when the merchant has not supplied one. Deliberately conservative. */
const ASSUMED_MARGIN_PCT = 25;

/** Input validation. Anything invalid means Profit Guard refuses to spend money. */
export function validate(c: CheckoutInput): string[] {
  const e: string[] = [];
  if (!isNum(c.cart_value_inr) || c.cart_value_inr <= 0) e.push("Cart value is missing or not a positive amount.");
  if (!isNum(c.hours_since_abandoned) || c.hours_since_abandoned < 0) e.push("Time since abandonment is invalid.");
  if (!isNum(c.time_spent_seconds) || c.time_spent_seconds < 0) e.push("Time spent in checkout is invalid.");
  if (!isNum(c.previous_orders) || c.previous_orders < 0) e.push("Previous order count is invalid.");
  if (!isNum(c.previous_recovery_attempts) || c.previous_recovery_attempts < 0)
    e.push("Previous recovery attempt count is invalid.");
  if (c.estimated_margin_pct !== undefined && (!isNum(c.estimated_margin_pct) || c.estimated_margin_pct < 0 || c.estimated_margin_pct > 100))
    e.push("Estimated margin must be between 0% and 100%.");
  if (!Array.isArray(c.allowed_offers_inr)) e.push("Merchant-approved offer list is missing.");
  else if (c.allowed_offers_inr.some((o) => !isNum(o) || o <= 0)) e.push("An approved offer amount is not a positive value.");
  else if (isNum(c.cart_value_inr) && c.allowed_offers_inr.some((o) => o >= c.cart_value_inr))
    e.push("An approved offer is not smaller than the cart value.");
  if (c.payment_status === "failed" && !c.payment_failure_reason) e.push("Payment is marked failed but no reason was recorded.");
  return e;
}

/**
 * How likely this shopper looks to come back, expressed 0-1.
 * Derived only from the observable checkout situation — no ML score, no synthetic probability field.
 */
export function intentScore(c: CheckoutInput): number {
  const stage = c.checkout_stage === "payment" ? 0.5 : c.checkout_stage === "address" ? 0.34 : 0.16;
  const dwell = c.time_spent_seconds >= 300 ? 0.12 : c.time_spent_seconds >= 120 ? 0.07 : c.time_spent_seconds >= 60 ? 0.02 : -0.06;
  const loyalty = Math.min(0.16, c.previous_orders * 0.02);
  // a checkout goes cold as time passes
  const recency = c.hours_since_abandoned <= 2 ? 0.08 : c.hours_since_abandoned <= 12 ? 0.03 : c.hours_since_abandoned <= 24 ? -0.02 : -0.12;
  const fatigue = c.previous_recovery_succeeded ? 0 : -0.07 * c.previous_recovery_attempts;
  return clamp(stage + dwell + loyalty + recency + fatigue, 0, 1);
}

/** Baseline chance the checkout recovers with no help at all. */
export function baselineProbability(c: CheckoutInput): number {
  const intent = intentScore(c);
  // an outright payment failure blocks an order the shopper already wanted
  const blocked = c.payment_status === "failed" ? 0.75 : 1;
  return clamp(0.04 + 0.42 * intent * blocked, 0.01, 0.7);
}

function reminderLift(c: CheckoutInput, base: number): number {
  const headroom = 1 - base;
  const reach = c.hours_since_abandoned <= 24 ? 1 : 0.5;
  const stage = c.checkout_stage === "payment" ? 0.3 : c.checkout_stage === "address" ? 0.2 : 0.1;
  // a nudge that has already been sent and ignored works less well the second time
  const repeat = c.previous_recovery_succeeded ? 1 : Math.max(0.35, 1 - 0.35 * c.previous_recovery_attempts);
  return clamp(headroom * stage * reach * repeat * (0.4 + 0.6 * intentScore(c)), 0, 0.35);
}

/** A retry only helps when the payment itself is what broke. */
function retryLift(c: CheckoutInput, base: number): number {
  if (c.payment_status !== "failed") return 0;
  return clamp((1 - base) * 0.6, 0, 0.7);
}

/**
 * Is there any evidence an incentive is the missing piece?
 * Offers are only considered when a free nudge is not the obvious next step.
 */
export function incentiveEvidence(c: CheckoutInput): { ok: boolean; note: string } {
  if (c.payment_status === "failed")
    return { ok: false, note: "The blocker is a failed payment, not price — a discount would not fix it." };
  if (c.previous_recovery_attempts === 0)
    return { ok: false, note: "A free reminder has not been tried yet, so there is no evidence money is needed." };
  if (c.previous_recovery_succeeded)
    return { ok: false, note: "This shopper has recovered from a free nudge before." };
  if (c.checkout_stage === "cart")
    return { ok: false, note: "They left at the cart, so there is no sign price was the blocker." };
  return {
    ok: true,
    note: `A free reminder was already tried ${c.previous_recovery_attempts} time${c.previous_recovery_attempts > 1 ? "s" : ""} and did not convert, and they reached ${stageLabel(c.checkout_stage)} — an incentive is the next lever.`,
  };
}

function offerLift(c: CheckoutInput, amount: number, base: number): number {
  const headroom = 1 - base;
  const depth = 1 - Math.exp(-(amount / c.cart_value_inr) / 0.06); // diminishing returns on depth
  const habit = c.previous_discount_used ? 0.85 : 1;
  const incentive = headroom * 0.5 * depth * habit * (0.5 + 0.5 * intentScore(c));
  return clamp(reminderLift(c, base) + incentive, 0, 0.85);
}

export function decide(c: CheckoutInput): Decision {
  const errors = validate(c);
  const marginAssumed = c.estimated_margin_pct === undefined;
  const marginPct = marginAssumed ? ASSUMED_MARGIN_PCT : c.estimated_margin_pct!;
  const cartValue = isNum(c.cart_value_inr) && c.cart_value_inr > 0 ? c.cart_value_inr : 0;
  const margin = (cartValue * marginPct) / 100;
  const base = errors.length ? 0 : baselineProbability(c);
  const guardrails: string[] = [];

  const attemptsExhausted = !c.previous_recovery_succeeded && c.previous_recovery_attempts >= 2;
  const evidence = incentiveEvidence(c);

  const build = (id: string, kind: ActionKind, label: string, cost: number, lift: number, blocked?: string): ActionOption => {
    const finalProb = clamp(base + lift, 0, 0.95);
    const expectedProfit = finalProb * (margin - cost);
    let allowed = !blocked;
    let blockedReason = blocked;
    if (allowed && kind !== "none" && errors.length) {
      allowed = false;
      blockedReason = "Checkout data failed validation";
    }
    if (allowed && kind !== "none" && attemptsExhausted) {
      allowed = false;
      blockedReason = "Recovery attempts already exhausted";
    }
    if (allowed && cost > 0 && cost > margin * 0.5) {
      allowed = false;
      blockedReason = "Offer would cost more than half the estimated margin";
    }
    return {
      id,
      kind,
      label,
      cost,
      baseProb: base,
      liftProb: lift,
      finalProb,
      expectedProfit,
      gainVsNothing: expectedProfit - base * margin,
      allowed,
      blockedReason,
    };
  };

  const offers = errors.length ? [] : [...c.allowed_offers_inr].sort((a, b) => a - b);

  const options: ActionOption[] = [
    build("none", "none", "No intervention", 0, 0),
    build("reminder", "reminder", "Send reminder", 0, errors.length ? 0 : reminderLift(c, base)),
    build(
      "retry",
      "retry",
      "Payment retry",
      0,
      errors.length ? 0 : retryLift(c, base),
      c.payment_status === "failed" ? undefined : "The payment did not actually fail, so there is nothing to retry",
    ),
    ...offers.map((amt) =>
      build(`offer_${amt}`, "offer", `${inr(amt)} offer`, amt, offerLift(c, amt, base), evidence.ok ? undefined : evidence.note),
    ),
  ];

  const doNothing = options[0]!;
  const minGain = Math.max(25, cartValue * 0.01);

  if (errors.length) {
    guardrails.push("Checkout data did not pass validation, so no spend is permitted on it.");
  }
  guardrails.push(`An action must add at least ${inr(minGain)} of expected profit to be worth taking.`);
  guardrails.push(
    c.allowed_offers_inr?.length
      ? `Merchant-approved offers: ${c.allowed_offers_inr.map(inr).join(" · ")}. Nothing outside this set can be recommended.`
      : "This merchant has approved no offers for this checkout.",
  );
  if (attemptsExhausted) {
    guardrails.push(
      `${c.previous_recovery_attempts} previous recovery attempts on this checkout did not convert — further spend is blocked.`,
    );
  }
  if (!evidence.ok && (c.allowed_offers_inr?.length ?? 0) > 0) guardrails.push(`Offers not considered: ${evidence.note}`);
  if (c.previous_discount_used) {
    guardrails.push("Customer has used a discount before — incentive impact is damped to avoid a discount habit.");
  }
  if (marginAssumed) {
    guardrails.push(`No margin supplied, so a conservative ${ASSUMED_MARGIN_PCT}% is assumed.`);
  }
  if (options.some((o) => o.kind === "offer" && o.blockedReason?.includes("margin"))) {
    guardrails.push("Offers costing more than half the estimated margin are blocked.");
  }

  const viable = options
    .filter((o) => o.allowed && o.kind !== "none" && o.gainVsNothing >= minGain)
    .sort((a, b) => a.cost - b.cost || b.expectedProfit - a.expectedProfit);

  let chosen = doNothing;
  let reason: string;
  let economics: string;

  if (viable.length === 0) {
    if (errors.length) {
      reason = "This checkout's data does not look trustworthy, so Profit Guard will not spend merchant money on it.";
      economics = `Failed checks: ${errors.join(" ")}`;
    } else if (attemptsExhausted) {
      reason = `This checkout has already been chased ${c.previous_recovery_attempts} times without converting. The evidence does not justify spending more on it.`;
      economics = `Doing nothing has an expected value of ${inr(base * margin)}. Every further action is blocked because repeated recovery attempts have failed.`;
    } else {
      reason = `Nothing here clearly beats leaving the checkout alone — the signals are too weak to expect a recovery worth paying for.`;
      economics = `Doing nothing has an expected value of ${inr(base * margin)}. No eligible action adds the ${inr(minGain)} minimum expected gain, so intervening would spend merchant money for no measurable return.`;
    }
  } else {
    // cheapest first; a costlier action must beat it by at least the minimum gain to be preferred
    chosen = viable.reduce((best, o) => (o.expectedProfit >= best.expectedProfit + minGain ? o : best), viable[0]!);

    if (chosen.kind === "retry") {
      reason = `The payment itself failed (${c.payment_failure_reason ?? "declined"}) — this shopper had already decided to buy, so the fix is a retry, not a discount.`;
      economics = `A retry costs nothing and lifts recovery from ${pct(base)} to ${pct(chosen.finalProb)}, worth about ${inr(chosen.gainVsNothing)} in expected profit. Discounting would give away margin without fixing the actual problem.`;
    } else if (chosen.kind === "reminder") {
      reason = `Intent already looks strong — ${c.previous_orders > 0 ? `a repeat customer who reached ${stageLabel(c.checkout_stage)}` : `they reached ${stageLabel(c.checkout_stage)}`}. A free nudge is the sensible first step before spending anything.`;
      economics = `The reminder moves recovery from ${pct(base)} to ${pct(chosen.finalProb)} at zero cost, adding about ${inr(chosen.gainVsNothing)} of expected profit.${evidence.ok ? " Paid offers were evaluated and none returned enough extra to justify their cost." : ` Offers were not considered: ${evidence.note.toLowerCase()}`}`;
    } else {
      const larger = viable.filter((o) => o.kind === "offer" && o.cost > chosen.cost);
      reason = `${evidence.note} This is the smallest approved offer that pays for itself.`;
      economics = `${inr(chosen.cost)} off lifts recovery from ${pct(base)} to ${pct(chosen.finalProb)}, adding about ${inr(chosen.gainVsNothing)} of expected profit after the discount cost.${larger.length ? ` ${larger.map((o) => inr(o.cost)).join(" and ")} would cost more than the extra recovery is worth.` : ""}`;
    }
  }

  return {
    action: chosen,
    options,
    margin,
    marginAssumed,
    baseProb: base,
    minGain,
    reason,
    economics,
    guardrails,
    netGain: chosen.gainVsNothing,
    expectedRecoveredValue: chosen.finalProb * cartValue,
    errors,
  };
}

export function stageLabel(s: CheckoutStage) {
  return s === "cart" ? "the cart" : s === "address" ? "the address step" : "the payment step";
}

export function paymentLabel(c: CheckoutInput) {
  if (c.payment_status === "failed") return `Payment failed${c.payment_failure_reason ? ` · ${c.payment_failure_reason}` : ""}`;
  if (c.payment_status === "abandoned_at_gateway") return "Left at the payment page without paying";
  return "No payment attempted";
}

export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const pct = (n: number) => `${Math.round(n * 100)}%`;

export function actionHeadline(a: ActionOption) {
  if (a.kind === "none") return "No intervention recommended";
  if (a.kind === "reminder") return "Reminder recommended";
  if (a.kind === "retry") return "Payment retry recommended";
  return `${inr(a.cost)} offer recommended`;
}

export const CHECKOUTS: CheckoutInput[] = [
  // A) reminder is enough
  {
    customer_id: "CUST-4127",
    cart_value_inr: 1299,
    checkout_stage: "payment",
    payment_status: "not_attempted",
    hours_since_abandoned: 3,
    time_spent_seconds: 268,
    previous_orders: 4,
    previous_recovery_attempts: 0,
    previous_recovery_succeeded: false,
    previous_discount_used: false,
    allowed_offers_inr: [100, 250],
    estimated_margin_pct: 46,
  },
  // B) reminder already failed once — smallest justified offer
  {
    customer_id: "CUST-6644",
    cart_value_inr: 4899,
    checkout_stage: "payment",
    payment_status: "abandoned_at_gateway",
    hours_since_abandoned: 8,
    time_spent_seconds: 405,
    previous_orders: 8,
    previous_recovery_attempts: 1,
    previous_recovery_succeeded: false,
    previous_discount_used: false,
    allowed_offers_inr: [100, 250, 500],
    estimated_margin_pct: 38,
  },
  // C) payment retry
  {
    customer_id: "CUST-8093",
    cart_value_inr: 14999,
    checkout_stage: "payment",
    payment_status: "failed",
    payment_failure_reason: "card declined by issuing bank",
    hours_since_abandoned: 1,
    time_spent_seconds: 520,
    previous_orders: 3,
    previous_recovery_attempts: 0,
    previous_recovery_succeeded: false,
    previous_discount_used: false,
    allowed_offers_inr: [100, 250, 500],
    estimated_margin_pct: 26,
  },
  // D) attempts exhausted — no intervention
  {
    customer_id: "CUST-3310",
    cart_value_inr: 19999,
    checkout_stage: "address",
    payment_status: "not_attempted",
    hours_since_abandoned: 40,
    time_spent_seconds: 95,
    previous_orders: 1,
    previous_recovery_attempts: 3,
    previous_recovery_succeeded: false,
    previous_discount_used: true,
    allowed_offers_inr: [100, 250, 500],
    estimated_margin_pct: 31,
  },
  // E) large cart — offer only because it is economically justified
  {
    customer_id: "CUST-1042",
    cart_value_inr: 20000,
    checkout_stage: "payment",
    payment_status: "abandoned_at_gateway",
    hours_since_abandoned: 6,
    time_spent_seconds: 372,
    previous_orders: 11,
    previous_recovery_attempts: 1,
    previous_recovery_succeeded: false,
    previous_discount_used: false,
    allowed_offers_inr: [500, 1000, 2000],
    estimated_margin_pct: 40,
  },
  // low-value, weak evidence
  {
    customer_id: "CUST-5501",
    cart_value_inr: 349,
    checkout_stage: "cart",
    payment_status: "not_attempted",
    hours_since_abandoned: 30,
    time_spent_seconds: 22,
    previous_orders: 0,
    previous_recovery_attempts: 0,
    previous_recovery_succeeded: false,
    previous_discount_used: false,
    allowed_offers_inr: [100],
    estimated_margin_pct: 22,
  },
  // gateway drop-off, mid value, no margin data supplied
  {
    customer_id: "CUST-7182",
    cart_value_inr: 3150,
    checkout_stage: "payment",
    payment_status: "failed",
    payment_failure_reason: "UPI collect request expired",
    hours_since_abandoned: 2,
    time_spent_seconds: 130,
    previous_orders: 1,
    previous_recovery_attempts: 1,
    previous_recovery_succeeded: false,
    previous_discount_used: true,
    allowed_offers_inr: [100, 250],
  },
  // browsing, no real intent, chased twice already
  {
    customer_id: "CUST-2288",
    cart_value_inr: 899,
    checkout_stage: "cart",
    payment_status: "not_attempted",
    hours_since_abandoned: 20,
    time_spent_seconds: 48,
    previous_orders: 1,
    previous_recovery_attempts: 2,
    previous_recovery_succeeded: false,
    previous_discount_used: true,
    allowed_offers_inr: [100, 250],
  },
];
