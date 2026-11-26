// Optional local register. Prefer the Netlify function instead
// (POST /api/register-yoco-webhook). See README.
// The signing secret is removed before anything is printed.
//
//   YOCO_SECRET_KEY=sk_test_xxx node scripts/register-yoco-webhook.js https://earthsigntravelagency.netlify.app/api/yoco-webhook

const url = process.argv[2];
const key = process.env.YOCO_SECRET_KEY;
if (!url || !key || process.argv.length > 3) {
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
    if (data && typeof data === "object") delete data.secret;
    console.log(JSON.stringify(data, null, 2));
    if (res.ok) {
      console.log("Signing secret omitted. The site confirms payments by reading the checkout from Yoco.");
    }
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
