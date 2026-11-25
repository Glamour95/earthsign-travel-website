// Receives Yoco webhook events (payment.succeeded, refund.succeeded, refund.failed).
// Docs: https://developer.yoco.com/online/api-reference/webhooks/events/successful-payment/
//
// Yoco signs webhooks with the Standard Webhooks scheme:
//   signed content = `${webhook-id}.${webhook-timestamp}.${rawBody}`
//   key            = base64-decode(secret without the "whsec_" prefix)
//   signature      = base64(HMAC-SHA256(key, signed content))
//   header         = "webhook-signature: v1,<sig> [v1,<sig2> ...]"
// Requests older than 3 minutes are rejected (replay protection).
//
// Set YOCO_WEBHOOK_SECRET in Netlify to the secret returned when you register
// the webhook (see scripts/register-yoco-webhook.js and README.md).

const crypto = require("crypto");

const TOLERANCE_SECONDS = 180;

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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  const secret = process.env.YOCO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("YOCO_WEBHOOK_SECRET is not set");
    return { statusCode: 500, body: "Webhook not configured" };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  const result = verifySignature(rawBody, event.headers, secret);
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

  const payment = evt.payload || {};
  const meta = payment.metadata || {};

  switch (evt.type) {
    case "payment.succeeded":
      // This is the trusted confirmation that money was received.
      // TODO: send a confirmation email or save the booking (e.g. to a Google Sheet).
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

  // Respond quickly with 2xx so Yoco does not retry.
  return { statusCode: 200, body: "ok" };
};

exports.verifySignature = verifySignature;
