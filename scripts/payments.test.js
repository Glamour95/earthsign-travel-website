const assert = require("node:assert/strict");
const crypto = require("crypto");
const test = require("node:test");

const webhook = require("../netlify/functions/yoco-webhook.js");
const register = require("../netlify/functions/register-yoco-webhook.js");

const NOW = 1_700_000_000;
const SIGNING_SECRET = `whsec_${Buffer.from("test-secret-key-32bytes-long!!!!").toString("base64")}`;

function sign(body, secret, timestamp = NOW) {
  const id = "msg_test";
  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  const sig = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${sig}`,
  };
}

function checkout(overrides = {}) {
  return {
    id: "ch_abc12345",
    status: "completed",
    amount: 1000,
    currency: "ZAR",
    paymentId: "p_realpayment",
    metadata: {
      packageId: "yoco-test-package",
      paymentType: "full",
      source: "earthsigntravels.co.za",
    },
    processingMode: "test",
    ...overrides,
  };
}

function captureConsole() {
  const entries = [];
  const originals = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const flatten = (arg) => {
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg);
    } catch (e) {
      return String(arg);
    }
  };
  for (const level of Object.keys(originals)) {
    console[level] = (...args) => entries.push([level, args.map(flatten).join(" ")]);
  }
  return {
    entries,
    restore() {
      Object.assign(console, originals);
    },
    text() {
      return entries.map((entry) => entry[1]).join("\n");
    },
  };
}

test("verifySignature accepts a current v1 signature and rejects tampering", () => {
  const body = '{"type":"payment.succeeded"}';
  const headers = sign(body, SIGNING_SECRET);
  assert.deepEqual(webhook.verifySignature(body, headers, SIGNING_SECRET, NOW), { ok: true });
  assert.equal(webhook.verifySignature(`${body} `, headers, SIGNING_SECRET, NOW).ok, false);
  assert.equal(webhook.verifySignature(body, {}, SIGNING_SECRET, NOW).reason, "missing signature headers");
  const stale = sign(body, SIGNING_SECRET, NOW - 181);
  assert.equal(webhook.verifySignature(body, stale, SIGNING_SECRET, NOW).reason, "timestamp outside tolerance");
});

test("decisionFromCheckout trusts the checkout amount, status, and metadata", () => {
  const evt = {
    type: "payment.succeeded",
    payload: {
      id: "p_realpayment",
      amount: 1,
      metadata: { checkoutId: "ch_abc12345", packageId: "evil", paymentType: "deposit" },
    },
  };
  const decision = webhook.decisionFromCheckout(evt, checkout());
  assert.equal(decision.confirm, true);
  assert.equal(decision.action, "payment");
  assert.equal(decision.trusted.amountCents, 1000);
  assert.equal(decision.trusted.packageId, "yoco-test-package");
  assert.equal(decision.trusted.paymentType, "full");
  assert.equal(decision.trusted.status, "completed");
});

test("decisionFromCheckout ignores a checkout this site did not create", () => {
  const evt = { type: "payment.succeeded", payload: { id: "p_realpayment", metadata: { checkoutId: "ch_abc12345" } } };
  const foreign = webhook.decisionFromCheckout(evt, checkout({ metadata: { source: "somewhere-else", packageId: "x" } }));
  assert.equal(foreign.confirm, false);
  const withoutSource = webhook.decisionFromCheckout(evt, checkout({ metadata: { packageId: "yoco-test-package" } }));
  assert.equal(withoutSource.confirm, true);
  assert.equal(withoutSource.trusted.packageId, "yoco-test-package");
});

test("decisionFromCheckout does not confirm a mismatched payment or an unfinished checkout", () => {
  const succeeded = { type: "payment.succeeded", payload: { id: "p_other", metadata: { checkoutId: "ch_abc12345" } } };
  const mismatch = webhook.decisionFromCheckout(succeeded, checkout());
  assert.equal(mismatch.confirm, false);
  assert.equal(mismatch.retry, false);

  const pending = webhook.decisionFromCheckout(
    { type: "payment.succeeded", payload: { id: "p_realpayment" } },
    checkout({ status: "processing", paymentId: null }),
  );
  assert.equal(pending.confirm, false);
  assert.equal(pending.retry, true);
});

test("a signed webhook is accepted and a bad signature is not looked up", async () => {
  const logs = captureConsole();
  const previousSecret = process.env.YOCO_WEBHOOK_SECRET;
  process.env.YOCO_WEBHOOK_SECRET = SIGNING_SECRET;
  webhook.fetchImpl = () => {
    throw new Error("lookup should not run");
  };
  try {
    const body = JSON.stringify({
      id: "evt_1",
      type: "payment.succeeded",
      payload: {
        id: "p_1",
        amount: 1000,
        mode: "test",
        metadata: { checkoutId: "ch_abc12345", packageId: "yoco-test-package", paymentType: "full" },
      },
    });
    const ok = await webhook.handler({
      httpMethod: "POST",
      headers: sign(body, SIGNING_SECRET, Math.floor(Date.now() / 1000)),
      body,
    });
    assert.equal(ok.statusCode, 200);
    assert.match(logs.text(), /Payment succeeded/);
    assert.match(logs.text(), /1000/);

    const bad = await webhook.handler({
      httpMethod: "POST",
      headers: sign(`${body} `, SIGNING_SECRET),
      body,
    });
    assert.equal(bad.statusCode, 403);
  } finally {
    webhook.fetchImpl = undefined;
    if (previousSecret === undefined) delete process.env.YOCO_WEBHOOK_SECRET;
    else process.env.YOCO_WEBHOOK_SECRET = previousSecret;
    logs.restore();
  }
});

test("without a webhook secret, payment confirmation uses the checkout lookup", async () => {
  const logs = captureConsole();
  const previousWebhook = process.env.YOCO_WEBHOOK_SECRET;
  const previousKey = process.env.YOCO_SECRET_KEY;
  delete process.env.YOCO_WEBHOOK_SECRET;
  process.env.YOCO_SECRET_KEY = "sk_test_example";
  let called;
  webhook.fetchImpl = async (url, options) => {
    called = { url, authorization: options.headers.Authorization };
    return { status: 200, json: async () => checkout() };
  };
  try {
    const body = JSON.stringify({
      id: "evt_forged",
      type: "payment.succeeded",
      payload: {
        id: "p_realpayment",
        amount: 1,
        metadata: { checkoutId: "ch_abc12345", packageId: "evil", paymentType: "deposit" },
      },
    });
    const res = await webhook.handler({ httpMethod: "POST", headers: {}, body });
    assert.equal(res.statusCode, 200);
    assert.equal(called.url, "https://payments.yoco.com/api/checkouts/ch_abc12345");
    assert.equal(called.authorization, "Bearer sk_test_example");
    const text = logs.text();
    assert.match(text, /amountCents/);
    assert.match(text, /1000/);
    assert.match(text, /yoco-test-package/);
    assert.doesNotMatch(text, /"packageId": "evil"|packageId: 'evil'|packageId evil/);
    assert.doesNotMatch(text, /sk_test_example/);
  } finally {
    webhook.fetchImpl = undefined;
    if (previousWebhook === undefined) delete process.env.YOCO_WEBHOOK_SECRET;
    else process.env.YOCO_WEBHOOK_SECRET = previousWebhook;
    if (previousKey === undefined) delete process.env.YOCO_SECRET_KEY;
    else process.env.YOCO_SECRET_KEY = previousKey;
    logs.restore();
  }
});

test("unsigned events with no safe checkout id are rejected before any lookup", async () => {
  const previousWebhook = process.env.YOCO_WEBHOOK_SECRET;
  const previousKey = process.env.YOCO_SECRET_KEY;
  delete process.env.YOCO_WEBHOOK_SECRET;
  process.env.YOCO_SECRET_KEY = "sk_test_example";
  webhook.fetchImpl = () => {
    throw new Error("lookup should not run");
  };
  try {
    const res = await webhook.handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        type: "payment.succeeded",
        payload: { id: "p_1", amount: 999999, metadata: { checkoutId: "../secrets" } },
      }),
    });
    assert.equal(res.statusCode, 422);
    assert.equal(webhook.SAFE_ID.test("../secrets"), false);
  } finally {
    webhook.fetchImpl = undefined;
    if (previousWebhook === undefined) delete process.env.YOCO_WEBHOOK_SECRET;
    else process.env.YOCO_WEBHOOK_SECRET = previousWebhook;
    if (previousKey === undefined) delete process.env.YOCO_SECRET_KEY;
    else process.env.YOCO_SECRET_KEY = previousKey;
  }
});

test("registration requires the derived admin token and returns only status, id, and url", async () => {
  const logs = captureConsole();
  const previousKey = process.env.YOCO_SECRET_KEY;
  const previousAdmin = process.env.ADMIN_SETUP_TOKEN;
  delete process.env.ADMIN_SETUP_TOKEN;
  process.env.YOCO_SECRET_KEY = "sk_test_example";
  const token = register.derivedAdminToken("sk_test_example");
  const calls = [];
  register.fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body, authorization: options.headers.Authorization });
    if (options.method === "GET") return { status: 200, json: async () => ({ subscriptions: [] }) };
    return {
      status: 201,
      json: async () => ({
        id: "sub_testwebhook",
        url: register.WEBHOOK_URL,
        mode: "test",
        secret: "whsec_this-must-not-leak",
      }),
    };
  };
  try {
    const denied = await register.handler({
      httpMethod: "POST",
      headers: { "x-admin-token": "nope" },
    });
    assert.equal(denied.statusCode, 401);
    assert.equal(calls.length, 0);

    const created = await register.handler({
      httpMethod: "POST",
      headers: { "X-Admin-Token": token },
    });
    assert.equal(created.statusCode, 200);
    const body = JSON.parse(created.body);
    assert.deepEqual(body, {
      status: "registered",
      id: "sub_testwebhook",
      url: "https://earthsigntravelagency.netlify.app/api/yoco-webhook",
    });
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[1].url, "https://payments.yoco.com/api/webhooks");
    assert.equal(calls[1].authorization, "Bearer sk_test_example");
    assert.equal(JSON.parse(calls[1].body).url, register.WEBHOOK_URL);
    const leaked = `${created.body}\n${logs.text()}`;
    assert.equal(leaked.includes("whsec_"), false);
    assert.equal(leaked.includes("sk_test_example"), false);

    calls.length = 0;
    register.fetchImpl = async (url, options) => {
      calls.push(options.method);
      return {
        status: 200,
        json: async () => ({
          subscriptions: [{ id: "sub_existing", url: register.WEBHOOK_URL, secret: "whsec_nope" }],
        }),
      };
    };
    const again = await register.handler({
      httpMethod: "POST",
      headers: { "x-admin-token": token },
    });
    assert.deepEqual(JSON.parse(again.body), {
      status: "already_registered",
      id: "sub_existing",
      url: register.WEBHOOK_URL,
    });
    assert.deepEqual(calls, ["GET"]);
    assert.equal(again.body.includes("whsec_"), false);
  } finally {
    register.fetchImpl = undefined;
    if (previousKey === undefined) delete process.env.YOCO_SECRET_KEY;
    else process.env.YOCO_SECRET_KEY = previousKey;
    if (previousAdmin === undefined) delete process.env.ADMIN_SETUP_TOKEN;
    else process.env.ADMIN_SETUP_TOKEN = previousAdmin;
    logs.restore();
  }
});

test("ADMIN_SETUP_TOKEN replaces the derived token", async () => {
  const previousKey = process.env.YOCO_SECRET_KEY;
  const previousAdmin = process.env.ADMIN_SETUP_TOKEN;
  process.env.YOCO_SECRET_KEY = "sk_test_example";
  process.env.ADMIN_SETUP_TOKEN = "owner-chosen-token";
  register.fetchImpl = async () => ({ status: 200, json: async () => ({ subscriptions: [] }) });
  try {
    const derived = register.derivedAdminToken("sk_test_example");
    const rejected = await register.handler({
      httpMethod: "POST",
      headers: { "x-admin-token": derived },
    });
    assert.equal(rejected.statusCode, 401);
    assert.equal(register.expectedAdminToken("sk_test_example"), "owner-chosen-token");
    const method = await register.handler({ httpMethod: "GET", headers: { "x-admin-token": "owner-chosen-token" } });
    assert.equal(method.statusCode, 405);
  } finally {
    register.fetchImpl = undefined;
    if (previousKey === undefined) delete process.env.YOCO_SECRET_KEY;
    else process.env.YOCO_SECRET_KEY = previousKey;
    if (previousAdmin === undefined) delete process.env.ADMIN_SETUP_TOKEN;
    else process.env.ADMIN_SETUP_TOKEN = previousAdmin;
  }
});

test("redact removes secret fields at any depth", () => {
  assert.deepEqual(register.redact({ id: "sub_1", secret: "whsec_x", nested: { webhookSecret: "no" } }), {
    id: "sub_1",
    nested: {},
  });
});
