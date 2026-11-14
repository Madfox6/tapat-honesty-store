# Chingu Honesty Store

Self-service snack corner for Chingu Honesty Store: customers scan the entrance QR, pick items and pay by cash, a GCash / Maya / BPI / MariBank QR, or a split of both (QR payments need a receipt upload). The owner manages sales, stock, payment QRs and receipt review from `owner.html`.

This repository is the **static frontend**, served by GitHub Pages. The backend runs on Supabase:

| Part | Where |
|---|---|
| API | Supabase Edge Function `store` — `https://agocfonofpmmeqdvmneu.supabase.co/functions/v1/store` |
| Database | Supabase Postgres tables `products`, `config`, `orders` (RLS on, no public policies — only the function's service role can read/write) |
| Files | Private Storage bucket `store-files` (product photos / payment QRs `image-*`, customer receipts `proof-*`), served by the function. Receipts are only readable by the owner. |
| Owner sign-in | Supabase Auth (email + password) |

## Files

- `index.html` – customer storefront
- `owner.html` – owner dashboard (sign in, claim, sales, inventory, payment QRs, entrance QR)
- `app.js`, `styles.css` – shared app code and styles
- `config.js` – public settings: function URL, Supabase URL, **publishable** key, optional `SITE_URL`. Never put a secret / service-role key here.
- `photos/` – the 8 sample product photos
- `vendor/` – pinned copies of supabase-js (UMD) and qrcode-generator
- `.github/workflows/pages.yml` – deploys the repo root to GitHub Pages on every push to `main`

## Deploy

1. Push this folder to the root of a GitHub repo on branch `main`.
2. The workflow enables Pages (source: GitHub Actions) and publishes. If it fails with a Pages permission error, open **Settings → Pages**, set **Source: GitHub Actions**, and re-run the workflow.
3. The store is then at `https://<user>.github.io/<repo>/`, the dashboard at `https://<user>.github.io/<repo>/owner.html`.

All paths are relative, so the site works under the `/<repo>/` sub-path.

## Owner setup (first time)

1. Open `owner.html`, enter your email and a password, and press **Create account**.
2. Email confirmation is ON for this Supabase project: open the confirmation email and click the link, then come back to `owner.html` and **Sign in**.
   (Tip: in Supabase → Authentication → URL Configuration, set **Site URL** to your Pages URL and add `https://<user>.github.io/<repo>/owner.html` to **Redirect URLs** so the link lands on the dashboard.)
3. Enter the one-time **setup key** and press **Link owner account**. The first signed-in account with the correct key becomes the owner; after that the store is claimed and the key no longer works.
4. Upload your payment QRs under **Payment QRs**, adjust stock under **Inventory**, and print the entrance QR from **Store QR** (it encodes the current site URL, or `SITE_URL` from `config.js` if set).

Optional hardening once the owner exists: Supabase → Authentication → Sign In / Providers → turn off "Allow new users to sign up".

## CORS

The edge function accepts browser requests from the live Pages origin, `https://madfox6.github.io`. Local previews of the catalog need a mock `/api/catalog` because localhost is not allowed.

## Local preview

    python3 -m http.server 8000
    # open http://localhost:8000/
