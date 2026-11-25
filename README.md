# Earthsign Travel website

**Explore. Inspire. Journey.**

The website for Earthsign Travel Agency at [earthsigntravels.co.za](https://earthsigntravels.co.za): Kruger and luxury safaris, Mpumalanga getaways, accommodation, island and international escapes, flights, corporate and group travel, retreats, romantic escapes and custom trips.

It's a fast static site (plain HTML, CSS and JavaScript, no build step). Two small Netlify Functions take card payments through **Yoco Checkout**.

Contact details used on the site:
- Email: earthsignlistings@gmail.com
- Call: +27 79 199 4049
- WhatsApp: +27 73 740 9310

---

## What's in the repo

```text
index.html                 Home: hero, services, packages (with filters), festive note, corporate, enquiry form
corporate.html             Corporate & group travel landing page (for campaigns)
payment-success.html       Yoco sends customers here after paying
payment-cancelled.html     ...after cancelling
payment-failed.html        ...after a failed payment
enquiry-sent.html          Shown after an enquiry form is sent
404.html
style.css, script.js
data/packages.json         THE package list (website cards + checkout prices)
images/                    Logos and photos (see "Images" below)
netlify.toml               Netlify deploy settings
netlify/functions/
  create-checkout.js       Creates a Yoco checkout (server-side price lookup)
  yoco-webhook.js          Receives Yoco payment events (signature verified)
scripts/
  test-checkout.js         Local test: creates one R10 Yoco TEST checkout
  register-yoco-webhook.js Registers the webhook with Yoco and prints its secret
CNAME, _config.yml         GitHub Pages settings (only used until the domain moves to Netlify)
```

## How payments work

1. A customer clicks **Pay deposit** or **Pay in full** on a package.
2. The browser sends only the package id and payment type to `/api/create-checkout`.
3. The function looks up the price in `data/packages.json` (the browser can't change the amount), then calls `POST https://payments.yoco.com/api/checkouts` with the secret key from the `YOCO_SECRET_KEY` environment variable.
4. Yoco returns a `redirectUrl`, and the customer pays on Yoco's secure page.
5. Yoco sends the customer back to `payment-success.html`, `payment-cancelled.html` or `payment-failed.html`.
6. Yoco also calls `/api/yoco-webhook` with a signed `payment.succeeded` event. That event, not the success page, is the real proof of payment. It is logged in Netlify (Functions > yoco-webhook > Logs).

**The secret key is never stored in this repository.** It lives only in Netlify's environment variables. The public key (`pk_test_...`) is not needed by this integration, because Yoco Checkout is a hosted page.

GitHub Pages cannot run server code, so **payments only work once the site is hosted on Netlify**. On GitHub Pages the Pay buttons show a friendly "WhatsApp us to book" message instead.

---

## Setup (one time)

### 1. Put the site on Netlify
1. Create a free account at [netlify.com](https://app.netlify.com/signup) (sign up with GitHub).
2. **Add new site > Import an existing project > GitHub** and pick `Glamour95/earthsign-travel-website`.
3. Leave the build settings as they are (they come from `netlify.toml`: no build command, publish directory `.`, functions in `netlify/functions`), then click **Deploy**.
4. You get a temporary address like `https://earthsign-travel.netlify.app`. Test everything there first.

### 2. Add the Yoco keys (environment variables)
In Netlify: **Site configuration > Environment variables > Add a variable**.

| Key | Value | Notes |
| --- | --- | --- |
| `YOCO_SECRET_KEY` | Your Yoco **secret test key** (`sk_test_...`) | From the Yoco portal: Sales > Payment gateway > API keys (test mode). Mark it as secret. |
| `YOCO_WEBHOOK_SECRET` | The `whsec_...` secret from step 3 | |
| `SITE_URL` (optional) | `https://earthsigntravels.co.za` | Forces the return links to the real domain. Netlify's own `URL` is used if this isn't set. |

After adding or changing variables, go to **Deploys > Trigger deploy > Deploy site** so the functions pick them up.

### 3. Register the webhook with Yoco
Run this once on your computer (Node 18 or later), using your secret test key:

```bash
YOCO_SECRET_KEY=sk_test_xxx node scripts/register-yoco-webhook.js https://earthsigntravels.co.za/api/yoco-webhook
```

(Use your `.netlify.app` address instead if the domain isn't on Netlify yet.) Copy the `secret` it prints (starts with `whsec_`) into Netlify as `YOCO_WEBHOOK_SECRET`, then redeploy. Yoco shows this secret only once.

### 4. Test a payment
1. Open the site on Netlify and find **"Yoco test package - R10 (test only)"** under Packages.
2. Click **Pay in full** (or **Pay deposit**, R5). You'll land on Yoco's checkout page in test mode.
3. Pay with a Yoco test card (see Yoco's developer docs > Testing), and you'll come back to the success page.
4. Check **Netlify > Logs > Functions > yoco-webhook** for a `Payment succeeded` line.

You can also test the function from your computer without deploying:

```bash
YOCO_SECRET_KEY=sk_test_xxx node scripts/test-checkout.js
# Function status: 200
# redirectUrl returned: yes, host = c.yoco.com
```

### 5. Point earthsigntravels.co.za to Netlify
1. In Netlify: **Domain management > Add a domain** and enter `earthsigntravels.co.za` (add `www.earthsigntravels.co.za` too).
2. Netlify shows the DNS records to use. At GoDaddy (DNS for earthsigntravels.co.za), either:
   - **Easiest:** switch the nameservers to the Netlify DNS nameservers Netlify gives you, **or**
   - **Keep GoDaddy DNS:** change the `A` record for `@` to Netlify's load balancer IP (shown in Netlify, currently `75.2.60.5`) and set `www` as a `CNAME` to your `*.netlify.app` address. Remove the old GitHub Pages `A` records (`185.199.108-111.153`).
3. Wait for DNS to update (minutes to a few hours). Netlify then issues the free HTTPS certificate automatically.
4. Once it's live on Netlify, you can turn off GitHub Pages (repo **Settings > Pages**) so there's only one copy of the site.

Make sure the domain stays renewed at GoDaddy, or the site and all payment links stop working.

### 6. Enquiry form emails
The enquiry forms use **Netlify Forms** (no server needed). Netlify detects them on deploy.
In Netlify: **Forms > Form notifications > Add notification > Email notification**, and send to `earthsignlistings@gmail.com` for the forms `enquiry` (home page) and `corporate-enquiry` (corporate page). Submissions are also listed under **Forms**.
If a form can't post (for example while the site is still on GitHub Pages), the visitor's email app opens with the enquiry filled in, addressed to earthsignlistings@gmail.com.

---

## Adding or changing packages

Everything comes from **`data/packages.json`**. Edit it on GitHub (pencil icon) and commit; Netlify redeploys automatically.

Each package looks like this:

```json
{
  "id": "kruger-3-night-lodge",
  "active": true,
  "name": "3-night Greater Kruger lodge safari",
  "region": "kruger-mpumalanga",
  "budget": "mid-range",
  "nightsMin": 3,
  "nightsMax": 3,
  "lengthLabel": "3 nights",
  "summary": "One or two sentences about the trip.",
  "includes": ["Accommodation", "All meals", "Two game drives a day"],
  "image": "images/hero-leopard.webp",
  "pricing": { "basis": "per person sharing", "full": 1250000, "deposit": 300000 }
}
```

- **Prices are in cents**: R12,500.00 = `1250000`, R3,000 = `300000`. Yoco's minimum is R2.
- `pricing.full` shows a **Pay in full** button and `pricing.deposit` shows a **Pay deposit** button. Leave either one out to hide that button.
- `"pricing": null` makes it a **Get a quote** card (no online payment).
- `id` must be unique and should never change after people have paid (it's sent to Yoco as metadata).
- `region` must be one of the keys in `regions` (`kruger-mpumalanga`, `south-africa`, `indian-ocean`, `international`). `budget` must be one of `budget`, `mid-range`, `luxury`. You can add new regions or budgets to those lists.
- `nightsMin` and `nightsMax` drive the Length filter (Weekend 1-3, Short break 4-6, A week or more 7+).
- `"active": false` hides a package without deleting it.
- The trips listed now are **quote-only ideas without prices**. Add real Earthsign prices only when they're confirmed.

## Going live (switching to live keys)

Once Yoco has verified the test integration:
1. In the Yoco portal, copy your **live secret key** (`sk_live_...`).
2. In Netlify, change `YOCO_SECRET_KEY` to the live key.
3. Register the webhook again with the live key (step 3 above) and update `YOCO_WEBHOOK_SECRET` to the new secret.
4. In `data/packages.json`, set the test package to `"active": false`. (The checkout function also refuses to charge the test package with a live key.)
5. Trigger a redeploy. No code changes are needed.

## Images

Photos and logos in `images/` are compressed `.webp` files (about 20-40 KB each), plus `safari.jpg` for the Kruger self-drive package. To use a new photo, add a compressed `.jpg` or `.webp` (under about 200 KB, around 1200 px wide) to `images/` and point the page or package at it.

## Local preview

Any static server works for the pages, for example `npx serve .`. To run the payment function locally too, install the Netlify CLI (`npm i -g netlify-cli`) and run `netlify dev` with `YOCO_SECRET_KEY` set in your shell.
