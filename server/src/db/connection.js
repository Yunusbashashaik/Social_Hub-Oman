import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JsonDatabase } from "./jsonDb.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Git checkout root (folder that contains `server/` and `app.js`). */
export const APP_ROOT = path.join(__dirname, "..", "..", "..");

const LEGACY_DATA_DIR = path.join(APP_ROOT, "server", "data");
const DURABLE_DATA_DIR = path.join(APP_ROOT, "..", "socialhub-oman-data");

function canWriteDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function copyIfMissing(fromPath, toPath) {
  if (!fs.existsSync(fromPath) || fs.existsSync(toPath)) return;
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.copyFileSync(fromPath, toPath);
}

function migrateLegacyData(legacyDir, durableDir) {
  const files = [
    "globalstore.db",
    "globalstore.db-wal",
    "globalstore.db-shm",
    "globalstore.json",
    "admin-state.json",
    "complaints.jsonl",
  ];
  for (const name of files) {
    copyIfMissing(path.join(legacyDir, name), path.join(durableDir, name));
  }
  const fromUploads = path.join(legacyDir, "uploads");
  const toUploads = path.join(durableDir, "uploads");
  if (fs.existsSync(fromUploads) && !fs.existsSync(toUploads)) {
    fs.cpSync(fromUploads, toUploads, { recursive: true });
  }
}

export function resolveDataDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (canWriteDir(DURABLE_DATA_DIR)) {
    migrateLegacyData(LEGACY_DATA_DIR, DURABLE_DATA_DIR);
    return DURABLE_DATA_DIR;
  }
  return LEGACY_DATA_DIR;
}

export let DATA_DIR = resolveDataDir();
export let UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export let SERVICE_UPLOADS_DIR = path.join(UPLOADS_DIR, "services");

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

function bindDataDir(dir) {
  DATA_DIR = dir;
  UPLOADS_DIR = path.join(DATA_DIR, "uploads");
  SERVICE_UPLOADS_DIR = path.join(UPLOADS_DIR, "services");
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
}

export function initDatabase(dbPath = getDbPath(), options = {}) {
  bindDataDir(path.dirname(path.resolve(dbPath)));

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
      db = openSqlite(dbPath);
      dbEngine = "sqlite";
      activeDbPath = dbPath;
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
  bindDataDir(path.dirname(path.resolve(jsonPath)));
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
