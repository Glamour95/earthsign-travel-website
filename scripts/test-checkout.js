// Local smoke test: creates a real Yoco TEST checkout for the R10 test package
// by calling the Netlify function directly. Prints only the status and the
// redirect URL host, never the key.
// Usage: YOCO_SECRET_KEY=sk_test_xxx node scripts/test-checkout.js [deposit|full]

const { handler } = require("../netlify/functions/create-checkout.js");

(async () => {
  if (!process.env.YOCO_SECRET_KEY) {
    console.error("Set YOCO_SECRET_KEY to your Yoco secret TEST key first.");
    process.exit(1);
  }
  if (process.env.YOCO_SECRET_KEY.startsWith("sk_live_")) {
    console.error("Refusing to run the smoke test with a live key.");
    process.exit(1);
  }
  const paymentType = process.argv[2] || "full";
  const res = await handler({
    httpMethod: "POST",
    headers: { host: "localhost:8888" },
    body: JSON.stringify({ packageId: "yoco-test-package", paymentType, amount: 1 }),
  });
  const body = JSON.parse(res.body);
  console.log("Function status:", res.statusCode);
  if (body.redirectUrl) {
    console.log("redirectUrl returned: yes, host =", new URL(body.redirectUrl).host);
  } else {
    console.log("Error:", body.error);
    process.exit(1);
  }
})();
