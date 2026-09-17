import { isFactorySeedAllowed } from "../config/factorySeed.js";

const DEFAULT_PATH = "catalog-backup/admin-state.json";
const DEFAULT_BRANCH = "main";
const DEFAULT_API = "https://api.github.com";
const USER_AGENT = "socialhub-oman-catalog-backup";

let lastStatus = {
  configured: false,
  pushed: false,
  pulled: false,
  restored: false,
  savedAt: null,
  source: null,
  error: null,
  skipped: null,
  sha: null,
};

let inFlightPush = Promise.resolve(null);

export function getOffHostBackupStatus() {
  return { ...lastStatus, configured: getOffHostBackupConfig().configured };
}

export function resetOffHostBackupStatus() {
  lastStatus = {
    configured: getOffHostBackupConfig().configured,
    pushed: false,
    pulled: false,
    restored: false,
    savedAt: null,
    source: null,
    error: null,
    skipped: null,
    sha: null,
  };
}

export function getOffHostBackupConfig() {
  const token =
    process.env.CATALOG_BACKUP_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    "";
  const repo = process.env.CATALOG_BACKUP_REPO || "";
  const filePath = process.env.CATALOG_BACKUP_PATH || DEFAULT_PATH;
  const branch = process.env.CATALOG_BACKUP_BRANCH || DEFAULT_BRANCH;
  const url = process.env.CATALOG_BACKUP_URL || "";
  const apiBase = String(process.env.CATALOG_BACKUP_API_URL || DEFAULT_API).replace(
    /\/$/,
    "",
  );
  return {
    token,
    repo,
    path: filePath,
    branch,
    url,
    apiBase,
    configured: Boolean(url || (token && repo)),
    canPush: Boolean(token && repo),
    canPull: Boolean(url || (token && repo)),
  };
}

function githubHeaders(token, accept) {
  const headers = {
    Accept: accept,
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function contentsApiUrl(cfg) {
  const encodedPath = cfg.path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${cfg.apiBase}/repos/${cfg.repo}/contents/${encodedPath}?ref=${encodeURIComponent(cfg.branch)}`;
}

function parseSnapshot(value, sourcePath) {
  if (!value || typeof value !== "object") return null;
  if (!Array.isArray(value.services)) return null;
  return { ...value, sourcePath: sourcePath || value.sourcePath || null };
}

async function fetchJson(url, options = {}, timeoutMs = 12_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ac.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function pullFromUrl(url) {
  const res = await fetchJson(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  if (!res.ok) return null;
  const text = await res.text();
  try {
    return parseSnapshot(JSON.parse(text), url);
  } catch {
    return null;
  }
}

async function pullFromGitHub(cfg) {
  if (!cfg.token || !cfg.repo) return { snapshot: null, sha: null };
  const url = contentsApiUrl(cfg);
  const metaRes = await fetchJson(
    url,
    { headers: githubHeaders(cfg.token, "application/vnd.github+json") },
  );
  if (metaRes.status === 404) return { snapshot: null, sha: null };
  if (!metaRes.ok) {
    throw new Error(`GitHub backup GET failed (${metaRes.status})`);
  }
  const meta = await metaRes.json();
  const sha = meta?.sha || null;
  if (meta?.encoding === "base64" && typeof meta.content === "string") {
    const decoded = Buffer.from(meta.content.replace(/\n/g, ""), "base64").toString(
      "utf8",
    );
    return { snapshot: parseSnapshot(JSON.parse(decoded), url), sha };
  }
  const rawRes = await fetchJson(
    url,
    { headers: githubHeaders(cfg.token, "application/vnd.github.raw+json") },
  );
  if (!rawRes.ok) return { snapshot: null, sha };
  const text = await rawRes.text();
  return { snapshot: parseSnapshot(JSON.parse(text), url), sha };
}

export async function pullOffHostBackup() {
  const cfg = getOffHostBackupConfig();
  lastStatus.configured = cfg.configured;
  if (!cfg.canPull) {
    lastStatus.skipped = "not-configured";
    return null;
  }
  try {
    if (cfg.url) {
      const fromUrl = await pullFromUrl(cfg.url);
      if (fromUrl) {
        lastStatus.pulled = true;
        lastStatus.source = cfg.url;
        lastStatus.savedAt = fromUrl.savedAt || null;
        lastStatus.error = null;
        return fromUrl;
      }
    }
    if (cfg.canPush) {
      const { snapshot, sha } = await pullFromGitHub(cfg);
      lastStatus.sha = sha;
      if (snapshot) {
        lastStatus.pulled = true;
        lastStatus.source = contentsApiUrl(cfg);
        lastStatus.savedAt = snapshot.savedAt || null;
        lastStatus.error = null;
        return snapshot;
      }
    }
    lastStatus.skipped = "not-found";
    return null;
  } catch (err) {
    lastStatus.error = err?.message || String(err);
    console.error("Off-host catalog backup pull failed", lastStatus.error);
    return null;
  }
}

function slimIfHuge(payload) {
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded) <= 40 * 1024 * 1024) return payload;
  return {
    ...payload,
    services: (payload.services || []).map((row) => {
      const copy = { ...row };
      delete copy.imageBase64;
      return copy;
    }),
  };
}

async function pushToGitHub(cfg, payload) {
  const url = contentsApiUrl(cfg);
  let sha = lastStatus.sha;
  if (!sha) {
    try {
      const existing = await pullFromGitHub(cfg);
      sha = existing.sha;
      if (
        existing.snapshot &&
        Array.isArray(existing.snapshot.services) &&
        existing.snapshot.services.length > 0
      ) {
        lastStatus.savedAt = existing.snapshot.savedAt || lastStatus.savedAt;
      }
    } catch {
      sha = null;
    }
  }
  const body = {
    message: `chore(catalog): persist admin-state ${payload.savedAt || ""}`.trim(),
    content: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8").toString(
      "base64",
    ),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetchJson(
    url,
    {
      method: "PUT",
      headers: {
        ...githubHeaders(cfg.token, "application/vnd.github+json"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    20_000,
  );
  if (res.status === 409 || res.status === 422) {
    const retry = await pullFromGitHub(cfg);
    if (retry.sha) {
      body.sha = retry.sha;
      const again = await fetchJson(
        url,
        {
          method: "PUT",
          headers: {
            ...githubHeaders(cfg.token, "application/vnd.github+json"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        20_000,
      );
      if (!again.ok) {
        throw new Error(`GitHub backup PUT retry failed (${again.status})`);
      }
      const againJson = await again.json();
      lastStatus.sha = againJson?.content?.sha || retry.sha;
      return;
    }
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub backup PUT failed (${res.status}) ${detail}`.trim());
  }
  const json = await res.json();
  lastStatus.sha = json?.content?.sha || sha;
}

/**
 * Push live admin-state.json off-host. Never overwrites a custom remote
 * backup with factory or empty catalog.
 */
export async function pushOffHostBackup(payload, flags = {}) {
  const cfg = getOffHostBackupConfig();
  lastStatus.configured = cfg.configured;
  if (!cfg.canPush) {
    lastStatus.skipped = cfg.configured ? "url-only" : "not-configured";
    return { pushed: false, skipped: lastStatus.skipped };
  }
  const incomingIsFactory = Boolean(flags.incomingIsFactory);
  const incomingIsEmpty = Boolean(flags.incomingIsEmpty);
  const incomingIsCustom = Boolean(flags.incomingIsCustom);
  if ((incomingIsFactory && !isFactorySeedAllowed()) || incomingIsEmpty) {
    try {
      const remote = await pullFromGitHub(cfg);
      const remoteServices = remote.snapshot?.services;
      const remoteHasCatalog =
        Array.isArray(remoteServices) && remoteServices.length > 0;
      if (remoteHasCatalog && !incomingIsCustom) {
        lastStatus.skipped = "protect-remote-custom";
        lastStatus.savedAt = remote.snapshot.savedAt || lastStatus.savedAt;
        lastStatus.sha = remote.sha;
        return { pushed: false, skipped: lastStatus.skipped };
      }
      if (incomingIsFactory && !isFactorySeedAllowed()) {
        lastStatus.skipped = "factory-blocked";
        return { pushed: false, skipped: lastStatus.skipped };
      }
    } catch (err) {
      if (incomingIsFactory && !isFactorySeedAllowed()) {
        lastStatus.skipped = "factory-blocked";
        lastStatus.error = err?.message || String(err);
        return { pushed: false, skipped: lastStatus.skipped };
      }
    }
  }

  try {
    await pushToGitHub(cfg, slimIfHuge(payload));
    lastStatus.pushed = true;
    lastStatus.savedAt = payload.savedAt || lastStatus.savedAt;
    lastStatus.source = contentsApiUrl(cfg);
    lastStatus.error = null;
    lastStatus.skipped = null;
    return { pushed: true };
  } catch (err) {
    lastStatus.error = err?.message || String(err);
    lastStatus.pushed = false;
    console.error("Off-host catalog backup push failed", lastStatus.error);
    return { pushed: false, error: lastStatus.error };
  }
}

export function scheduleOffHostBackup(payload, flags = {}) {
  inFlightPush = inFlightPush
    .then(() => pushOffHostBackup(payload, flags))
    .catch((err) => {
      lastStatus.error = err?.message || String(err);
      return { pushed: false, error: lastStatus.error };
    });
  return inFlightPush;
}

export function flushOffHostBackup() {
  return inFlightPush;
}

export function markOffHostRestored(snapshot) {
  lastStatus.restored = true;
  lastStatus.pulled = true;
  lastStatus.savedAt = snapshot?.savedAt || lastStatus.savedAt;
  lastStatus.source = snapshot?.sourcePath || lastStatus.source;
}
