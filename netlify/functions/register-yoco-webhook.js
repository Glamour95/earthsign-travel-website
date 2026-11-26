// Registers the Checkout webhook with Yoco.
// Docs: https://developer.yoco.com/api-reference/checkout-api/webhooks/register-webhook
//       https://developer.yoco.com/api-reference/checkout-api/webhooks/list-webhooks
//       https://developer.yoco.com/guides/online-payments/webhooks/listen-for-events
//
// POST https://payments.yoco.com/api/webhooks with Authorization: Bearer
// <Checkout secret key> (sk_test_... or sk_live_...). Success is 201.
// List returns { subscriptions: [...] } and does not include the signing
// secret. The create response includes secret once; this function drops it
// and never logs it.
//
// Callers must send header x-admin-token. If ADMIN_SETUP_TOKEN is set, that
// value is the token. Otherwise the token is
// HMAC-SHA256(YOCO_SECRET_KEY, "earthsign-register-webhook") as hex.

const crypto = require("crypto");

const WEBHOOK_URL = "https://earthsigntravelagency.netlify.app/api/yoco-webhook";
const WEBHOOKS_ENDPOINT = "https://payments.yoco.com/api/webhooks";
const TOKEN_MESSAGE = "earthsign-register-webhook";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

function header(headers, name) {
  if (!headers) return "";
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const value = key ? headers[key] : "";
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value || "");
}

function derivedAdminToken(secretKey) {
  return crypto.createHmac("sha256", secretKey).update(TOKEN_MESSAGE).digest("hex");
}

function expectedAdminToken(secretKey) {
  if (process.env.ADMIN_SETUP_TOKEN) return process.env.ADMIN_SETUP_TOKEN;
  return derivedAdminToken(secretKey);
}

function tokensMatch(expected, given) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(given));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value)) {
    if (key === "secret" || key.toLowerCase().includes("secret")) continue;
    out[key] = redact(value[key]);
  }
  return out;
}

async function yoco(url, secretKey, method, body) {
  const impl = exports.fetchImpl || fetch;
  const res = await impl(url, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = redact(await res.json().catch(() => ({})));
  return { status: res.status, data };
}

function publicFailure(status) {
  if (status === 403) {
    return "Yoco returned 403 for webhook registration. The Checkout docs call this a permission error on the webhook subscription.";
  }
  if (status === 401) {
    return "Yoco rejected the secret key.";
  }
  return "Yoco rejected the webhook registration.";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  const secretKey = process.env.YOCO_SECRET_KEY;
  if (!secretKey) {
    console.error("YOCO_SECRET_KEY is not set");
    return json(503, { error: "Online payments are not configured yet." });
  }

  const given = header(event.headers, "x-admin-token");
  if (!tokensMatch(expectedAdminToken(secretKey), given)) {
    return json(401, { error: "Unauthorized." });
  }

  let listed;
  try {
    listed = await yoco(WEBHOOKS_ENDPOINT, secretKey, "GET");
  } catch (err) {
    console.error("Yoco webhook list failed", err && err.message);
    return json(502, { error: "Could not reach Yoco." });
  }
  if (listed.status !== 200 || !Array.isArray(listed.data.subscriptions)) {
    console.error("Yoco webhook list failed", listed.status);
    return json(502, { error: publicFailure(listed.status), yocoStatus: listed.status });
  }

  const existing = listed.data.subscriptions.find((sub) => sub && sub.url === WEBHOOK_URL && sub.id);
  if (existing) {
    return json(200, { status: "already_registered", id: existing.id, url: existing.url });
  }

  let created;
  try {
    created = await yoco(WEBHOOKS_ENDPOINT, secretKey, "POST", {
      name: "earthsign-website",
      url: WEBHOOK_URL,
    });
  } catch (err) {
    console.error("Yoco webhook register failed", err && err.message);
    return json(502, { error: "Could not reach Yoco." });
  }
  if ((created.status !== 201 && created.status !== 200) || !created.data.id) {
    console.error("Yoco webhook register failed", created.status);
    return json(502, { error: publicFailure(created.status), yocoStatus: created.status });
  }

  console.log("Yoco webhook registered", { id: created.data.id, mode: created.data.mode });
  return json(200, {
    status: "registered",
    id: created.data.id,
    url: created.data.url || WEBHOOK_URL,
  });
};

exports.derivedAdminToken = derivedAdminToken;
exports.expectedAdminToken = expectedAdminToken;
exports.WEBHOOK_URL = WEBHOOK_URL;
exports.redact = redact;
