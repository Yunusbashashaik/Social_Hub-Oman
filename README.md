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

Admin edits and public catalog/settings are stored **outside the GitHub file set**. Every admin persist also writes `admin-state.json` + `admin-state.backup.json` on every replica path **and** pushes the same snapshot off-host (GitHub Contents API). If the host volume is empty at boot, the API **auto-fetches** that backup and hydrates **before** any seed. Production **never** inserts factory catalog names unless `ALLOW_FACTORY_SEED=1` (local/dev only).

Optional env:

- `DATA_DIR` — durable folder for SQLite, `admin-state.json`, `admin-state.backup.json`, and uploads
- `DATABASE_PATH` — custom SQLite file path
- `ADMIN_USERNAME` (default: `admin`)
- `ADMIN_PASSWORD` (default: `Ss$135790`)
- `ADMIN_SESSION_SECRET` — signs admin session tokens
- **Off-host catalog backup (required on GoDaddy):**
  - `CATALOG_BACKUP_TOKEN` or `GITHUB_TOKEN` or `GH_TOKEN` — GitHub PAT with Contents read/write on this repo
  - `CATALOG_BACKUP_REPO` — `owner/repo` (defaults to `GITHUB_REPOSITORY` if set)
  - `CATALOG_BACKUP_PATH` — default `catalog-backup/admin-state.json`
  - `CATALOG_BACKUP_BRANCH` — default `main`
  - `CATALOG_BACKUP_URL` — optional HTTPS JSON URL used to **pull** a backup. When unset, the API reads `https://raw.githubusercontent.com/Yunusbashashaik/Social_Hub-Oman/main/catalog-backup/admin-state.json` (no token). Packaged `catalog-backup/` in the deploy tree is the offline fallback.
- `ALLOW_FACTORY_SEED=1` — **dev only**. Production must **not** set this. Without it the API never inserts factory catalog names.

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

Keep **`/root/socialhub-oman-data`** (or the `DATA_DIR` you set) so SQLite and uploads survive GitHub publishes. Empty boots restore from the committed `catalog-backup/` files and the public GitHub raw URL **without** a token and **without** `ALLOW_FACTORY_SEED`. `GET /api/health` must show `factorySeedDisabled: true`, `offHostBackupConfigured: true`, and `catalogSeededThisBoot: false` on a normal boot. `dataDirInsideApp` must be `false`.

### GoDaddy Application Manager env (socialhubomr.com)

Set these on the Node app (never `ALLOW_FACTORY_SEED`):

```
DATA_DIR=/root/socialhub-oman-data
CATALOG_BACKUP_TOKEN=<github PAT with Contents: Read and write>
CATALOG_BACKUP_REPO=Yunusbashashaik/Social_Hub-Oman
CATALOG_BACKUP_PATH=catalog-backup/admin-state.json
CATALOG_BACKUP_BRANCH=main
CATALOG_BACKUP_URL=https://raw.githubusercontent.com/Yunusbashashaik/Social_Hub-Oman/main/catalog-backup/admin-state.json
```

Create the PAT under GitHub → Settings → Developer settings → Fine-grained token (this repo, Contents read/write). After the first Admin save, `catalog-backup/admin-state.json` appears on `main`. Health should then show `offHostBackupSavedAt` and, after a host recycle, `offHostBackupRestoredThisBoot: true` with **custom** names (not factory).

### GoDaddy republish checklist (socialhubomr.com)

1. Publish **`main`** (this repo) in Application Manager — not an old branch.
2. Open `https://socialhubomr.com/api/health`. Confirm `ok: true`, `factorySeedDisabled` is `true`, `offHostBackupConfigured` is `true`, `dataDir` is **not** `/app/socialhub-oman-data`, and `dataDirInsideApp` is `false`.
3. In Admin, rename a service (for example YouTube / Canva) and save. Also use **Export catalog** to keep a local `admin-state.json`. Reload health: **`snapshotSavedAt`** and **`offHostBackupSavedAt`** must be newer.
4. Open `https://socialhubomr.com/api/services` — names/prices/offers must match the admin catalog, not factory defaults.
5. Admin → **Import catalog** can load a previously exported `admin-state.json` if you ever need a manual restore.

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
