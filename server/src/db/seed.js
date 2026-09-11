import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import {
  bindPersist,
  hydratePersistedAdminState,
  persistAdminState,
  withoutPersist,
  catalogMatchesDefaults,
  settingsMatchDefaults,
} from "./persist.js";
import {
  listServices,
  replaceAllServices,
  seedServicesIfEmpty,
} from "../models/Service.js";
import {
  countSettings,
  getAllSettings,
  replaceAllSettings,
  seedSettingsIfEmpty,
} from "../models/Settings.js";

bindPersist({
  listServices,
  getAllSettings,
  countSettings,
  replaceAllServices,
  replaceAllSettings,
});

export function seedDatabase() {
  const hydrated = hydratePersistedAdminState();
  const servicesSeeded = withoutPersist(() => seedServicesIfEmpty(DEFAULT_SERVICES));
  const settingsSeeded = withoutPersist(() => seedSettingsIfEmpty());
  const services = listServices();
  const settings = getAllSettings();
  if (!catalogMatchesDefaults(services) || !settingsMatchDefaults(settings)) {
    persistAdminState();
  }
  return { servicesSeeded, settingsSeeded, hydrated };
}
