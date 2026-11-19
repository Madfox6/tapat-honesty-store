# Chingu Honesty Store

Self-service snack corner for Chingu Honesty Store: customers scan the entrance QR, pick a store, take items from that shelf, and pay by cash, a GCash / Maya / BPI / MariBank QR, or a split of both (QR payments need a receipt upload). The owner manages sales, shelf and warehouse stock, ads, requests, expenses, and optional email from `owner.html`.

This repository is the **static frontend**, served by GitHub Pages. The backend runs on Supabase:

| Part | Where |
|---|---|
| API | Supabase Edge Function `store` — `https://agocfonofpmmeqdvmneu.supabase.co/functions/v1/store` |
| Database | Supabase Postgres tables `products`, `config`, `orders` (RLS on, no public policies — only the function's service role can read/write) |
| Files | Private Storage bucket `store-files` (product photos / payment QRs `image-*`, customer receipts `proof-*`), served by the function. Receipts are only readable by the owner. |
| Owner sign-in | Supabase Auth (email + password) |

## Files

- `index.html` – customer storefront (store picker, shelf stock, ads, requests, receipt)
- `owner.html` – owner dashboard (sales, inventory, requests, ads, expenses, email, payment QRs, entrance QR)
- `app.js`, `store-logic.js`, `styles.css` – shared app code and styles
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

The live API only accepts the GitHub Pages origin, so localhost needs the demo server:

    node test/mock-server.mjs
    # storefront http://localhost:8765/?demo=1
    # owner     http://localhost:8765/owner.html?demo=1

`?demo=1` is ignored on the published site. Calculations in `store-logic.js` can be checked with `node --test test/store-logic.test.mjs`.

## Apply a backend change

Merging to `main` publishes the site. Apply database and function changes before that merge, in this order:

1. Run `supabase/migrations/20261119120000_multi_store.sql` once in the Supabase SQL editor.
2. Deploy the `store` edge function from `supabase/functions/store/index.ts`.
3. Optional email: set function secrets `RESEND_API_KEY` and `EMAIL_FROM`. Until both are set, the Email tab says email is not configured and checkout still completes.
