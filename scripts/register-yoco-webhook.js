// One-off: register the webhook URL with Yoco and print the signing secret.
// Usage (run on your own computer, never commit the output):
//   YOCO_SECRET_KEY=sk_test_xxx node scripts/register-yoco-webhook.js https://earthsigntravels.co.za/api/yoco-webhook
// Copy the printed "secret" (starts with whsec_) into Netlify as YOCO_WEBHOOK_SECRET.
// Repeat with your live key when you switch to live mode.

const url = process.argv[2];
const key = process.env.YOCO_SECRET_KEY;
if (!url || !key) {
  console.error("Usage: YOCO_SECRET_KEY=sk_... node scripts/register-yoco-webhook.js <webhook-url>");
  process.exit(1);
}

fetch("https://payments.yoco.com/api/webhooks", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify({ name: "earthsign-website", url }),
})
  .then(async (res) => {
    const data = await res.json().catch(() => ({}));
    console.log("HTTP", res.status);
    console.log(JSON.stringify(data, null, 2));
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
