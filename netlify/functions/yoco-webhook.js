// Receives Yoco Checkout webhook events.
// Docs:
//   https://developer.yoco.com/guides/online-payments/webhooks/verifying-the-events
//   https://developer.yoco.com/api-reference/checkout-api/checkout/get-checkout
//   https://developer.yoco.com/api-reference/checkout-api/webhook-events/payment-notification
//
// When YOCO_WEBHOOK_SECRET is set, the body is trusted only after the
// Standard Webhooks HMAC check below.
//
// When that secret is not set, the body is only a hint for which checkout
// to load. The amount, status, and metadata that get logged come from
// GET https://payments.yoco.com/api/checkouts/{id} using YOCO_SECRET_KEY.
// The Checkout API has no payment or refund lookup that accepts this key
// (GET /api/payments/{id} is not a route). A completed checkout, with its
// paymentId, is the server-side confirmation.

const crypto = require("crypto");

const TOLERANCE_SECONDS = 180;
const CHECKOUTS_URL = "https://payments.yoco.com/api/checkouts";
const SAFE_ID = /^[A-Za-z0-9_-]{8,80}$/;

function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function verifySignature(rawBody, headers, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signatureHeader = header(headers, "webhook-signature");
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: "missing signature headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  const match = String(signatureHeader)
    .split(" ")
    .map((part) => part.split(","))
    .filter(([version, sig]) => version === "v1" && sig)
    .some(([, sig]) => {
      const given = Buffer.from(sig, "base64");
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    });

  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

function rawBodyOf(event) {
  return event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";
}

function checkoutIdFromEvent(evt) {
  const payload = evt && evt.payload && typeof evt.payload === "object" ? evt.payload : {};
  const meta = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  if (meta.checkoutId) return String(meta.checkoutId);
  if (evt && evt.type === "checkout.expired" && payload.id) return String(payload.id);
  return "";
}

function claimedPaymentId(evt) {
  const payload = evt && evt.payload && typeof evt.payload === "object" ? evt.payload : {};
  if (!evt) return "";
  if (evt.type === "refund.succeeded" || evt.type === "refund.failed") {
    return payload.paymentId ? String(payload.paymentId) : "";
  }
  if (evt.type === "payment.succeeded" || evt.type === "payment.failed") {
    return payload.id ? String(payload.id) : "";
  }
  return "";
}

// Pure decision. `checkout` is the GET /api/checkouts/{id} body. The event
// supplies the claimed type and, when present, a payment id to match.
// Amount, status, and metadata on `trusted` are copied from `checkout` only.
function decisionFromCheckout(evt, checkout) {
  if (!checkout || typeof checkout !== "object" || !Number.isInteger(checkout.amount)) {
    return { confirm: false, retry: false, reason: "checkout has no amount" };
  }
  const meta = checkout.metadata && typeof checkout.metadata === "object" ? checkout.metadata : {};
  const trusted = {
    checkoutId: checkout.id,
    paymentId: checkout.paymentId || null,
    amountCents: checkout.amount,
    currency: checkout.currency || "",
    status: checkout.status,
    mode: checkout.processingMode || "",
    packageId: meta.packageId || "",
    paymentType: meta.paymentType || "",
  };
  if (meta.source && meta.source !== "earthsigntravels.co.za") {
    return { confirm: false, retry: false, reason: "checkout is not from this site", trusted };
  }
  const claimed = claimedPaymentId(evt);
  if (claimed && checkout.paymentId && claimed !== checkout.paymentId) {
    return { confirm: false, retry: false, reason: "payment id does not match checkout", trusted };
  }
  if (checkout.status === "completed" && checkout.paymentId) {
    const refund = evt.type === "refund.succeeded" || evt.type === "refund.failed";
    return { confirm: true, retry: false, action: refund ? "refund" : "payment", trusted };
  }
  if (checkout.status === "expired") {
    return { confirm: true, retry: false, action: "expired", trusted };
  }
  const waitingOnSuccess =
    evt.type === "payment.succeeded" || evt.type === "refund.succeeded" || evt.type === "refund.failed";
  if (waitingOnSuccess) {
    return { confirm: false, retry: true, reason: "checkout not completed yet", trusted };
  }
  return { confirm: true, retry: false, action: "pending", trusted };
}

function logTrusted(action, evt, trusted) {
  if (action === "payment") {
    console.log("Payment succeeded", {
      eventId: evt.id,
      paymentId: trusted.paymentId,
      checkoutId: trusted.checkoutId,
      packageId: trusted.packageId,
      paymentType: trusted.paymentType,
      amountCents: trusted.amountCents,
      mode: trusted.mode,
      status: trusted.status,
      confirmedBy: "checkout-api",
    });
    return;
  }
  if (action === "refund") {
    // Checkout GET does not include a refund record. This amount is the
    // checkout's amount, not a refund amount taken from the event.
    console.log("Refund event", {
      eventId: evt.id,
      type: evt.type,
      paymentId: trusted.paymentId,
      checkoutId: trusted.checkoutId,
      checkoutAmountCents: trusted.amountCents,
      status: trusted.status,
      confirmedBy: "checkout-api",
    });
    return;
  }
  console.log("Yoco checkout", {
    eventId: evt.id,
    type: evt.type,
    checkoutId: trusted.checkoutId,
    status: trusted.status,
    amountCents: trusted.amountCents,
    confirmedBy: "checkout-api",
  });
}

function recordSignedEvent(evt) {
  const payment = evt.payload || {};
  const meta = payment.metadata || {};
  switch (evt.type) {
    case "payment.succeeded":
      console.log("Payment succeeded", {
        eventId: evt.id,
        paymentId: payment.id,
        checkoutId: meta.checkoutId,
        packageId: meta.packageId,
        paymentType: meta.paymentType,
        amountCents: payment.amount,
        mode: payment.mode,
      });
      break;
    case "refund.succeeded":
    case "refund.failed":
      console.log("Refund event", { eventId: evt.id, type: evt.type, paymentId: payment.id });
      break;
    default:
      console.log("Unhandled Yoco event", evt.type);
  }
}

async function fetchCheckout(checkoutId, secretKey) {
  const impl = exports.fetchImpl || fetch;
  const res = await impl(`${CHECKOUTS_URL}/${encodeURIComponent(checkoutId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function confirmUnsigned(rawBody, secretKey) {
  let evt;
  try {
    evt = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }
  if (!evt || typeof evt !== "object") return { statusCode: 400, body: "Invalid JSON" };

  const checkoutId = checkoutIdFromEvent(evt);
  if (!SAFE_ID.test(checkoutId)) {
    console.warn("Rejected unsigned Yoco event: no checkout id to confirm");
    return { statusCode: 422, body: "Checkout not confirmed" };
  }

  let loaded;
  try {
    loaded = await fetchCheckout(checkoutId, secretKey);
  } catch (err) {
    console.error("Yoco checkout lookup failed", err && err.message);
    return { statusCode: 502, body: "Could not confirm the payment" };
  }
  if (loaded.status === 404) return { statusCode: 422, body: "Checkout not confirmed" };
  if (loaded.status !== 200) {
    console.error("Yoco checkout lookup failed", loaded.status);
    return { statusCode: 502, body: "Could not confirm the payment" };
  }

  const decision = decisionFromCheckout(evt, loaded.data);
  if (!decision.confirm) {
    console.warn("Yoco checkout not confirmed", decision.reason);
    return {
      statusCode: decision.retry ? 409 : 422,
      body: decision.retry ? "Payment not completed yet" : "Checkout not confirmed",
    };
  }
  logTrusted(decision.action, evt, decision.trusted);
  return { statusCode: 200, body: "ok" };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  const rawBody = rawBodyOf(event);
  const webhookSecret = process.env.YOCO_WEBHOOK_SECRET;
  if (webhookSecret) {
    const result = verifySignature(rawBody, event.headers, webhookSecret);
    if (!result.ok) {
      console.warn("Rejected Yoco webhook:", result.reason);
      return { statusCode: 403, body: "Invalid signature" };
    }
    let evt;
    try {
      evt = JSON.parse(rawBody);
    } catch (e) {
      return { statusCode: 400, body: "Invalid JSON" };
    }
    recordSignedEvent(evt);
    return { statusCode: 200, body: "ok" };
  }

  const secretKey = process.env.YOCO_SECRET_KEY;
  if (!secretKey) {
    console.error("YOCO_SECRET_KEY is not set");
    return { statusCode: 503, body: "Online payments are not configured yet." };
  }
  return confirmUnsigned(rawBody, secretKey);
};

exports.verifySignature = verifySignature;
exports.decisionFromCheckout = decisionFromCheckout;
exports.checkoutIdFromEvent = checkoutIdFromEvent;
exports.SAFE_ID = SAFE_ID;
