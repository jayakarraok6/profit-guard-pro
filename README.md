# Profit Guard Pro

Build the Profit Guard MVP. This is a merchant tool that helps an online merchant decide the cheapest sensible intervention for an abandoned checkout without blindly giving away discounts. Keep the product simple, polished, and easy to explain. IMPORTANT: do not build a generic chatbot, giant analytics dashboard, or complex fintech system. Build the first working MVP around this flow: Merchant sees abandoned checkouts -> selects one -> Profit Guard analyzes the customer/checkout inputs -> recommends one action (Do nothing, Send reminder, ₹100 offer, ₹200 offer, or ₹300 offer) -> shows a clear plain-English reason and estimated economic impact -> merchant can Approve or Ignore -> show a simulated customer notification/result. Use synthetic demo data for now. The clean input dataset contains only customer/checkout inputs; the decision output must be calculated by the app, not read from a pre-filled recommended_action field. Use these input fields: customer_id, cart_value_inr, checkout_stage, payment_status, hours_since_abandoned, time_spent_seconds, previous_orders, previous_recovery_attempts, previous_recovery_succeeded, previous_discount_used, allowed_offers_inr (merchant-approved offer amounts), and optional estimated_margin_pct. Recovery likelihood is derived deterministically from these checkout signals — there are no synthetic probability fields or ML predictions. Decision logic should be transparent and conservative: compare expected economics of the available actions, avoid spending merchant money when evidence is weak or expected gain is too small, and prefer the smallest useful intervention. Do not claim the prototype uses real Razorpay data or real customer communications. Create a professional Razorpay-adjacent but independent visual style: clean white/light interface, strong dark text, subtle green accents for positive recovery value, compact cards, excellent spacing, and a very clear recommendation card. Main screen should immediately communicate what Profit Guard does. Include a small demo-mode label. Build the complete MVP now, with responsive desktop/mobile layout, seeded synthetic data, functional interactions, and no unnecessary features.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/cb622211-f88d-4948-a9b4-b8f94ef0af5a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
