import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isFactorySeedAllowed } from "../config/factorySeed.js";

const DEFAULT_OWNER = "Yunusbashashaik";
const DEFAULT_REPO = "Social_Hub-Oman";
const DEFAULT_PATH = "catalog-backup/admin-state.json";
const DEFAULT_BACKUP_PATH = "catalog-backup/admin-state.backup.json";
const DEFAULT_BRANCH = "main";
const DEFAULT_API = "https://api.github.com";
const USER_AGENT = "socialhub-oman-catalog-backup";
const MODULE_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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

export function defaultRawBackupUrl(
  owner = DEFAULT_OWNER,
  repo = DEFAULT_REPO,
  branch = DEFAULT_BRANCH,
  pathName = DEFAULT_PATH,
) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathName}`;
}

function isTestProcess() {
  if (process.env.NODE_ENV === "test") return true;
  return process.argv.some((arg) => /(^|[\\/])test[\\/]|\.test\.js$/.test(String(arg)));
}

function repoRootCandidates() {
  const roots = [MODULE_REPO_ROOT, process.cwd()];
  try {
    roots.push(path.resolve(process.cwd(), ".."));
  } catch {
    /* ignore */
  }
  const unique = [];
  const seen = new Set();
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

function listPackagedBackupPaths(filePath = DEFAULT_PATH) {
  if (process.env.CATALOG_BACKUP_SKIP_PACKAGED === "1") return [];
  if (isTestProcess() && process.env.CATALOG_BACKUP_USE_PACKAGED !== "1") return [];
  const relative = [filePath, DEFAULT_BACKUP_PATH, DEFAULT_PATH].filter(Boolean);
  const paths = [];
  const seen = new Set();
  for (const root of repoRootCandidates()) {
    for (const name of relative) {
      const full = path.join(root, name);
      if (seen.has(full)) continue;
      seen.add(full);
      paths.push(full);
    }
  }
  return paths;
}

function packagedAvailable() {
  return listPackagedBackupPaths().some((file) => {
    try {
      return fs.existsSync(file);
    } catch {
      return false;
    }
  });
}

export function getOffHostBackupConfig() {
  const token =
    process.env.CATALOG_BACKUP_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    "";
  const repoSpec =
    process.env.CATALOG_BACKUP_REPO || process.env.GITHUB_REPOSITORY || "";
  let owner = process.env.CATALOG_BACKUP_OWNER || DEFAULT_OWNER;
  let repo = DEFAULT_REPO;
  if (repoSpec.includes("/")) {
    const [parsedOwner, parsedRepo] = repoSpec.split("/");
    if (parsedOwner) owner = parsedOwner;
    if (parsedRepo) repo = parsedRepo;
  } else if (repoSpec) {
    repo = repoSpec;
  }
  const filePath = process.env.CATALOG_BACKUP_PATH || DEFAULT_PATH;
  const branch = process.env.CATALOG_BACKUP_BRANCH || DEFAULT_BRANCH;
  const urlEnv = process.env.CATALOG_BACKUP_URL || "";
  const disabled = process.env.CATALOG_BACKUP_DISABLE === "1";
  const defaultUrl = defaultRawBackupUrl(owner, repo, branch, filePath);
  const url = urlEnv || (disabled ? "" : defaultUrl);
  const usingDefaultRaw = Boolean(!urlEnv && url);
  const apiBase = String(process.env.CATALOG_BACKUP_API_URL || DEFAULT_API).replace(
    /\/$/,
    "",
  );
  const packaged = !disabled && packagedAvailable();
  const rawReadEnabled =
    Boolean(url) &&
    !disabled &&
    (!isTestProcess() || Boolean(urlEnv) || process.env.CATALOG_BACKUP_ALLOW_NETWORK === "1");
  const canPush = Boolean(
    token &&
      repo &&
      (!isTestProcess() ||
        Boolean(process.env.CATALOG_BACKUP_API_URL) ||
        process.env.CATALOG_BACKUP_ALLOW_NETWORK === "1"),
  );
  const canPull = Boolean(!disabled && (rawReadEnabled || canPush || packaged));
  return {
    token,
    owner,
    repo,
    path: filePath,
    branch,
    url,
    urlEnv,
    defaultUrl,
    usingDefaultRaw,
    apiBase,
    configured: Boolean(!disabled && (url || canPush || packaged)),
    canPush,
    canPull,
    rawReadEnabled,
    packagedAvailable: packaged,
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

function readPackagedSnapshot() {
  for (const filePath of listPackagedBackupPaths()) {
    try {
      const snapshot = parseSnapshot(
        JSON.parse(fs.readFileSync(filePath, "utf8")),
        filePath,
      );
      if (snapshot?.services?.length) return snapshot;
    } catch {
      /* missing or unreadable */
    }
  }
  return null;
}

function markPulled(snapshot, source) {
  lastStatus.pulled = true;
  lastStatus.source = source;
  lastStatus.savedAt = snapshot.savedAt || null;
  lastStatus.error = null;
  lastStatus.skipped = null;
  return snapshot;
}

export async function pullOffHostBackup() {
  const cfg = getOffHostBackupConfig();
  lastStatus.configured = cfg.configured;
  if (!cfg.canPull) {
    lastStatus.skipped = "not-configured";
    return null;
  }
  try {
    if (cfg.canPush) {
      const { snapshot, sha } = await pullFromGitHub(cfg);
      lastStatus.sha = sha;
      if (snapshot?.services?.length) {
        return markPulled(snapshot, contentsApiUrl(cfg));
      }
    }
    if (cfg.urlEnv && cfg.rawReadEnabled) {
      const fromUrl = await pullFromUrl(cfg.urlEnv);
      if (fromUrl?.services?.length) {
        return markPulled(fromUrl, cfg.urlEnv);
      }
    }
    const packaged = readPackagedSnapshot();
    if (packaged?.services?.length) {
      return markPulled(packaged, packaged.sourcePath || "packaged");
    }
    if (cfg.rawReadEnabled && cfg.url) {
      const fromUrl = await pullFromUrl(cfg.url);
      if (fromUrl?.services?.length) {
        const source = cfg.usingDefaultRaw ? "github-raw" : cfg.url;
        return markPulled({ ...fromUrl, sourcePath: source }, source);
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
