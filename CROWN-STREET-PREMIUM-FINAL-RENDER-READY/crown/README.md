# CROWN STREET — Professional Clothing Store

Premium black, ivory and gold visual refresh, responsive product cards, image-led fashion hero, category-based product image fallbacks, existing Supabase store, customer accounts, cart/checkout, order history and admin dashboard.

## Run locally
1. Extract this ZIP.
2. Open the `crown` folder in VS Code (the folder containing `server.js` and `package.json`).
3. Create/copy `.env` in this folder. Add your Supabase URL and service-role key as explained below. Never put secrets inside `public`.
4. Run `npm start` in the VS Code terminal.
5. Open `http://localhost:3000` (do not use Live Server/port 5500).

## Environment variables
Copy `.env.example` to `.env`, then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Keep the service role key private. For the admin account, set a strong `ADMIN_EMAIL` and `ADMIN_PASSWORD` before using this on a real server.

## Payments
Cash on Delivery is available without a payment gateway. Razorpay support is optional and requires a Razorpay account plus Test Mode API keys in `.env`; it is not active until those keys are configured. Do not use live payment keys for local testing.

## Important notes
- Fashion photography uses remote Unsplash image URLs as default fallbacks; internet access is required for those images. Admin-uploaded/product image URLs take precedence. You can replace them with your own licensed product photography.
- Run `npm test` for the included automated smoke tests. This is not a substitute for a live Supabase/payment end-to-end test.
- Before launch, review Supabase Row Level Security, admin credentials, privacy/returns/shipping policies, backups, and payment capture settings.


## Premium edition notes
- The storefront uses a refined black/ivory/gold CROWN STREET visual theme.
- A visual brand concept image is included at `public/images/crown-street-brand-showcase.png`. It is a design reference, not an interactive page.
- Start from the `crown` folder containing `server.js` and `package.json`; run `npm start`, then open `http://localhost:3000`.
- JavaScript syntax checks do not replace live testing with your own Supabase credentials.

## Deploy the complete website on Render (frontend + backend)

This project serves the `public/` website and `/api/*` backend from the same Node.js server. Deploy the **repository root folder containing `server.js`, `package.json`, `render.yaml`, and `public/`**. Do not deploy only the `public/` folder if you need login, orders, admin, or database features.

1. Create a private GitHub repository and upload the contents of the `crown/` folder. Do not upload `.env`, passwords, service-role keys, or other secrets. `.gitignore` excludes `.env`.
2. In Supabase, open SQL Editor and run the complete `supabase-setup.sql` script once.
3. In Render, choose **New + → Blueprint** and connect the repository containing `render.yaml`.
4. In the Render service's Environment settings, set these values using your own Supabase project details:
   - `SUPABASE_URL`: your Supabase project URL (e.g. `https://YOUR-PROJECT.supabase.co`)
   - `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role/secret key. Keep this private and server-side only.
   - `ADMIN_EMAIL`: the email you want for the store admin account on first database initialization.
   - `ADMIN_PASSWORD`: choose a strong, unique password before the first start.
   - `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are optional until Razorpay payments are configured; keep test/live credentials private.
5. Deploy and wait until Render reports the service as Live. Visit `https://YOUR-SERVICE.onrender.com/api/health`; a JSON response with `"ok":true` confirms the server is running.
6. Open `https://YOUR-SERVICE.onrender.com/` for the storefront. The same origin serves `/api/*`, so frontend API requests do not need a localhost URL or a separate Netlify API setting.

Important:
- Never commit `.env` or expose `SUPABASE_SERVICE_ROLE_KEY` in browser code.
- Set `ADMIN_PASSWORD` before the first successful initialization. The initial admin is created only if `store_state` has no row yet; changing the environment variable later does not automatically reset an existing admin password.
- This demo keeps login sessions in server memory, so sessions may end after a service restart/redeploy. For a high-traffic production store, use a persistent session store and review security, backups, and payment configuration before accepting real payments.
- Render free services may sleep when idle and take a short time to wake up.
