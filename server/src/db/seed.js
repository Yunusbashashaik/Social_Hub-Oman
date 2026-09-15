import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import {
  bindPersist,
  hydratePersistedAdminState,
  persistAdminState,
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
});

let lastSeedResult = {
  servicesSeeded: false,
  settingsSeeded: false,
  catalogSeededThisBoot: false,
  hydrated: { restored: false },
  catalogReset: false,
};

export function getLastSeedResult() {
  return lastSeedResult;
}

function seedDefaultCatalogIfEmpty() {
  if (countServices() > 0) {
    setSetting("catalogSeeded", true);
    return false;
  }

  // Catalog was already initialized (admin deleted every row). Do not re-insert defaults.
  if (getSetting("catalogSeeded") === true) {
    return false;
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
  return true;
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

export function seedDatabase() {
  const settingsSeeded = withoutPersist(() => seedSettingsIfEmpty());
  const hydrated = hydratePersistedAdminState();
  const servicesSeeded = seedDefaultCatalogIfEmpty();
  applyDefaultServicePhotos();
  persistAdminState();

  lastSeedResult = {
    servicesSeeded,
    settingsSeeded,
    catalogSeededThisBoot: servicesSeeded,
    hydrated,
    catalogReset: false,
  };
  return lastSeedResult;
}
