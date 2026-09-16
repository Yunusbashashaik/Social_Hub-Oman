import {
  APP_ROOT,
  getActiveStorePath,
  getCatalogSearchDirs,
  getDataDir,
  getDbEngine,
  getReplicaDataDirs,
  isInsideAppTree,
} from "./db/connection.js";
import { getPersistStatus } from "./db/persist.js";
import { getLastSeedResult } from "./db/seed.js";
import { countServices } from "./models/Service.js";
import { getAllSettings, getSetting } from "./models/Settings.js";

export function getHealthPayload() {
  const persist = getPersistStatus();
  const seed = getLastSeedResult();
  const dataDir = getDataDir();
  const storePath = getActiveStorePath();
  const hydrated = seed.hydrated || {};
  return {
    ok: true,
    service: "global-store-api",
    db: getDbEngine(),
    dataDir,
    storePath,
    databasePath: storePath,
    services: countServices(),
    complaintEmail: getAllSettings().complaintEmail,
    catalogSeededThisBoot: Boolean(seed.catalogSeededThisBoot),
    catalogSeeded: getSetting("catalogSeeded") === true,
    dataDirInsideApp: isInsideAppTree(dataDir, APP_ROOT),
    snapshotSavedAt: persist.snapshotSavedAt,
    snapshotServices: persist.snapshotServices,
    snapshotSourcePath: persist.snapshotSourcePath,
    snapshotIsFactoryDefault: persist.snapshotIsFactoryDefault,
    snapshotPaths: persist.snapshotPaths,
    snapshotWritePaths: persist.snapshotWritePaths,
    replicaDataDirs: getReplicaDataDirs(),
    catalogSearchDirs: getCatalogSearchDirs(),
    hydratedRestored: Boolean(hydrated.restored),
    hydratedRestoredServices: Boolean(hydrated.restoredServices),
    hydratedReason: hydrated.reason || null,
    hydratedSourcePath: hydrated.sourcePath || null,
    hadCustomSnapshot: Boolean(hydrated.hadCustomSnapshot || persist.hadCustomSnapshot),
    seedReason: seed.seedReason || null,
    time: new Date().toISOString(),
  };
}
