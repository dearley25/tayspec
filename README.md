# Field Spec — with uploads

A small Node.js site: a public catalog of IT guides/videos/code, plus a
password-protected upload page so you can add new material without touching
code.

## Running it in VS Code

1. Install [Node.js](https://nodejs.org) (LTS version) if you don't have it.
2. Open this folder in VS Code.
3. Open a terminal in VS Code (`Terminal → New Terminal`) and run:
   ```
   npm install
   ```
4. Copy `.env.example` to a new file named `.env`, and change
   `ADMIN_PASSWORD` to something only you know:
   ```
   cp .env.example .env
   ```
5. Start the server:
   ```
   npm start
   ```
6. Open `http://localhost:3000` in your browser. The catalog is at `/`,
   uploads go through `/upload.html`.

Every time you save a file, stop the server (`Ctrl+C` in the terminal) and
run `npm start` again to see the change. (If you want auto-restart on save,
run `npm install --save-dev nodemon` and use `npx nodemon server.js` instead.)

## How uploads work

- `data/entries.json` holds the catalog — every entry's title, summary, type,
  and a link to its file or video.
- Uploaded files go straight to a **Cloudflare R2 bucket**, not local disk —
  so they survive restarts and redeploys.
- The upload page asks for the admin password before it will publish
  anything, checked against `ADMIN_PASSWORD` in your `.env` file. Nobody
  without that password can add or delete entries.
- Videos don't get uploaded as files — you paste a YouTube (or similar)
  embed link instead, so large video files never need to touch your server.

## Setting up Cloudflare R2 (one-time)

1. Sign up at [cloudflare.com](https://cloudflare.com) if you don't have an
   account (free tier covers this easily — 10GB storage free).
2. In the dashboard, go to **R2 Object Storage → Create bucket**. Name it
   something like `field-spec-uploads`.
3. Open the bucket → **Settings → Public access** → enable the `r2.dev`
   public URL. Copy that URL — you'll need it.
4. Go to **R2 → Manage API Tokens → Create API Token**. Give it read/write
   permission on your bucket. Copy the **Access Key ID** and
   **Secret Access Key** it gives you (shown only once).
5. Find your **Account ID** in the Cloudflare dashboard sidebar (under R2, or
   your account home page).
6. Fill these into your `.env` file:
   ```
   R2_ACCOUNT_ID=your-account-id
   R2_ACCESS_KEY_ID=your-access-key-id
   R2_SECRET_ACCESS_KEY=your-secret-access-key
   R2_BUCKET_NAME=field-spec-uploads
   R2_PUBLIC_URL=https://pub-xxxxxxxx.r2.dev
   ```
7. Restart the server (`npm start`). Uploads now go to R2 automatically —
   nothing else to change.

## Setting up Stripe (for paid content)

1. Sign up at [stripe.com](https://stripe.com) if you don't have an account.
2. In the dashboard, make sure you're in **Test mode** (toggle top-right)
   while you're setting things up — no real cards get charged in test mode.
3. Go to **Developers → API keys**, copy the **Secret key** (starts with
   `sk_test_...`).
4. Add it to `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_your_key_here
   ```
5. Test a purchase using Stripe's test card number `4242 4242 4242 4242`,
   any future expiry date, any 3-digit CVC.
6. Once you're ready to take real payments: in Stripe, toggle to **Live
   mode**, grab the `sk_live_...` key, and swap it into your environment
   variables (locally and on Render). That's the only change needed.

Also create the **second, private R2 bucket** mentioned above (same steps as
before, just don't enable its public dev URL) and add its name as
`R2_PRIVATE_BUCKET_NAME` in `.env`. Paid uploads go there automatically;
free uploads keep going to your existing public bucket.

## Deploying it for real (Render)

You've got a GitHub account but no repo yet for this project — here's the
full path from where you are:

1. **Create the repo:** go to github.com → click the **+** in the top right
   → **New repository**. Name it something like `tayspec`. Leave it empty
   (no README, no .gitignore) since your project already has files.
2. **Push your code**, using the VS Code terminal inside your project
   folder:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/tayspec.git
   git push -u origin main
   ```
   VS Code may pop up a browser window asking you to sign in to GitHub —
   that's normal, just approve it.
3. **Create the Render service:** sign up free at
   [render.com](https://render.com), click **New → Web Service**, connect
   your GitHub account, and select the `tayspec` repo.
4. Set the **Build Command** to `npm install` and the **Start Command** to
   `npm start`.
5. Under **Environment**, add every variable from your `.env` file
   individually (Render doesn't read `.env` files — you re-enter them here):
   `ADMIN_PASSWORD`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`,
   `R2_PRIVATE_BUCKET_NAME`, `STRIPE_SECRET_KEY`.
6. Click **Deploy**. Render builds it and gives you a live URL like
   `https://tayspec.onrender.com`.
7. **Important last step:** go back into Render's Environment settings and
   add `BASE_URL` set to that exact URL (e.g.
   `BASE_URL=https://tayspec.onrender.com`). Without this, Stripe will try
   to send buyers back to `localhost` after they pay. Redeploy after adding
   it (Render does this automatically when you save environment changes).

From then on, any time you `git push` new changes, Render redeploys
automatically.

### If you'd rather stick with familiar shared hosting

Traditional hosts like Hostinger are commonly recommended as GoDaddy
alternatives, but they're built around PHP/WordPress, not Node.js apps like
this one — you'd need a host that specifically offers Node.js hosting
(some do, as an add-on). Render, Railway, or Fly.io are the more natural fit
for what you've built here and all have working free tiers.
