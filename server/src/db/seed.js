import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import {
  getServiceImageBlob,
  insertService,
  listServices,
  replaceAllServices,
  seedServicesIfEmpty,
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
  const servicesSeeded = Boolean(servicesSeededEmpty || restoredMissing);

  const gen = Number(getSetting("catalogGeneration") || 0);
  let catalogReset = false;
  if (gen !== CATALOG_GENERATION) {
    setSetting("catalogGeneration", CATALOG_GENERATION);
    persistAdminState();
    catalogReset = true;
  } else if (servicesSeededEmpty || restoredMissing) {
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
