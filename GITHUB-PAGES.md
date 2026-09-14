# GitHub Pages setup (free account)

## Your store URL

### **https://yunusbashashaik.github.io/Social_Hub-Oman/**

---

## How deploy works

Pushing to `main` builds the client and publishes it three ways:

1. **`index.html` at the root of `main`** — this matches Pages set to **Deploy from a branch → `main` → `/ (root)`**
2. The **`gh-pages`** branch (folder `/ (root)`)
3. **GitHub Actions** Pages (if that source is selected)

### Preferred Pages setting

1. Open **https://github.com/Yunusbashashaik/Social_Hub-Oman/settings/pages**
2. **Source:** Deploy from a branch
3. **Branch:** `main` **or** `gh-pages` · **Folder:** `/ (root)`
4. Save, wait 1–2 minutes, hard-refresh:

   **https://yunusbashashaik.github.io/Social_Hub-Oman/**

Do **not** open `https://yunusbashashaik.github.io/` — that user site has no `index.html` and always 404s. The store is the project URL above (`/Social_Hub-Oman/`).

## If Actions shows “pages build and deployment” stuck / in progress

That workflow is GitHub’s **legacy branch deploy**. When it hangs or the site status is `errored` / stuck `building`, do this once:

1. Open **https://github.com/Yunusbashashaik/Social_Hub-Oman/settings/pages**
2. Under **Build and deployment** → **Source**, choose **GitHub Actions**
3. Save, then open **Actions** → **Deploy Pages (GitHub Actions)** → **Run workflow**
4. Wait 1–2 minutes, then hard-refresh the store URL above

### Fallback (keep branch deploy)

1. Same Pages settings page
2. **Source:** Deploy from a branch
3. **Branch:** `gh-pages` · **Folder:** `/ (root)`
4. Click **Save** again (even if already selected) — this clears an `errored` / stuck `building` state
5. Cancel any hung **Deploy static content to Pages** / **Deploy Pages (GitHub Actions)** runs in the Actions tab
6. Wait for the new `pages-build-deployment` run to finish (often 2–8 minutes), or re-run **Deploy to GitHub Pages**

---

## Wrong URLs

| URL | Result |
|-----|--------|
| `yunusbashashaik.github.io` | Not your store |
| `yunusbashashaik.github.io/Social_Hub-Oman/` | **Correct homepage** |
