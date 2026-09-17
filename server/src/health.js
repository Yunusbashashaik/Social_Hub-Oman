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
import { factorySeedDisabled, isFactorySeedAllowed } from "./config/factorySeed.js";
import { getOffHostBackupConfig, getOffHostBackupStatus } from "./db/offHostBackup.js";
import { getLastSeedResult } from "./db/seed.js";
import { countServices, listServices } from "./models/Service.js";
import { getAllSettings, getSetting } from "./models/Settings.js";

export function getHealthPayload() {
  const persist = getPersistStatus();
  const seed = getLastSeedResult();
  const init = getLastInitStatus();
  const offHost = getOffHostBackupStatus();
  const offHostCfg = getOffHostBackupConfig();
  const dataDir = getDataDir();
  const storePath = getActiveStorePath();
  const hydrated = seed.hydrated || {};
  const offHostHydrate = seed.offHost || {};
  const liveCatalogIsFactoryDefault = catalogMatchesDefaults(listServices());
  const catalogEmpty = countServices() === 0;
  const hadCustomSnapshot = Boolean(
    hydrated.hadCustomSnapshot || persist.hadCustomSnapshot,
  );
  const primaryHadStoreAtBoot = init.primaryHadStore;
  const offHostBackupRestoredThisBoot = Boolean(
    offHost.restored || offHostHydrate.restored,
  );
  const recoveredFromReplica = Boolean(
    init.donorCopied ||
      hydrated.restoredServices ||
      seed.seedReason === "restored-replica" ||
      offHostBackupRestoredThisBoot,
  );
  let catalogState = "custom-intact";
  if (seed.catalogSeededThisBoot) catalogState = "factory-seeded-this-boot";
  else if (offHostBackupRestoredThisBoot) catalogState = "recovered-off-host";
  else if (seed.seedReason === "restored-replica" || hydrated.restoredServices) {
    catalogState = "recovered-from-replica";
  } else if (catalogEmpty && primaryHadStoreAtBoot === false) {
    catalogState = "wiped-empty";
  } else if (catalogEmpty) catalogState = "empty";
  else if (liveCatalogIsFactoryDefault) catalogState = "factory-default";

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
    catalogEmpty,
    catalogState,
    factorySeedAllowed: isFactorySeedAllowed(),
    factorySeedDisabled: factorySeedDisabled(),
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
    offHostBackupConfigured: Boolean(offHostCfg.configured),
    offHostBackupRestoredThisBoot,
    offHostBackupSavedAt: offHost.savedAt || null,
    offHostBackupSource: offHost.source || offHostHydrate.sourcePath || null,
    offHostBackupError: offHost.error || null,
    overnightWipeSuspected:
      primaryHadStoreAtBoot === false &&
      (hadCustomSnapshot || recoveredFromReplica || offHostBackupRestoredThisBoot),
    time: new Date().toISOString(),
  };
}
