import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import { isFactorySeedAllowed } from "../config/factorySeed.js";
import {
  bindPersist,
  catalogInitializedOnReplicas,
  hasAnyAdminSnapshot,
  hydrateOffHostIfEmpty,
  hydratePersistedAdminState,
  persistAdminState,
  readBestCustomSnapshot,
  withoutPersist,
} from "./persist.js";
import {
  countServices,
  getServiceImageBlob,
  insertService,
  listServices,
  replaceAllServices,
  updateService,
} from "../models/Service.js";
import {
  countSettings,
  getAllSettings,
  getSetting,
  replaceAllSettings,
  seedSettingsIfEmpty,
  setSetting,
} from "../models/Settings.js";

bindPersist({
  listServices,
  getAllSettings,
  countSettings,
  countServices,
  replaceAllServices,
  replaceAllSettings,
  getServiceImageBlob,
  getSetting,
});

let lastSeedResult = {
  servicesSeeded: false,
  settingsSeeded: false,
  catalogSeededThisBoot: false,
  hydrated: { restored: false },
  offHost: { restored: false },
  catalogReset: false,
  seedReason: "not-run",
};

export function getLastSeedResult() {
  return lastSeedResult;
}

function catalogWasInitialized() {
  if (getSetting("catalogSeeded") === true) return true;
  if (readBestCustomSnapshot()) return true;
  if (catalogInitializedOnReplicas()) return true;
  if (hasAnyAdminSnapshot()) return true;
  return false;
}

function restoreReplicaIfEmpty() {
  if (countServices() > 0) return false;
  const chosen = readBestCustomSnapshot();
  const services = Array.isArray(chosen?.services) ? chosen.services : [];
  if (!chosen || services.length === 0) return false;
  withoutPersist(() => {
    replaceAllServices(services);
    if (chosen.settings && typeof chosen.settings === "object") {
      replaceAllSettings(chosen.settings);
    }
  });
  setSetting("catalogSeeded", true);
  return true;
}

/**
 * Insert DEFAULT_SERVICES only when ALLOW_FACTORY_SEED=1 (dev). Production
 * never factory-fills: empty after restore attempts stays empty.
 */
function seedDefaultCatalogIfEmpty() {
  if (countServices() > 0) {
    setSetting("catalogSeeded", true);
    return { seeded: false, reason: "already-populated" };
  }

  if (restoreReplicaIfEmpty()) {
    return { seeded: false, reason: "restored-replica" };
  }

  if (catalogWasInitialized()) {
    return { seeded: false, reason: "previously-seeded-leave-empty" };
  }

  if (!isFactorySeedAllowed()) {
    return { seeded: false, reason: "empty-no-factory-fill" };
  }

  withoutPersist(() => {
    DEFAULT_SERVICES.forEach((service, index) => {
      insertService(
        {
          ...service,
          sortOrder: service.sortOrder ?? index,
        },
        { persist: false },
      );
    });
  });
  setSetting("catalogSeeded", true);
  return { seeded: true, reason: "first-boot" };
}

function hasCustomArtwork(row) {
  if (getServiceImageBlob(row.id)) return true;
  const url = String(row.imageUrl || "");
  if (!url) return false;
  return url.startsWith("/api/uploads/") || url.startsWith("data:") || url.startsWith("blob:");
}

/** Fill bundled photos onto hardcoded rows that still have none. Do not replace Admin uploads. */
function applyDefaultServicePhotos() {
  const byId = new Map(DEFAULT_SERVICES.map((row) => [row.id, row]));
  let updated = 0;
  withoutPersist(() => {
    listServices().forEach((row) => {
      const baked = byId.get(row.id);
      if (!baked?.imageUrl || hasCustomArtwork(row) || row.imageUrl) return;
      updateService(row.id, { imageUrl: baked.imageUrl }, { persist: false });
      updated += 1;
    });
  });
  return updated;
}

export async function seedDatabase() {
  const settingsSeeded = withoutPersist(() => seedSettingsIfEmpty());
  const hydrated = hydratePersistedAdminState();
  let offHost = { restored: false, reason: "not-needed" };
  if (countServices() === 0) {
    offHost = await hydrateOffHostIfEmpty();
  }
  const seed = seedDefaultCatalogIfEmpty();
  applyDefaultServicePhotos();

  const liveCount = countServices();
  let persistResult = null;
  if (seed.seeded) {
    persistResult = persistAdminState({
      protectCustom: true,
      allowFactory: isFactorySeedAllowed(),
    });
  } else if (liveCount > 0) {
    persistResult = persistAdminState();
  }

  lastSeedResult = {
    servicesSeeded: seed.seeded,
    settingsSeeded,
    catalogSeededThisBoot: seed.seeded,
    hydrated,
    offHost,
    catalogReset: false,
    seedReason: seed.reason,
    persistWrote: persistResult?.wrote ?? 0,
    persistSkippedCustom: persistResult?.skippedCustom || [],
  };
  return lastSeedResult;
}
