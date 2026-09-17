import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";
import {
  closeDatabase,
  getDataDir,
  initDatabase,
} from "../src/db/connection.js";
import {
  catalogMatchesDefaults,
  getSnapshotWritePaths,
  writeAdminSnapshot,
} from "../src/db/persist.js";
import { getHealthPayload } from "../src/health.js";
import { seedDatabase } from "../src/db/seed.js";
import { listServices, updateService } from "../src/models/Service.js";

process.env.ALLOW_FACTORY_SEED = "1";

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gs-boot-${label}-`));
}

function wipeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function readSnapshot(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "admin-state.json"), "utf8"));
}

function youtubeName() {
  return listServices().find((row) => row.id === "youtube-premium")?.nameEn;
}

async function withDataDir(localDir, fn) {
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = localDir;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
  }
}

/**
 * Production-like boot: DATA_DIR env pins the primary (GoDaddy /local),
 * extraDataDirs stand in for /root and $HOME, migrate/donor copy enabled.
 */
function bootPrimary(localDir, replicas) {
  return initDatabase(undefined, {
    extraDataDirs: replicas,
    hostDurableScan: false,
    skipMigrate: false,
    legacyDataDir: path.join(localDir, ".no-legacy"),
  });
}

afterEach(() => {
  closeDatabase();
});

describe("production boot path (GoDaddy recycle)", () => {
  it("wiped primary + custom snapshot only on secondary restores names and does not factory-seed", async () => {
    const localDir = tempDir("local");
    const rootDir = tempDir("root");
    const homeDir = tempDir("home");

    await withDataDir(localDir, async () => {
      bootPrimary(localDir, [rootDir, homeDir]);
      const first = await seedDatabase();
      assert.equal(first.catalogSeededThisBoot, true);
      assert.equal(first.seedReason, "first-boot");
      updateService("youtube-premium", {
        nameEn: "YouTube Premium",
        prices: { month: 2.1, year: 18 },
      });
      updateService("canva-pro", { nameEn: "Canva Pro" });

      assert.equal(fs.existsSync(path.join(rootDir, "admin-state.json")), true);
      assert.equal(fs.existsSync(path.join(rootDir, "admin-state.backup.json")), true);
      assert.equal(fs.existsSync(path.join(homeDir, "admin-state.json")), true);
      assert.equal(readSnapshot(rootDir).services.find((s) => s.id === "youtube-premium").nameEn, "YouTube Premium");

      closeDatabase();
      wipeDir(localDir);
      assert.equal(fs.existsSync(path.join(localDir, "admin-state.json")), false);
      assert.equal(fs.existsSync(path.join(rootDir, "admin-state.json")), true);

      bootPrimary(localDir, [rootDir, homeDir]);
      const afterWipe = await seedDatabase();
      assert.equal(afterWipe.catalogSeededThisBoot, false);
      assert.notEqual(afterWipe.seedReason, "first-boot");
      assert.equal(youtubeName(), "YouTube Premium");
      assert.equal(listServices().find((s) => s.id === "canva-pro").nameEn, "Canva Pro");
      assert.equal(listServices().find((s) => s.id === "youtube-premium").prices.month, 2.1);
      assert.equal(catalogMatchesDefaults(listServices()), false);

      const health = getHealthPayload();
      assert.equal(health.dataDir, path.resolve(localDir));
      assert.equal(health.catalogSeededThisBoot, false);
      assert.equal(health.hadCustomSnapshot, true);
      assert.equal(health.liveCatalogIsFactoryDefault, false);
      assert.equal(health.overnightWipeSuspected, true);
      assert.equal(health.recoveredFromReplica, true);
      assert.ok(health.replicas.some((row) => row.dir === path.resolve(rootDir) && row.snapshotCustom));
      assert.ok(Array.isArray(health.snapshotWritePaths));
      assert.ok(health.snapshotWritePaths.length >= 2);
      assert.ok(getSnapshotWritePaths().some((file) => file.startsWith(path.resolve(rootDir))));
    });

    fs.rmSync(localDir, { recursive: true, force: true });
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("factory seed persist cannot overwrite a non-default snapshot on any write path", async () => {
    const localDir = tempDir("local");
    const rootDir = tempDir("root");

    await withDataDir(localDir, async () => {
      bootPrimary(localDir, [rootDir]);
      await seedDatabase();
      updateService("youtube-premium", { nameEn: "YouTube Premium" });
      const before = readSnapshot(rootDir);
      assert.equal(before.services.find((s) => s.id === "youtube-premium").nameEn, "YouTube Premium");

      const result = writeAdminSnapshot({
        services: DEFAULT_SERVICES,
        settings: { catalogSeeded: true },
      });
      assert.ok(result.skippedCustom.length >= 1);
      const after = readSnapshot(rootDir);
      assert.equal(after.services.find((s) => s.id === "youtube-premium").nameEn, "YouTube Premium");
      assert.equal(catalogMatchesDefaults(after.services), false);

      closeDatabase();
      wipeDir(localDir);
      bootPrimary(localDir, [rootDir]);
      const seeded = await seedDatabase();
      assert.equal(seeded.catalogSeededThisBoot, false);
      assert.equal(youtubeName(), "YouTube Premium");
      assert.equal(catalogMatchesDefaults(readSnapshot(rootDir).services), false);

      const health = getHealthPayload();
      assert.equal(health.catalogSeededThisBoot, false);
      assert.equal(health.hadCustomSnapshot, true);
    });

    fs.rmSync(localDir, { recursive: true, force: true });
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("true first boot seeds once; the next boot with the same dirs does not reseed", async () => {
    const localDir = tempDir("local");
    const rootDir = tempDir("root");
    const homeDir = tempDir("home");

    await withDataDir(localDir, async () => {
      bootPrimary(localDir, [rootDir, homeDir]);
      const first = await seedDatabase();
      assert.equal(first.catalogSeededThisBoot, true);
      assert.equal(first.seedReason, "first-boot");
      assert.equal(listServices().length, DEFAULT_SERVICES.length);
      const firstYoutube = youtubeName();
      assert.equal(getDataDir(), path.resolve(localDir));
      assert.equal(fs.existsSync(path.join(rootDir, "admin-state.json")), true);
      assert.equal(fs.existsSync(path.join(homeDir, "admin-state.json")), true);

      closeDatabase();
      bootPrimary(localDir, [rootDir, homeDir]);
      const second = await seedDatabase();
      assert.equal(second.catalogSeededThisBoot, false);
      assert.equal(second.servicesSeeded, false);
      assert.notEqual(second.seedReason, "first-boot");
      assert.equal(listServices().length, DEFAULT_SERVICES.length);
      assert.equal(youtubeName(), firstYoutube);

      const health = getHealthPayload();
      assert.equal(health.catalogSeededThisBoot, false);
      assert.equal(health.catalogSeeded, true);
      assert.equal(health.overnightWipeSuspected, false);
    });

    fs.rmSync(localDir, { recursive: true, force: true });
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });
});
