import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { closeDatabase, initDatabase } from "../src/db/connection.js";
import { seedDatabase } from "../src/db/seed.js";
import { listServices, updateService } from "../src/models/Service.js";
import { getAllSettings, updateSettings } from "../src/models/Settings.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gs-persist-"));
}

function sqliteFiles(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

afterEach(() => {
  closeDatabase();
});

describe("admin catalog persistence", () => {
  it("keeps admin prices and settings after restart and re-seed", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    seedDatabase();

    const first = listServices()[0];
    updateService(first.id, { prices: { month: 7.5, year: 40 } });
    updateSettings({
      complaintEmail: "persist-forever@example.com",
      aboutEn: "Custom about text from admin",
      ownersEn: "Test Owner One, Test Owner Two",
      whatsappNumbers: ["96811111111", "96822222222"],
    });

    closeDatabase();
    initDatabase(dbPath);
    const afterRestart = seedDatabase();
    assert.equal(afterRestart.servicesSeeded, false);
    assert.equal(afterRestart.settingsSeeded, false);

    const again = listServices().find((s) => s.id === first.id);
    assert.equal(again.prices.month, 7.5);
    assert.equal(again.prices.year, 40);
    const settings = getAllSettings();
    assert.equal(settings.complaintEmail, "persist-forever@example.com");
    assert.equal(settings.aboutEn, "Custom about text from admin");
    assert.equal(settings.ownersEn, "Test Owner One, Test Owner Two");
    assert.deepEqual(settings.whatsappNumbers, ["96811111111", "96822222222"]);

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("restores admin edits from snapshot when the database file is replaced with an empty seed", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    seedDatabase();

    const first = listServices()[0];
    updateService(first.id, { prices: { month: 9, year: 55 } });
    updateSettings({ complaintEmail: "snapshot@example.com", aboutEn: "Kept about" });

    closeDatabase();
    for (const file of sqliteFiles(dbPath)) {
      fs.rmSync(file, { force: true });
    }
    assert.equal(fs.existsSync(path.join(dir, "admin-state.json")), true);

    initDatabase(dbPath);
    const seeded = seedDatabase();
    assert.equal(seeded.hydrated.restored, true);
    assert.equal(seeded.servicesSeeded, false);

    const restored = listServices().find((s) => s.id === first.id);
    assert.equal(restored.prices.month, 9);
    assert.equal(restored.prices.year, 55);
    assert.equal(getAllSettings().complaintEmail, "snapshot@example.com");
    assert.equal(getAllSettings().aboutEn, "Kept about");

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
