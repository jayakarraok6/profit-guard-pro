export type CheckoutStage = "cart" | "address" | "payment";
export type PaymentStatus = "not_attempted" | "failed" | "abandoned_at_gateway";

/** The situation. Inputs never contain a decision. */
export interface CheckoutInput {
  customer_id: string;
  cart_value_inr: number;
  checkout_stage: CheckoutStage;
  previous_orders: number;
  previous_discount_used: boolean;
  time_spent_seconds: number;
  estimated_margin_pct: number; // e.g. 32 => 32%
  payment_status: PaymentStatus;
  payment_failure_reason?: string;
  /** Merchant-approved offer amounts (₹). Profit Guard can never exceed this set. */
  allowed_offers_inr: number[];
  /** Prior recovery context */
  previous_recovery_attempts: number;
  previous_recovery_succeeded: boolean;
  // ---- synthetic demo signals ----
  test_price_sensitivity: number; // 0-1 (demo signal)
  test_recovery_probability: number; // 0-1 (demo signal)
  test_incentive_response: number; // 0-1 (demo signal: has a small incentive historically worked)
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
  baseProb: number;
  minGain: number;
  reason: string;
  economics: string;
  guardrails: string[];
  netGain: number;
  expectedRecoveredValue: number;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Baseline chance the checkout recovers on its own. */
export function baselineProbability(c: CheckoutInput): number {
  const stageBoost =
    c.checkout_stage === "payment" ? 0.08 : c.checkout_stage === "address" ? 0.03 : -0.02;
  const loyaltyBoost = Math.min(0.08, c.previous_orders * 0.015);
  const intentBoost = c.time_spent_seconds > 240 ? 0.04 : c.time_spent_seconds < 60 ? -0.04 : 0;
  const paymentPenalty = c.payment_status === "failed" ? -0.1 : 0;
  const fatigue = -0.06 * (c.previous_recovery_succeeded ? 0 : c.previous_recovery_attempts);
  return clamp(
    c.test_recovery_probability + stageBoost + loyaltyBoost + intentBoost + paymentPenalty + fatigue,
    0.01,
    0.95,
  );
}

function reminderLift(c: CheckoutInput, base: number): number {
  const headroom = 1 - base;
  const engaged =
    c.checkout_stage === "payment" ? 0.22 : c.checkout_stage === "address" ? 0.15 : 0.08;
  return clamp(headroom * engaged, 0, 0.35);
}

/** A retry only helps when the blocker was the payment itself. */
function retryLift(c: CheckoutInput, base: number): number {
  if (c.payment_status === "not_attempted") return 0;
  const headroom = 1 - base;
  const strength = c.payment_status === "failed" ? 0.62 : 0.3;
  return clamp(headroom * strength, 0, 0.7);
}

function offerLift(c: CheckoutInput, amount: number, base: number): number {
  const headroom = 1 - base;
  const discountPct = amount / c.cart_value_inr;
  const depth = 1 - Math.exp(-discountPct / 0.05); // diminishing returns on depth
  const responsiveness = 1 + 0.6 * clamp(c.test_incentive_response);
  const habitPenalty = c.previous_discount_used ? 0.85 : 1;
  const priceEffect =
    headroom * 0.65 * clamp(c.test_price_sensitivity) * depth * responsiveness * habitPenalty;
  return clamp(reminderLift(c, base) + priceEffect, 0, 0.9);
}

export function decide(c: CheckoutInput): Decision {
  const margin = (c.cart_value_inr * c.estimated_margin_pct) / 100;
  const base = baselineProbability(c);
  const guardrails: string[] = [];

  const attemptsExhausted = !c.previous_recovery_succeeded && c.previous_recovery_attempts >= 2;
  if (attemptsExhausted) {
    guardrails.push(
      `${c.previous_recovery_attempts} previous recovery attempts on this checkout did not convert — further spend is blocked.`,
    );
  }

  const build = (
    id: string,
    kind: ActionKind,
    label: string,
    cost: number,
    lift: number,
    blocked?: string,
  ): ActionOption => {
    const finalProb = clamp(base + lift, 0, 0.98);
    const expectedProfit = finalProb * (margin - cost);
    let allowed = !blocked;
    let blockedReason = blocked;
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

  const options: ActionOption[] = [
    build("none", "none", "No intervention", 0, 0),
    build("reminder", "reminder", "Send reminder", 0, reminderLift(c, base)),
    build(
      "retry",
      "retry",
      "Payment retry",
      0,
      retryLift(c, base),
      c.payment_status === "not_attempted" ? "No payment was attempted" : undefined,
    ),
    ...[...c.allowed_offers_inr]
      .sort((a, b) => a - b)
      .map((amt) => build(`offer_${amt}`, "offer", `${inr(amt)} offer`, amt, offerLift(c, amt, base))),
  ];

  const doNothing = options[0]!;
  const minGain = Math.max(25, c.cart_value_inr * 0.01);
  guardrails.push(`An action must add at least ${inr(minGain)} of expected profit to be worth taking.`);
  guardrails.push(
    c.allowed_offers_inr.length
      ? `Merchant-approved offers: ${c.allowed_offers_inr.map(inr).join(" · ")}. Nothing outside this set can be recommended.`
      : "This merchant has approved no offers for this checkout.",
  );
  if (c.previous_discount_used) {
    guardrails.push("Customer has used a discount before — incentive impact is damped to avoid a discount habit.");
  }
  if (options.some((o) => o.kind === "offer" && o.blockedReason?.includes("margin"))) {
    guardrails.push("Offers costing more than half the estimated margin are blocked.");
  }

  const viable = options.filter((o) => o.allowed && o.kind !== "none" && o.gainVsNothing >= minGain);

  let chosen = doNothing;
  let reason: string;
  let economics: string;

  if (viable.length === 0) {
    reason = attemptsExhausted
      ? `This checkout has already been chased ${c.previous_recovery_attempts} times without converting. The evidence does not justify spending more on it.`
      : `Nothing here clearly beats leaving the checkout alone — this shopper already has about a ${pct(base)} chance of returning without help.`;
    economics = `Doing nothing has an expected value of ${inr(base * margin)}. No eligible action adds the ${inr(minGain)} minimum expected gain, so intervening would spend merchant money for no measurable return.`;
  } else {
    const best = viable.reduce((a, b) => (b.expectedProfit > a.expectedProfit ? b : a));
    // prefer the smallest useful intervention within 5% of the best expected profit
    const ranked = [...viable].sort((a, b) => a.cost - b.cost || b.expectedProfit - a.expectedProfit);
    chosen = ranked.find((o) => o.expectedProfit >= best.expectedProfit * 0.95) ?? best;

    if (chosen.kind === "retry") {
      reason = `The blocker looks payment-related, not price-related — the ${c.payment_failure_reason ?? "payment"} stopped an order the shopper had already committed to.`;
      economics = `A retry costs nothing and lifts recovery from ${pct(base)} to ${pct(chosen.finalProb)}, worth about ${inr(chosen.gainVsNothing)} in expected profit. Discounting a failed payment would give away margin without fixing the actual problem.`;
    } else if (chosen.kind === "reminder") {
      reason = `Purchase intent is already high — ${c.previous_orders > 0 ? `a repeat customer who reached ${stageLabel(c.checkout_stage)}` : `they reached ${stageLabel(c.checkout_stage)}`}. A free nudge is the sensible first step.`;
      economics = `The reminder moves recovery from ${pct(base)} to ${pct(chosen.finalProb)} at zero cost, adding about ${inr(chosen.gainVsNothing)} of expected profit. Paid offers were evaluated and none returned more than this after their cost.`;
    } else {
      const larger = viable.filter((o) => o.kind === "offer" && o.cost > chosen.cost);
      reason = `Repeat behaviour, ${stageLabel(c.checkout_stage)} drop-off and this shopper's price sensitivity suggest a small incentive is what tips the order over. ${larger.length ? "A larger offer is not justified." : "This is the largest offer the merchant has approved."}`;
      economics = `${inr(chosen.cost)} off lifts recovery from ${pct(base)} to ${pct(chosen.finalProb)}, adding about ${inr(chosen.gainVsNothing)} of expected profit after the discount cost.${larger.length ? ` ${larger.map((o) => inr(o.cost)).join(" and ")} would cost more than the extra recovery is worth.` : ""}`;
    }
  }

  return {
    action: chosen,
    options,
    margin,
    baseProb: base,
    minGain,
    reason,
    economics,
    guardrails,
    netGain: chosen.gainVsNothing,
    expectedRecoveredValue: chosen.finalProb * c.cart_value_inr,
  };
}

export function stageLabel(s: CheckoutStage) {
  return s === "cart" ? "the cart" : s === "address" ? "the address step" : "the payment step";
}

export function paymentLabel(c: CheckoutInput) {
  if (c.payment_status === "failed") return `Payment failed${c.payment_failure_reason ? ` · ${c.payment_failure_reason}` : ""}`;
  if (c.payment_status === "abandoned_at_gateway") return "Left at the payment gateway";
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
    previous_orders: 4,
    previous_discount_used: false,
    time_spent_seconds: 268,
    estimated_margin_pct: 46,
    payment_status: "abandoned_at_gateway",
    allowed_offers_inr: [100, 250],
    previous_recovery_attempts: 0,
    previous_recovery_succeeded: false,
    test_price_sensitivity: 0.28,
    test_recovery_probability: 0.34,
    test_incentive_response: 0.2,
  },
  // B) small offer justified
  {
    customer_id: "CUST-6644",
    cart_value_inr: 4899,
    checkout_stage: "payment",
    previous_orders: 8,
    previous_discount_used: false,
    time_spent_seconds: 405,
    estimated_margin_pct: 38,
    payment_status: "abandoned_at_gateway",
    allowed_offers_inr: [100, 250, 500],
    previous_recovery_attempts: 0,
    previous_recovery_succeeded: false,
    test_price_sensitivity: 0.65,
    test_recovery_probability: 0.34,
    test_incentive_response: 0.95,
  },
  // C) payment retry
  {
    customer_id: "CUST-8093",
    cart_value_inr: 14999,
    checkout_stage: "payment",
    previous_orders: 3,
    previous_discount_used: false,
    time_spent_seconds: 520,
    estimated_margin_pct: 26,
    payment_status: "failed",
    payment_failure_reason: "card declined by issuing bank",
    allowed_offers_inr: [100, 250, 500],
    previous_recovery_attempts: 0,
    previous_recovery_succeeded: false,
    test_price_sensitivity: 0.4,
    test_recovery_probability: 0.4,
    test_incentive_response: 0.3,
  },
  // D) attempts exhausted
  {
    customer_id: "CUST-3310",
    cart_value_inr: 19999,
    checkout_stage: "address",
    previous_orders: 1,
    previous_discount_used: true,
    time_spent_seconds: 95,
    estimated_margin_pct: 31,
    payment_status: "not_attempted",
    allowed_offers_inr: [100, 250, 500],
    previous_recovery_attempts: 3,
    previous_recovery_succeeded: false,
    test_price_sensitivity: 0.5,
    test_recovery_probability: 0.22,
    test_incentive_response: 0.3,
  },
  // E) larger approved offer can be justified
  {
    customer_id: "CUST-1042",
    cart_value_inr: 20000,
    checkout_stage: "payment",
    previous_orders: 11,
    previous_discount_used: false,
    time_spent_seconds: 372,
    estimated_margin_pct: 40,
    payment_status: "abandoned_at_gateway",
    allowed_offers_inr: [100, 250, 500],
    previous_recovery_attempts: 0,
    previous_recovery_succeeded: false,
    test_price_sensitivity: 0.8,
    test_recovery_probability: 0.25,
    test_incentive_response: 1,
  },
  // low-value, weak evidence
  {
    customer_id: "CUST-5501",
    cart_value_inr: 349,
    checkout_stage: "cart",
    previous_orders: 0,
    previous_discount_used: false,
    time_spent_seconds: 22,
    estimated_margin_pct: 22,
    payment_status: "not_attempted",
    allowed_offers_inr: [100],
    previous_recovery_attempts: 0,
    previous_recovery_succeeded: false,
    test_price_sensitivity: 0.9,
    test_recovery_probability: 0.08,
    test_incentive_response: 0.6,
  },
  // gateway drop-off, mid value
  {
    customer_id: "CUST-7182",
    cart_value_inr: 3150,
    checkout_stage: "payment",
    previous_orders: 1,
    previous_discount_used: true,
    time_spent_seconds: 130,
    estimated_margin_pct: 36,
    payment_status: "failed",
    payment_failure_reason: "UPI collect request expired",
    allowed_offers_inr: [100, 250],
    previous_recovery_attempts: 1,
    previous_recovery_succeeded: false,
    test_price_sensitivity: 0.71,
    test_recovery_probability: 0.3,
    test_incentive_response: 0.5,
  },
  // browsing, no real intent
  {
    customer_id: "CUST-2288",
    cart_value_inr: 899,
    checkout_stage: "cart",
    previous_orders: 1,
    previous_discount_used: true,
    time_spent_seconds: 48,
    estimated_margin_pct: 28,
    payment_status: "not_attempted",
    allowed_offers_inr: [100, 250],
    previous_recovery_attempts: 2,
    previous_recovery_succeeded: false,
    test_price_sensitivity: 0.62,
    test_recovery_probability: 0.14,
    test_incentive_response: 0.4,
  },
];
