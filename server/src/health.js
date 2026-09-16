import {
  APP_ROOT,
  getActiveStorePath,
  getCatalogSearchDirs,
  getDataDir,
  getDbEngine,
  getLastInitStatus,
  getReplicaDataDirs,
  isInsideAppTree,
  storeArtifactsPresent,
} from "./db/connection.js";
import { catalogMatchesDefaults, getPersistStatus } from "./db/persist.js";
import { getLastSeedResult } from "./db/seed.js";
import { countServices, listServices } from "./models/Service.js";
import { getAllSettings, getSetting } from "./models/Settings.js";

export function getHealthPayload() {
  const persist = getPersistStatus();
  const seed = getLastSeedResult();
  const init = getLastInitStatus();
  const dataDir = getDataDir();
  const storePath = getActiveStorePath();
  const hydrated = seed.hydrated || {};
  const liveCatalogIsFactoryDefault = catalogMatchesDefaults(listServices());
  const hadCustomSnapshot = Boolean(
    hydrated.hadCustomSnapshot || persist.hadCustomSnapshot,
  );
  const primaryHadStoreAtBoot = init.primaryHadStore;
  const recoveredFromReplica = Boolean(
    init.donorCopied || hydrated.restoredServices || seed.seedReason === "restored-replica",
  );
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
    liveCatalogIsFactoryDefault,
    primaryHadStoreAtBoot,
    primaryStorePresent: storeArtifactsPresent(dataDir),
    donorDir: init.donorDir,
    donorCopied: Boolean(init.donorCopied),
    lastMigration: init.migration || null,
    snapshotSavedAt: persist.snapshotSavedAt,
    snapshotServices: persist.snapshotServices,
    snapshotSourcePath: persist.snapshotSourcePath,
    snapshotIsFactoryDefault: persist.snapshotIsFactoryDefault,
    snapshotPaths: persist.snapshotPaths,
    snapshotWritePaths: persist.snapshotWritePaths,
    replicaDataDirs: getReplicaDataDirs(),
    catalogSearchDirs: getCatalogSearchDirs(),
    replicas: persist.replicas || [],
    hydratedRestored: Boolean(hydrated.restored),
    hydratedRestoredServices: Boolean(hydrated.restoredServices),
    hydratedReason: hydrated.reason || null,
    hydratedSourcePath: hydrated.sourcePath || null,
    hadCustomSnapshot,
    recoveredFromReplica,
    seedReason: seed.seedReason || null,
    persistWrote: persist.lastPersist?.wrote ?? null,
    persistSkippedCustom: persist.lastPersist?.skippedCustom || [],
    factoryPersistBlocked: Boolean(persist.lastPersist?.factoryPersistBlocked),
    overnightWipeSuspected:
      primaryHadStoreAtBoot === false &&
      (hadCustomSnapshot || recoveredFromReplica),
    time: new Date().toISOString(),
  };
}
