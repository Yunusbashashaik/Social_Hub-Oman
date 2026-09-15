---
published: false
---

# Social_Hub-Oman

> **Open the website (iPad / phone):** [https://yunusbashashaik.github.io/Social_Hub-Oman/](https://yunusbashashaik.github.io/Social_Hub-Oman/)  
> Do **not** use `yunusbashashaik.github.io` alone — that is not your store URL.

Social Hub — bilingual digital subscription marketplace for Oman (OMR).

## Development

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

- **Client:** http://localhost:5173 (Vite dev server; proxies `/api` to the backend)
- **API:** http://localhost:3001 (`GET /api/health`, `GET /api/services`, `GET /api/settings`, `POST /api/complaints`, `POST /api/admin/login`)

```bash
npm run lint
npm run test
npm run build
npm start   # serves built client + API on port 3001
```

### Dynamic database (SQLite)

Admin edits and public catalog/settings are stored **outside the GitHub file set** so a new publish or **Restart Published App** does not erase them. The API never uses `/app/socialhub-oman-data` as the live store (that path is wiped with the container). Prefer **`/root/socialhub-oman-data`**, or set `DATA_DIR` to a host folder that is not under the app tree. Factory catalog names/prices seed **once** on a brand-new empty durable store and never overwrite existing admin rows.

Optional env:

- `DATA_DIR` — durable folder for SQLite, `admin-state.json`, and uploads (must survive Restart Published App)
- `DATABASE_PATH` — custom SQLite file path
- `ADMIN_USERNAME` (default: `admin`)
- `ADMIN_PASSWORD` (default: `Ss$135790`)
- `ADMIN_SESSION_SECRET` — signs admin session tokens

### Admin panel

Click the **Admin** icon in the header. A modal prompts for credentials, then opens the Admin Dashboard:

- **Add Services** — JPEG image, name, EN/AR descriptions, 1-month and 1-year prices, optional Offer Type (None / Eid Offer / Special Offer) with expiry date and time
- **Edit Services** — dropdown for Services, Complaint Email ID, Contact Details (WhatsApp), and About Us / social links

Default credentials: `admin` / `Ss$135790` (override with `ADMIN_USERNAME` / `ADMIN_PASSWORD`).

Out-of-stock services use price `0`, show an **Out of Stock** note, and disable Add to Cart. Optional Eid/Special offers replace that badge with a live countdown while active; after expiry that service is hidden from the store only.

### Deploy on GoDaddy (Node.js)

Admin login needs a **running Node app**. If `https://YOUR-DOMAIN/api/health` does not return `{"ok":true}`, login cannot work.

**cPanel Application Manager (Passenger)**

1. Setup → Application Manager → Register Application  
2. Application root = **`/root`** (clone or extract this repo so `app.js` is `/root/app.js`)  
3. Application URL = your domain (or subdomain) **root**, not a `/public_html` static copy  
4. Application startup file: `app.js`  
5. Node.js version: 20+  
6. In `/root`:
   ```bash
   cd /root
   npm install
   npm run build
   ```
7. Restart the application  
8. Visit `https://YOUR-DOMAIN/api/health` — you must see JSON `ok: true`  
9. Then sign in with `admin` / `Ss$135790`

Do **not** FTP only `client/dist` into `public_html`. That is static hosting and `/api/health` will 404.

If Apache serves static files and Node is on port 3001, copy `docs/godaddy.htaccess` to `public_html/.htaccess` (requires `mod_proxy`).

If the website and API use different URLs, edit `client/public/runtime-config.js` after build:

```js
window.__GLOBALSTORE_CONFIG__ = { apiUrl: "https://your-node-api-url" };
```

Keep **`/root/socialhub-oman-data`** (or the `DATA_DIR` you set) so SQLite and uploads survive GitHub publishes and **Restart Published App**. Do not delete that folder. `GET /api/health` shows `dataDir`, `storePath`, `snapshotSavedAt`, `catalogSeededThisBoot`, and `services` count. `dataDirInsideApp` must be `false`.

### GoDaddy republish checklist (socialhubomr.com)

1. Publish **`main`** (this repo) in Application Manager — not an old branch.
2. Open `https://socialhubomr.com/api/health`. Confirm `ok: true`, `dataDir` is **not** `/app/socialhub-oman-data` (expect `/root/socialhub-oman-data` or another host path), and `dataDirInsideApp` is `false`.
3. In Admin, rename a service (for example YouTube / Canva) and save. Reload health: **`snapshotSavedAt` must be newer** than before the save.
4. Use **Restart Published App**. Reload health: `dataDir` unchanged, `catalogSeededThisBoot` is `false`, `snapshotSavedAt` still the post-edit value.
5. Open `https://socialhubomr.com/api/services` and the public site — names/prices must **not** snap back to factory defaults.

If health still shows `/app/socialhub-oman-data`, set Application Manager env **`DATA_DIR=/root/socialhub-oman-data`** (or another persistent volume), restart once, and repeat steps 2–5.

### Complaint email

Complaints are sent by **email only** (not WhatsApp). The destination address is stored in the database (default `global2stor2@gmail.com`) and can be changed from the admin panel.

- **Static hosting (GitHub Pages):** FormSubmit classic multipart POST fallback
- **Node API + SMTP:** screenshot embedded + attached

Optional env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `COMPLAINT_EMAIL` / `VITE_COMPLAINT_EMAIL`

See `Tech. Document` for full product requirements.

## Deployment (GitHub Pages) — free account OK

You **do not need a paid GitHub plan** for a **public** repository. GitHub Pages is included on free accounts. This repo is public.

Pushes to **`main`** run [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml), which builds the client, writes `index.html` at the **repository root** (so Pages on `main` / `(root)` works), and also publishes **`client/dist`** to **`gh-pages`**.

### One-time setup (iPhone, iPad, or computer)

1. Open **https://github.com/Yunusbashashaik/Social_Hub-Oman/settings/pages**
2. Under **Build and deployment** → **Source**, choose **Deploy from a branch**
3. **Branch:** `main` or `gh-pages` · **Folder:** `/ (root)` · **Save**
4. Wait 1–2 minutes, then open on your iPad:

   **https://yunusbashashaik.github.io/Social_Hub-Oman/**

If the workflow has not run yet, go to **Actions** → **Deploy to GitHub Pages** → **Run workflow**.

The homepage has **no bundled catalog**. If the API is unavailable it stays empty until Admin adds services on the Node server (`npm start` on a host such as Render or GoDaddy Node). Live Admin data is stored in `/root/socialhub-oman-data` when the app runs from `/root`.
