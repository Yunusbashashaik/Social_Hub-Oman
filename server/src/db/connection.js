import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { JsonDatabase } from "./jsonDb.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Git checkout root (folder that contains `server/` and `app.js`). */
export const APP_ROOT = path.join(__dirname, "..", "..", "..");

/** In-app folder used by older deploys. Wiped by GoDaddy Restart Published App. */
export const LEGACY_APP_DATA_DIR = path.join(__dirname, "..", "..", "data");
export const DEFAULT_DURABLE_DIRNAME = "socialhub-oman-data";
export const ROOT_HOST_DATA_DIR = `/root/${DEFAULT_DURABLE_DIRNAME}`;

export let DATA_DIR = LEGACY_APP_DATA_DIR;
export let UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export let SERVICE_UPLOADS_DIR = path.join(UPLOADS_DIR, "services");

const STORE_NAMES = [
  "globalstore.db",
  "globalstore.json",
  "admin-state.json",
  "globalstore.db-wal",
];

const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      icon TEXT NOT NULL DEFAULT '',
      accent TEXT NOT NULL DEFAULT '#38bdf8',
      type_en TEXT NOT NULL DEFAULT 'Shared / Private',
      type_ar TEXT NOT NULL DEFAULT 'مشترك / خاص',
      name_en TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      description_en TEXT NOT NULL DEFAULT '',
      description_ar TEXT NOT NULL DEFAULT '',
      price_month REAL NOT NULL DEFAULT 0,
      price_year REAL NOT NULL DEFAULT 0,
      image_url TEXT,
      image_blob BLOB,
      out_of_stock INTEGER NOT NULL DEFAULT 0,
      offer_type TEXT NOT NULL DEFAULT 'none',
      offer_expires_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      subject TEXT NOT NULL,
      details TEXT NOT NULL,
      screenshot_path TEXT,
      original_filename TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`;

let db;
let activeDbPath;
let dbEngine = "none";
let lastMigration = { migrated: false, reason: "not-run" };

export function getDataDir() {
  return DATA_DIR;
}

export function getUploadsDir() {
  return UPLOADS_DIR;
}

export function getServiceUploadsDir() {
  return SERVICE_UPLOADS_DIR;
}

export function getLastMigration() {
  return lastMigration;
}

export function isInsideAppTree(dir, appRoot = APP_ROOT) {
  const resolved = path.resolve(dir);
  const root = path.resolve(appRoot);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

/**
 * Preferred durable directory. Never uses a folder inside `/app` when that is
 * the Published App tree — Restart Published App wipes `/app`.
 */
export function defaultDurableDataDir(
  appRoot = APP_ROOT,
  homeDir = os.homedir(),
) {
  const parent = path.resolve(appRoot, "..");
  const fsRoot = path.parse(path.resolve(appRoot)).root;
  if (parent !== fsRoot && parent !== path.sep) {
    return path.join(parent, DEFAULT_DURABLE_DIRNAME);
  }
  const homeCandidate = path.join(path.resolve(homeDir), DEFAULT_DURABLE_DIRNAME);
  if (!isInsideAppTree(homeCandidate, appRoot)) {
    return homeCandidate;
  }
  return ROOT_HOST_DATA_DIR;
}

export function durableDataDirCandidates(appRoot = APP_ROOT, homeDir = os.homedir()) {
  const parent = path.resolve(appRoot, "..");
  const fsRoot = path.parse(path.resolve(appRoot)).root;
  const list = [
    ROOT_HOST_DATA_DIR,
    path.join(path.resolve(homeDir), DEFAULT_DURABLE_DIRNAME),
    "/var/lib/socialhub-oman-data",
    "/opt/socialhub-oman-data",
    "/data/socialhub-oman-data",
    "/mnt/socialhub-oman-data",
  ];
  if (parent !== fsRoot && parent !== path.sep) {
    list.unshift(path.join(parent, DEFAULT_DURABLE_DIRNAME));
  }
  const unique = [];
  const seen = new Set();
  for (const item of list) {
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    if (isInsideAppTree(resolved, appRoot)) continue;
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

function canWriteDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function storeArtifactsPresent(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return STORE_NAMES.some((name) => fs.existsSync(path.join(dir, name)));
}

export function migrateLegacyDataIfNeeded(
  targetDir,
  legacyDir = LEGACY_APP_DATA_DIR,
) {
  const target = path.resolve(targetDir);
  const legacy = path.resolve(legacyDir);
  if (target === legacy) {
    lastMigration = { migrated: false, reason: "same-dir" };
    return lastMigration;
  }
  if (!storeArtifactsPresent(legacy)) {
    lastMigration = { migrated: false, reason: "no-legacy" };
    return lastMigration;
  }
  if (storeArtifactsPresent(target)) {
    lastMigration = { migrated: false, reason: "target-has-store" };
    return lastMigration;
  }
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(legacy, target, { recursive: true });
  lastMigration = {
    migrated: true,
    reason: "copied-legacy",
    from: legacy,
    to: target,
  };
  console.log(`Migrated store data from ${legacy} to ${target}`);
  return lastMigration;
}

function legacyLocationsToMigrate(appRoot = APP_ROOT) {
  return [
    LEGACY_APP_DATA_DIR,
    path.join(path.resolve(appRoot), DEFAULT_DURABLE_DIRNAME),
  ];
}

export function resolveDataDir(options = {}) {
  if (options.dataDir) return path.resolve(options.dataDir);
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (options.dbPath) return path.dirname(path.resolve(options.dbPath));
  if (options.jsonPath) return path.dirname(path.resolve(options.jsonPath));
  if (process.env.DATABASE_PATH) {
    return path.dirname(path.resolve(process.env.DATABASE_PATH));
  }
  if (process.env.JSON_DATABASE_PATH) {
    return path.dirname(path.resolve(process.env.JSON_DATABASE_PATH));
  }
  for (const dir of durableDataDirCandidates()) {
    if (canWriteDir(dir)) return dir;
  }
  const preferred = defaultDurableDataDir();
  if (canWriteDir(preferred)) return preferred;
  return LEGACY_APP_DATA_DIR;
}

function applyDataDir(dir) {
  DATA_DIR = path.resolve(dir);
  UPLOADS_DIR = path.join(DATA_DIR, "uploads");
  SERVICE_UPLOADS_DIR = path.join(UPLOADS_DIR, "services");
  fs.mkdirSync(SERVICE_UPLOADS_DIR, { recursive: true });
}

export function getDbPath() {
  return process.env.DATABASE_PATH || path.join(DATA_DIR, "globalstore.db");
}

export function getDbEngine() {
  return dbEngine;
}

export function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

function openSqlite(dbPath) {
  const Database = require("better-sqlite3");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = FULL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(SCHEMA_SQL);
  migrateSqlite(sqlite);
  return sqlite;
}

function migrateSqlite(sqlite) {
  const cols = sqlite.prepare("PRAGMA table_info(services)").all().map((col) => col.name);
  if (!cols.includes("image_blob")) {
    sqlite.exec("ALTER TABLE services ADD COLUMN image_blob BLOB");
  }
  if (!cols.includes("offer_type")) {
    sqlite.exec("ALTER TABLE services ADD COLUMN offer_type TEXT NOT NULL DEFAULT 'none'");
  }
  if (!cols.includes("offer_expires_at")) {
    sqlite.exec("ALTER TABLE services ADD COLUMN offer_expires_at TEXT");
  }
}

export function flushActiveStore() {
  if (!db) return;
  if (dbEngine === "sqlite") {
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* ignore */
    }
  } else if (typeof db.save === "function") {
    db.save();
  }
}

export function initDatabase(dbPath, options = {}) {
  const resolvedDir = resolveDataDir({ ...options, dbPath });
  const explicitStore = Boolean(dbPath || options.jsonPath || options.dataDir);
  if (!explicitStore && !options.skipMigrate) {
    const legacyHint = options.legacyDataDir || LEGACY_APP_DATA_DIR;
    migrateLegacyDataIfNeeded(resolvedDir, legacyHint);
    if (!storeArtifactsPresent(resolvedDir)) {
      for (const extra of legacyLocationsToMigrate()) {
        if (path.resolve(extra) === path.resolve(legacyHint)) continue;
        migrateLegacyDataIfNeeded(resolvedDir, extra);
        if (storeArtifactsPresent(resolvedDir)) break;
      }
    }
  } else if (options.legacyDataDir && !options.skipMigrate) {
    migrateLegacyDataIfNeeded(resolvedDir, options.legacyDataDir);
  } else {
    lastMigration = {
      migrated: false,
      reason: explicitStore ? "explicit-store" : "skipped",
    };
  }
  applyDataDir(resolvedDir);

  const sqlitePath = dbPath || getDbPath();
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = undefined;
  }

  const engine = options.engine || process.env.DATABASE_ENGINE;
  const forceJson = engine === "json";
  if (!forceJson) {
    try {
      db = openSqlite(sqlitePath);
      dbEngine = "sqlite";
      activeDbPath = sqlitePath;
      return db;
    } catch (err) {
      console.error(
        "SQLite native module failed; using JSON file store instead.",
        err?.message || err,
      );
    }
  }

  const jsonPath =
    options.jsonPath ||
    process.env.JSON_DATABASE_PATH ||
    path.join(DATA_DIR, "globalstore.json");
  applyDataDir(path.dirname(path.resolve(jsonPath)));
  db = new JsonDatabase(jsonPath);
  dbEngine = "json";
  activeDbPath = jsonPath;
  return db;
}

export function getActiveStorePath() {
  return activeDbPath || getDbPath();
}

export function closeDatabase() {
  if (db) {
    try {
      flushActiveStore();
      db.close();
    } catch {
      /* ignore */
    }
    db = undefined;
  }
  activeDbPath = undefined;
  dbEngine = "none";
}

export { activeDbPath };
