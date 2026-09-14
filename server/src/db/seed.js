import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import {
  getServiceImageBlob,
  insertService,
  listServices,
  replaceAllServices,
  seedServicesIfEmpty,
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
import {
  bindPersist,
  hydratePersistedAdminState,
  persistAdminState,
  withoutPersist,
  catalogMatchesDefaults,
  settingsMatchDefaults,
  CATALOG_GENERATION,
} from "./persist.js";

bindPersist({
  listServices,
  getAllSettings,
  countSettings,
  replaceAllServices,
  replaceAllSettings,
  getServiceImageBlob,
});

/** Re-insert baked catalog rows that are missing. Never overwrite an existing id (Admin edits stay). */
function ensureHardcodedServices() {
  const existing = new Set(listServices().map((row) => row.id));
  let added = 0;
  withoutPersist(() => {
    DEFAULT_SERVICES.forEach((service, index) => {
      if (existing.has(service.id)) return;
      insertService({ ...service, sortOrder: index }, { persist: false });
      existing.add(service.id);
      added += 1;
    });
  });
  return added;
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
  const servicesSeededEmpty = withoutPersist(() =>
    seedServicesIfEmpty(DEFAULT_SERVICES),
  );

  const hydrated = hydratePersistedAdminState();
  if (hydrated.restoredServices) {
    setSetting("catalogGeneration", CATALOG_GENERATION);
  }

  const restoredMissing = ensureHardcodedServices();
  const photosFilled = applyDefaultServicePhotos();
  const servicesSeeded = Boolean(servicesSeededEmpty || restoredMissing);

  const gen = Number(getSetting("catalogGeneration") || 0);
  let catalogReset = false;
  if (gen !== CATALOG_GENERATION) {
    setSetting("catalogGeneration", CATALOG_GENERATION);
    persistAdminState();
    catalogReset = true;
  } else if (servicesSeededEmpty || restoredMissing || photosFilled) {
    persistAdminState();
  } else {
    const services = listServices();
    const settings = getAllSettings();
    if (!catalogMatchesDefaults(services) || !settingsMatchDefaults(settings)) {
      persistAdminState();
    }
  }

  return { servicesSeeded, settingsSeeded, hydrated, catalogReset };
}
