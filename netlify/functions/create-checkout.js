// Creates a Yoco Checkout for a package and returns the hosted payment page URL.
// Docs: https://developer.yoco.com/online/api-reference/checkout/payments/accept-payments/
//
// Security:
// - The amount is ALWAYS looked up here, server-side, from data/packages.json.
//   Any amount sent by the browser is ignored.
// - The Yoco secret key is read from the YOCO_SECRET_KEY environment variable
//   (set in Netlify). It must never be committed to the repository.

const crypto = require("crypto");
const catalogue = require("../../data/packages.json");

const YOCO_CHECKOUT_URL = "https://payments.yoco.com/api/checkouts";
const PAYMENT_TYPES = ["deposit", "full"];

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

function siteUrl(event) {
  // SITE_URL lets you force the public domain; Netlify sets URL automatically.
  const configured = process.env.SITE_URL || process.env.URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = (event.headers && (event.headers.host || event.headers.Host)) || "localhost:8888";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${proto}://${host}`;
}

function findPrice(packageId, paymentType) {
  const pkg = (catalogue.packages || []).find((p) => p.id === packageId && p.active !== false);
  if (!pkg) return { error: "Unknown package." };
  if (!pkg.pricing) return { error: "This trip is quote-only. Please request a quote." };
  const amount = pkg.pricing[paymentType];
  if (!Number.isInteger(amount)) return { error: `No ${paymentType} price is set for this package.` };
  if (amount < 200) return { error: "Yoco does not accept payments below R2." };
  return { pkg, amount };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  const secretKey = process.env.YOCO_SECRET_KEY;
  if (!secretKey) {
    console.error("YOCO_SECRET_KEY is not set");
    return json(503, { error: "Online payments are not configured yet." });
  }

  let input;
  try {
    input = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "Invalid request." });
  }

  const packageId = String(input.packageId || "");
  const paymentType = String(input.paymentType || "");
  if (!PAYMENT_TYPES.includes(paymentType)) return json(400, { error: "Choose deposit or full payment." });

  const found = findPrice(packageId, paymentType);
  if (found.error) return json(400, { error: found.error });
  const { pkg, amount } = found;

  // Never let the R10 test package take real money once live keys are in place.
  if (pkg.test && secretKey.startsWith("sk_live_")) {
    return json(400, { error: "The test package cannot be paid with live keys." });
  }

  const base = siteUrl(event);
  const payload = {
    amount,
    currency: catalogue.currency || "ZAR",
    successUrl: `${base}/payment-success.html?package=${encodeURIComponent(pkg.id)}`,
    cancelUrl: `${base}/payment-cancelled.html?package=${encodeURIComponent(pkg.id)}`,
    failureUrl: `${base}/payment-failed.html?package=${encodeURIComponent(pkg.id)}`,
    metadata: {
      packageId: pkg.id,
      packageName: pkg.name,
      paymentType,
      priceBasis: (pkg.pricing && pkg.pricing.basis) || "",
      source: "earthsigntravels.co.za",
    },
  };

  try {
    const res = await fetch(YOCO_CHECKOUT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.redirectUrl) {
      console.error("Yoco checkout failed", res.status, data && (data.errorCode || data.message || data.description));
      return json(502, { error: "We couldn't start the payment. Please try again or WhatsApp us." });
    }
    console.log("Yoco checkout created", { checkoutId: data.id, packageId: pkg.id, paymentType, amount, mode: data.processingMode });
    return json(200, { redirectUrl: data.redirectUrl, checkoutId: data.id });
  } catch (err) {
    console.error("Yoco request error", err && err.message);
    return json(502, { error: "We couldn't reach the payment provider. Please try again." });
  }
};

// Exported for tests and scripts.
exports.findPrice = findPrice;
