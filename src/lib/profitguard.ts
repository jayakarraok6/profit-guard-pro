export type CheckoutStage = "cart" | "address" | "payment";

export interface CheckoutInput {
  customer_id: string;
  cart_value_inr: number;
  checkout_stage: CheckoutStage;
  previous_orders: number;
  previous_discount_used: boolean;
  time_spent_seconds: number;
  test_price_sensitivity: number; // 0-1 synthetic signal
  estimated_margin_pct: number; // e.g. 32 => 32%
  test_recovery_probability: number; // 0-1 synthetic signal
}

export type ActionId = "none" | "reminder" | "offer_100" | "offer_200" | "offer_300";

export interface ActionOption {
  id: ActionId;
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
  reason: string;
  guardrails: string[];
  netGain: number;
}

const ACTIONS: { id: ActionId; label: string; cost: number }[] = [
  { id: "none", label: "Do nothing", cost: 0 },
  { id: "reminder", label: "Send reminder", cost: 0 },
  { id: "offer_100", label: "₹100 offer", cost: 100 },
  { id: "offer_200", label: "₹200 offer", cost: 200 },
  { id: "offer_300", label: "₹300 offer", cost: 300 },
];

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Baseline chance the checkout recovers on its own. */
export function baselineProbability(c: CheckoutInput): number {
  const stageBoost = c.checkout_stage === "payment" ? 0.08 : c.checkout_stage === "address" ? 0.03 : -0.02;
  const loyaltyBoost = Math.min(0.08, c.previous_orders * 0.015);
  const intentBoost = c.time_spent_seconds > 240 ? 0.04 : c.time_spent_seconds < 60 ? -0.04 : 0;
  return clamp(c.test_recovery_probability + stageBoost + loyaltyBoost + intentBoost, 0.01, 0.95);
}

/** Extra recovery chance from a nudge, diminishing with discount size. */
function liftFor(c: CheckoutInput, cost: number, base: number): number {
  const headroom = 1 - base;
  if (cost === 0) {
    // plain reminder: works on engaged, late-stage shoppers
    const engaged = c.checkout_stage === "payment" ? 0.22 : c.checkout_stage === "address" ? 0.15 : 0.08;
    return clamp(headroom * engaged, 0, 0.3);
  }
  const discountPct = cost / c.cart_value_inr;
  const sensitivity = clamp(c.test_price_sensitivity);
  // diminishing returns on discount depth
  const depth = 1 - Math.exp(-discountPct / 0.05);
  const reminderPart = liftFor(c, 0, base);
  const habitPenalty = c.previous_discount_used ? 0.85 : 1;
  return clamp(reminderPart + headroom * 0.65 * sensitivity * depth * habitPenalty, 0, 0.85);
}

export function decide(c: CheckoutInput): Decision {
  const margin = (c.cart_value_inr * c.estimated_margin_pct) / 100;
  const base = baselineProbability(c);
  const guardrails: string[] = [];

  const options: ActionOption[] = ACTIONS.map((a) => {
    const lift = a.id === "none" ? 0 : liftFor(c, a.cost, base);
    const finalProb = clamp(base + lift, 0, 0.98);
    const expectedProfit = finalProb * (margin - a.cost);
    let allowed = true;
    let blockedReason: string | undefined;
    if (a.cost > 0 && a.cost > margin * 0.5) {
      allowed = false;
      blockedReason = "Discount would eat more than half the margin";
    }
    return {
      id: a.id,
      label: a.label,
      cost: a.cost,
      baseProb: base,
      liftProb: lift,
      finalProb,
      expectedProfit,
      gainVsNothing: expectedProfit - base * margin,
      allowed,
      blockedReason,
    };
  });

  const doNothing = options[0]!;
  if (options.some((o) => !o.allowed)) {
    guardrails.push("Offers costing more than 50% of estimated margin are blocked.");
  }

  // Conservative threshold: must clearly beat doing nothing.
  const minGain = Math.max(25, c.cart_value_inr * 0.01);
  const viable = options.filter((o) => o.allowed && o.id !== "none" && o.gainVsNothing >= minGain);
  guardrails.push(`Requires at least ₹${Math.round(minGain)} expected gain over doing nothing.`);

  if (c.test_price_sensitivity < 0.35) {
    guardrails.push("Low price sensitivity — discounts are unlikely to change this outcome.");
  }
  if (c.previous_discount_used) {
    guardrails.push("Customer has used a discount before — deeper offers are damped to avoid discount habit.");
  }

  let chosen = doNothing;
  let reason: string;

  if (viable.length === 0) {
    chosen = doNothing;
    reason =
      c.test_price_sensitivity < 0.35
        ? `This shopper is not very price-driven and already has a ${Math.round(base * 100)}% chance of returning on their own. Spending money here would mostly discount a sale you were likely to get anyway.`
        : `No intervention clears the ₹${Math.round(minGain)} minimum expected gain. The cheapest sensible move is to leave this checkout alone.`;
  } else {
    const best = viable.reduce((a, b) => (b.expectedProfit > a.expectedProfit ? b : a));
    // prefer the smallest useful intervention within 5% of the best expected profit
    chosen = viable.find((o) => o.expectedProfit >= best.expectedProfit * 0.95) ?? best;
    if (chosen.cost === 0) {
      reason = `A free reminder lifts recovery from ${Math.round(base * 100)}% to ${Math.round(chosen.finalProb * 100)}% at no cost, so there is no reason to pay for a discount here.`;
    } else {
      reason = `This shopper is price-sensitive and stalled at ${stageLabel(c.checkout_stage)}. A ₹${chosen.cost} offer raises recovery from ${Math.round(base * 100)}% to ${Math.round(chosen.finalProb * 100)}%, adding about ₹${Math.round(chosen.gainVsNothing)} of expected profit after the discount cost. Larger offers cost more than the extra recovery is worth.`;
    }
  }

  return { action: chosen, options, margin, reason, guardrails, netGain: chosen.gainVsNothing };
}

export function stageLabel(s: CheckoutStage) {
  return s === "cart" ? "the cart" : s === "address" ? "the address step" : "the payment step";
}

export const inr = (n: number) =>
  "₹" + Math.round(n).toLocaleString("en-IN");

export const CHECKOUTS: CheckoutInput[] = [
  {
    customer_id: "CUST-1042",
    cart_value_inr: 2499,
    checkout_stage: "payment",
    previous_orders: 0,
    previous_discount_used: false,
    time_spent_seconds: 312,
    test_price_sensitivity: 0.78,
    estimated_margin_pct: 34,
    test_recovery_probability: 0.22,
  },
  {
    customer_id: "CUST-2288",
    cart_value_inr: 899,
    checkout_stage: "cart",
    previous_orders: 1,
    previous_discount_used: true,
    time_spent_seconds: 48,
    test_price_sensitivity: 0.62,
    estimated_margin_pct: 28,
    test_recovery_probability: 0.14,
  },
  {
    customer_id: "CUST-3310",
    cart_value_inr: 7450,
    checkout_stage: "address",
    previous_orders: 5,
    previous_discount_used: false,
    time_spent_seconds: 195,
    test_price_sensitivity: 0.31,
    estimated_margin_pct: 41,
    test_recovery_probability: 0.47,
  },
  {
    customer_id: "CUST-4127",
    cart_value_inr: 1299,
    checkout_stage: "payment",
    previous_orders: 2,
    previous_discount_used: true,
    time_spent_seconds: 260,
    test_price_sensitivity: 0.84,
    estimated_margin_pct: 46,
    test_recovery_probability: 0.19,
  },
  {
    customer_id: "CUST-5501",
    cart_value_inr: 349,
    checkout_stage: "cart",
    previous_orders: 0,
    previous_discount_used: false,
    time_spent_seconds: 22,
    test_price_sensitivity: 0.9,
    estimated_margin_pct: 22,
    test_recovery_probability: 0.08,
  },
  {
    customer_id: "CUST-6644",
    cart_value_inr: 4899,
    checkout_stage: "payment",
    previous_orders: 8,
    previous_discount_used: false,
    time_spent_seconds: 405,
    test_price_sensitivity: 0.18,
    estimated_margin_pct: 38,
    test_recovery_probability: 0.61,
  },
  {
    customer_id: "CUST-7182",
    cart_value_inr: 3150,
    checkout_stage: "address",
    previous_orders: 1,
    previous_discount_used: true,
    time_spent_seconds: 130,
    test_price_sensitivity: 0.71,
    estimated_margin_pct: 36,
    test_recovery_probability: 0.25,
  },
  {
    customer_id: "CUST-8093",
    cart_value_inr: 12990,
    checkout_stage: "payment",
    previous_orders: 3,
    previous_discount_used: false,
    time_spent_seconds: 520,
    test_price_sensitivity: 0.55,
    estimated_margin_pct: 26,
    test_recovery_probability: 0.33,
  },
];
