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
import { isFactorySeedAllowed } from "../config/factorySeed.js";
import {
  getOffHostBackupStatus,
  markOffHostRestored,
  pullOffHostBackup,
  scheduleOffHostBackup,
} from "./offHostBackup.js";

export const SNAPSHOT_NAME = "admin-state.json";
export const SNAPSHOT_BACKUP_NAME = "admin-state.backup.json";
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

function snapshotFilesFor(dir) {
  const resolved = path.resolve(dir);
  return [
    path.join(resolved, SNAPSHOT_NAME),
    path.join(resolved, SNAPSHOT_BACKUP_NAME),
  ];
}

function snapshotPathFor(dir) {
  return path.join(path.resolve(dir), SNAPSHOT_NAME);
}

export function getSnapshotWriteDirs() {
  const dirs = new Set();
  const storePath = getActiveStorePath();
  if (storePath) dirs.add(path.dirname(path.resolve(storePath)));
  for (const dir of getReplicaDataDirs()) {
    if (isInsideAppTree(dir, APP_ROOT) && path.resolve(dir) === path.resolve(LEGACY_APP_DATA_DIR)) {
      continue;
    }
    dirs.add(path.resolve(dir));
  }
  dirs.add(path.resolve(getDataDir()));
  if (process.env.DATA_DIR) dirs.add(path.resolve(process.env.DATA_DIR));
  return [...dirs];
}

export function getSnapshotWritePaths() {
  return getSnapshotWriteDirs().flatMap(snapshotFilesFor);
}

export function getSnapshotPaths() {
  const dirs = new Set(getSnapshotWriteDirs());
  for (const dir of getCatalogSearchDirs()) {
    dirs.add(path.resolve(dir));
  }
  dirs.add(path.resolve(LEGACY_APP_DATA_DIR));
  return [...dirs].flatMap(snapshotFilesFor);
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

function bestExistingInDir(dir) {
  let best = null;
  for (const filePath of snapshotFilesFor(dir)) {
    best = compareSnapshots(best, readSnapshotFile(filePath));
  }
  return best;
}

export function buildAdminStatePayload(state = {}) {
  return {
    version: 1,
    generation: CATALOG_GENERATION,
    savedAt: state.savedAt || new Date().toISOString(),
    services: Array.isArray(state.services) ? state.services : serializeServices(),
    settings:
      state.settings && typeof state.settings === "object"
        ? state.settings
        : {
            ...(source?.getAllSettings?.() || {}),
            catalogSeeded: source?.getSetting?.("catalogSeeded") === true,
          },
  };
}

export function writeAdminSnapshot(state, options = {}) {
  if (!state) return null;
  const payload = buildAdminStatePayload(state);
  const incomingIsFactory = catalogMatchesDefaults(payload.services);
  const incomingIsEmpty = payload.services.length === 0;
  const incomingIsCustom = snapshotIsCustom(payload);
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  let wrote = 0;
  const skippedCustom = [];
  const attempted = getSnapshotWritePaths();
  for (const dir of getSnapshotWriteDirs()) {
    const existing = bestExistingInDir(dir);
    const clobberCustom =
      snapshotIsCustom(existing) &&
      (incomingIsFactory || incomingIsEmpty || !incomingIsCustom);
    if (clobberCustom && options.protectCustom !== false) {
      skippedCustom.push(...snapshotFilesFor(dir));
      console.error(
        "Refusing to overwrite custom admin snapshot with factory or empty catalog",
        dir,
      );
      continue;
    }
    if (
      incomingIsFactory &&
      !isFactorySeedAllowed() &&
      options.allowFactory !== true
    ) {
      skippedCustom.push(...snapshotFilesFor(dir));
      console.error(
        "Refusing to persist factory catalog while ALLOW_FACTORY_SEED is off",
        dir,
      );
      continue;
    }
    for (const filePath of snapshotFilesFor(dir)) {
      try {
        atomicWrite(filePath, body);
        wrote += 1;
      } catch (err) {
        console.error("Failed to write admin snapshot", filePath, err?.message || err);
      }
    }
  }
  lastPersistResult = {
    wrote,
    skippedCustom,
    attempted,
    savedAt: payload.savedAt,
    factoryPersistBlocked: incomingIsFactory && skippedCustom.length > 0,
  };
  if (wrote && options.offHost !== false) {
    scheduleOffHostBackup(payload, {
      incomingIsFactory,
      incomingIsEmpty,
      incomingIsCustom,
    });
  }
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
  if (!snapshot && !customSnapshot) {
    return {
      restored: false,
      reason: "no-snapshot",
      hadCustomSnapshot: false,
      sourcePath: null,
    };
  }

  const chosen =
    customSnapshot || (isFactorySeedAllowed() ? snapshot : null);
  if (!chosen) {
    return {
      restored: false,
      reason: "factory-snapshot-blocked",
      hadCustomSnapshot: false,
      sourcePath: snapshot?.sourcePath || null,
      snapshotIsFactoryDefault: true,
    };
  }
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
  const backupPath = path.join(resolved, SNAPSHOT_BACKUP_NAME);
  const snapshot = bestExistingInDir(resolved) || readSnapshotFile(snapshotPath);
  return {
    dir: resolved,
    hasDb: fs.existsSync(path.join(resolved, "globalstore.db")),
    hasJson: fs.existsSync(path.join(resolved, "globalstore.json")),
    hasSnapshot: Boolean(snapshot),
    hasBackup: fs.existsSync(backupPath),
    snapshotPath,
    backupPath,
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
    offHost: getOffHostBackupStatus(),
  };
}

export async function hydrateOffHostIfEmpty() {
  if (!source) {
    return { restored: false, reason: "unbound" };
  }
  if (source.countServices() > 0) {
    return { restored: false, reason: "already-populated" };
  }
  const remote = await pullOffHostBackup();
  if (!remote) {
    return { restored: false, reason: "no-remote" };
  }
  const snapServices = Array.isArray(remote.services) ? remote.services : [];
  if (!snapServices.length) {
    return { restored: false, reason: "remote-empty", sourcePath: remote.sourcePath };
  }
  if (catalogMatchesDefaults(snapServices) && !isFactorySeedAllowed()) {
    return {
      restored: false,
      reason: "remote-factory-blocked",
      snapshotIsFactoryDefault: true,
      sourcePath: remote.sourcePath,
    };
  }
  withoutPersist(() => {
    source.replaceAllServices(snapServices);
    if (remote.settings && typeof remote.settings === "object") {
      source.replaceAllSettings(remote.settings);
    }
  });
  markOffHostRestored(remote);
  persistAdminState();
  console.log(
    `Restored admin catalog from off-host backup (${remote.sourcePath || "remote"}).`,
  );
  return {
    restored: true,
    restoredServices: true,
    restoredSettings: Boolean(remote.settings),
    savedAt: remote.savedAt || null,
    sourcePath: remote.sourcePath || null,
    reason: "off-host",
    snapshotIsFactoryDefault: catalogMatchesDefaults(snapServices),
  };
}
