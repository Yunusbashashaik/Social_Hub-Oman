import {
  bindPersist,
  hydratePersistedAdminState,
  persistAdminState,
  withoutPersist,
  catalogMatchesDefaults,
  settingsMatchDefaults,
  CATALOG_GENERATION,
} from "./persist.js";
import {
  getServiceImageBlob,
  listServices,
  replaceAllServices,
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
  replaceAllServices,
  replaceAllSettings,
  getServiceImageBlob,
});

export function seedDatabase() {
  const settingsSeeded = withoutPersist(() => seedSettingsIfEmpty());
  const hydrated = hydratePersistedAdminState();
  if (hydrated.restoredServices) {
    setSetting("catalogGeneration", CATALOG_GENERATION);
  }

  const gen = Number(getSetting("catalogGeneration") || 0);
  let catalogReset = false;
  if (gen !== CATALOG_GENERATION) {
    withoutPersist(() => replaceAllServices([]));
    setSetting("catalogGeneration", CATALOG_GENERATION);
    persistAdminState();
    catalogReset = true;
  } else {
    const services = listServices();
    const settings = getAllSettings();
    if (!catalogMatchesDefaults(services) || !settingsMatchDefaults(settings)) {
      persistAdminState();
    }
  }

  return { servicesSeeded: false, settingsSeeded, hydrated, catalogReset };
}
