import fs from "fs";
import path from "path";
import {
  flushActiveStore,
  getActiveStorePath,
  getCatalogSearchDirs,
  getDataDir,
  getReplicaDataDirs,
  isInsideAppTree,
  APP_ROOT,
  LEGACY_APP_DATA_DIR,
} from "./connection.js";
import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import { DEFAULT_SETTINGS } from "../config/defaults.js";

const SNAPSHOT_NAME = "admin-state.json";
/** Snapshot format version. Never used to wipe or replace a live catalog. */
export const CATALOG_GENERATION = 4;

let lastPersistResult = {
  wrote: 0,
  skippedCustom: [],
  attempted: [],
  savedAt: null,
  factoryPersistBlocked: false,
};

let source = null;
let persistDisabled = 0;

export function getLastPersistResult() {
  return lastPersistResult;
}

export function bindPersist(nextSource) {
  source = nextSource;
}

export function withoutPersist(fn) {
  persistDisabled += 1;
  try {
    return fn();
  } finally {
    persistDisabled -= 1;
  }
}

function snapshotPathFor(dir) {
  return path.join(path.resolve(dir), SNAPSHOT_NAME);
}

export function getSnapshotWritePaths() {
  const dirs = new Set();
  const storePath = getActiveStorePath();
  if (storePath) dirs.add(path.dirname(path.resolve(storePath)));
  for (const dir of getReplicaDataDirs()) {
    if (isInsideAppTree(dir, APP_ROOT) && path.resolve(dir) === path.resolve(LEGACY_APP_DATA_DIR)) {
      continue;
    }
    dirs.add(dir);
  }
  dirs.add(path.resolve(getDataDir()));
  if (process.env.DATA_DIR) dirs.add(path.resolve(process.env.DATA_DIR));
  return [...dirs].map(snapshotPathFor);
}

export function getSnapshotPaths() {
  const paths = new Set(getSnapshotWritePaths());
  for (const dir of getCatalogSearchDirs()) {
    paths.add(snapshotPathFor(dir));
  }
  paths.add(snapshotPathFor(LEGACY_APP_DATA_DIR));
  return [...paths];
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  try {
    const dirFd = fs.openSync(path.dirname(filePath), "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    /* some hosts cannot fsync directories */
  }
}

function serializeServices() {
  if (!source?.listServices) return [];
  return source.listServices().map((service) => {
    const blob = source.getServiceImageBlob?.(service.id);
    const rest = { ...service };
    delete rest.imageSrc;
    return {
      ...rest,
      imageBase64:
        blob && blob.length ? Buffer.from(blob).toString("base64") : undefined,
    };
  });
}

export function writeAdminSnapshot(state, options = {}) {
  if (!state) return null;
  const payload = {
    version: 1,
    generation: CATALOG_GENERATION,
    savedAt: new Date().toISOString(),
    services: Array.isArray(state.services) ? state.services : [],
    settings: state.settings && typeof state.settings === "object" ? state.settings : {},
  };
  const incomingIsFactory = catalogMatchesDefaults(payload.services);
  const incomingIsEmpty = payload.services.length === 0;
  const incomingIsCustom = snapshotIsCustom(payload);
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  let wrote = 0;
  const skippedCustom = [];
  const attempted = getSnapshotWritePaths();
  for (const filePath of attempted) {
    const existing = readSnapshotFile(filePath);
    const clobberCustom =
      snapshotIsCustom(existing) &&
      (incomingIsFactory || incomingIsEmpty || !incomingIsCustom);
    if (clobberCustom && options.protectCustom !== false) {
      skippedCustom.push(filePath);
      console.error(
        "Refusing to overwrite custom admin snapshot with factory or empty catalog",
        filePath,
      );
      continue;
    }
    try {
      atomicWrite(filePath, body);
      wrote += 1;
    } catch (err) {
      console.error("Failed to write admin snapshot", filePath, err?.message || err);
    }
  }
  lastPersistResult = {
    wrote,
    skippedCustom,
    attempted,
    savedAt: payload.savedAt,
    factoryPersistBlocked: incomingIsFactory && skippedCustom.length > 0,
  };
  if (!wrote) {
    if (skippedCustom.length) {
      console.error("Admin snapshot was not written; custom replicas were preserved");
      return { ...payload, skippedCustom, wrote: 0 };
    }
    console.error("Admin snapshot was not written to any durable path");
    return null;
  }
  return { ...payload, skippedCustom, wrote };
}

export function persistAdminState(options = {}) {
  if (persistDisabled || !source) return null;
  try {
    flushActiveStore();
    return writeAdminSnapshot(
      {
        services: serializeServices(),
        settings: {
          ...source.getAllSettings(),
          catalogSeeded: source.getSetting?.("catalogSeeded") === true,
        },
      },
      options,
    );
  } catch (err) {
    console.error("Failed to persist admin state", err?.message || err);
    return null;
  }
}

function readSnapshotFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return { ...parsed, sourcePath: filePath };
  } catch {
    return null;
  }
}

export function snapshotIsCustom(snapshot) {
  const services = snapshot?.services;
  if (!Array.isArray(services) || services.length === 0) return false;
  return !catalogMatchesDefaults(services);
}

export function snapshotMarksInitialized(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (snapshot.settings && snapshot.settings.catalogSeeded === true) return true;
  if (Array.isArray(snapshot.services) && snapshot.services.length > 0) return true;
  return snapshotIsCustom(snapshot);
}

export function hasAnyAdminSnapshot() {
  return listAdminSnapshots().length > 0;
}

export function catalogInitializedOnReplicas() {
  return listAdminSnapshots().some(snapshotMarksInitialized);
}

function snapshotRank(snapshot) {
  return {
    custom: snapshotIsCustom(snapshot) ? 1 : 0,
    savedAt: Date.parse(snapshot?.savedAt || 0) || 0,
    services: Array.isArray(snapshot?.services) ? snapshot.services.length : 0,
  };
}

export function compareSnapshots(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ra = snapshotRank(a);
  const rb = snapshotRank(b);
  if (ra.custom !== rb.custom) return ra.custom > rb.custom ? a : b;
  if (ra.savedAt !== rb.savedAt) return ra.savedAt > rb.savedAt ? a : b;
  if (ra.services !== rb.services) return ra.services > rb.services ? a : b;
  return a;
}

export function listAdminSnapshots() {
  const found = [];
  const seen = new Set();
  for (const filePath of getSnapshotPaths()) {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const parsed = readSnapshotFile(resolved);
    if (parsed) found.push(parsed);
  }
  return found;
}

export function readAdminSnapshot() {
  let best = null;
  for (const snapshot of listAdminSnapshots()) {
    best = compareSnapshots(best, snapshot);
  }
  return best;
}

export function readBestCustomSnapshot() {
  return listAdminSnapshots().filter(snapshotIsCustom).reduce(compareSnapshots, null);
}

function settingsSignature(settings) {
  const value = settings || {};
  return JSON.stringify({
    complaintEmail: value.complaintEmail,
    whatsappNumbers: value.whatsappNumbers,
    aboutEn: value.aboutEn,
    aboutAr: value.aboutAr,
    ownersEn: value.ownersEn,
    ownersAr: value.ownersAr,
    socialLinks: value.socialLinks,
  });
}

export function settingsMatchDefaults(settings) {
  return settingsSignature(settings) === settingsSignature(DEFAULT_SETTINGS);
}

function serviceSignature(service) {
  const month = Number(service.prices?.month);
  const year = Number(service.prices?.year);
  const outOfStock =
    service.outOfStock ||
    (Number.isFinite(month) && month === 0) ||
    (Number.isFinite(year) && year === 0)
      ? 1
      : 0;
  return [
    service.id,
    outOfStock ? 0 : month,
    outOfStock ? 0 : year,
    String(service.nameEn || ""),
    String(service.nameAr || ""),
    String(service.descriptionEn || ""),
    String(service.descriptionAr || ""),
    outOfStock,
    String(service.offerType || "none"),
    String(service.offerExpiresAt || ""),
  ].join("|");
}

function catalogSignature(services) {
  return (services || [])
    .map(serviceSignature)
    .sort()
    .join("\n");
}

export function catalogMatchesDefaults(services) {
  return catalogSignature(services) === catalogSignature(DEFAULT_SERVICES);
}

export function hydratePersistedAdminState() {
  if (!source) {
    return { restored: false, reason: "unbound", hadCustomSnapshot: false };
  }
  const snapshot = readAdminSnapshot();
  const customSnapshot = readBestCustomSnapshot();
  const hadCustomSnapshot = Boolean(customSnapshot);
  if (!snapshot) {
    return {
      restored: false,
      reason: "no-snapshot",
      hadCustomSnapshot: false,
      sourcePath: null,
    };
  }

  const chosen = customSnapshot || snapshot;
  const currentSettings = source.getAllSettings();
  const snapSettings =
    chosen.settings && typeof chosen.settings === "object" ? chosen.settings : null;
  const snapServices = Array.isArray(chosen.services) ? chosen.services : [];

  let restoredServices = false;
  let restoredSettings = false;
  let reason = "snapshot-not-applied";

  withoutPersist(() => {
    const currentServices = source.listServices();
    const emptyCatalog = currentServices.length === 0;
    const currentIsDefault = catalogMatchesDefaults(currentServices);
    const snapshotDiffers =
      catalogSignature(currentServices) !== catalogSignature(snapServices);
    const chosenIsCustom = snapshotIsCustom(chosen);

    if (
      snapServices.length > 0 &&
      snapshotDiffers &&
      (emptyCatalog || (currentIsDefault && chosenIsCustom))
    ) {
      source.replaceAllServices(snapServices);
      restoredServices = true;
    }

    if (snapSettings) {
      const emptySettings = source.countSettings() === 0;
      const currentIsDefaultSettings = settingsMatchDefaults(currentSettings);
      const snapshotDiffersSettings =
        settingsSignature(currentSettings) !== settingsSignature(snapSettings);
      const catalogIsEmptyOrFactory = emptyCatalog || currentIsDefault;
      if (
        snapshotDiffersSettings &&
        (emptySettings || (currentIsDefaultSettings && catalogIsEmptyOrFactory))
      ) {
        source.replaceAllSettings(snapSettings);
        restoredSettings = true;
      }
    }
  });

  if (restoredServices || restoredSettings) {
    reason = "restored";
    console.log(
      `Restored admin data from snapshot (services=${restoredServices}, settings=${restoredSettings}, path=${chosen.sourcePath || "unknown"}).`,
    );
    persistAdminState();
  } else if (!hadCustomSnapshot) {
    reason = catalogMatchesDefaults(snapServices) ? "factory-snapshot" : "snapshot-not-applied";
  } else {
    reason = "live-catalog-kept";
  }

  return {
    restored: restoredServices || restoredSettings,
    restoredServices,
    restoredSettings,
    savedAt: chosen.savedAt || null,
    sourcePath: chosen.sourcePath || null,
    reason,
    hadCustomSnapshot,
    snapshotIsFactoryDefault: catalogMatchesDefaults(snapServices),
  };
}

export function inspectReplicaDir(dir) {
  const resolved = path.resolve(dir);
  const snapshotPath = snapshotPathFor(resolved);
  const snapshot = readSnapshotFile(snapshotPath);
  return {
    dir: resolved,
    hasDb: fs.existsSync(path.join(resolved, "globalstore.db")),
    hasJson: fs.existsSync(path.join(resolved, "globalstore.json")),
    hasSnapshot: Boolean(snapshot),
    snapshotPath,
    snapshotSavedAt: snapshot?.savedAt || null,
    snapshotServices: Array.isArray(snapshot?.services) ? snapshot.services.length : 0,
    snapshotCustom: snapshotIsCustom(snapshot),
    snapshotInitialized: snapshotMarksInitialized(snapshot),
    snapshotIsFactoryDefault: snapshot
      ? catalogMatchesDefaults(snapshot.services)
      : null,
  };
}

export function getReplicaInventory() {
  return getReplicaDataDirs().map(inspectReplicaDir);
}

export function getPersistStatus() {
  const snapshot = readAdminSnapshot();
  const custom = readBestCustomSnapshot();
  const chosen = custom || snapshot;
  return {
    snapshotSavedAt: chosen?.savedAt || null,
    snapshotServices: Array.isArray(chosen?.services) ? chosen.services.length : 0,
    snapshotPaths: getSnapshotPaths(),
    snapshotWritePaths: getSnapshotWritePaths(),
    snapshotSourcePath: chosen?.sourcePath || null,
    snapshotIsFactoryDefault: chosen ? catalogMatchesDefaults(chosen.services) : null,
    hadCustomSnapshot: Boolean(custom),
    replicas: getReplicaInventory(),
    lastPersist: lastPersistResult,
  };
}
