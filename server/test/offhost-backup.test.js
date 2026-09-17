import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";
import { closeDatabase, initDatabase } from "../src/db/connection.js";
import {
  defaultRawBackupUrl,
  flushOffHostBackup,
  getOffHostBackupConfig,
  resetOffHostBackupStatus,
} from "../src/db/offHostBackup.js";
import { catalogMatchesDefaults } from "../src/db/persist.js";
import { getHealthPayload } from "../src/health.js";
import { seedDatabase } from "../src/db/seed.js";
import { insertService, listServices } from "../src/models/Service.js";
import { assertNoFactoryNames } from "./testUtil.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gs-offhost-"));
}

function customSnapshot() {
  return {
    version: 1,
    generation: 4,
    savedAt: "2026-09-17T00:00:00.000Z",
    services: [
      {
        id: "youtube-premium",
        nameEn: "YouTube Premium",
        nameAr: "يوتيوب بريميوم",
        descriptionEn: "Custom live catalog",
        descriptionAr: "كتالوج مباشر مخصص",
        prices: { month: 2.1, year: 18 },
        offerType: "special",
        offerExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        sortOrder: 0,
      },
      {
        id: "canva-pro",
        nameEn: "Canva Pro",
        nameAr: "كانفا برو",
        descriptionEn: "Kept after wipe",
        descriptionAr: "يبقى بعد المسح",
        prices: { month: 3, year: 20 },
        offerType: "none",
        sortOrder: 1,
      },
    ],
    settings: {
      catalogSeeded: true,
      complaintEmail: "ops-backup@example.com",
    },
  };
}

function startBackupServer(initialPayload = null) {
  let file = initialPayload
    ? { payload: initialPayload, sha: crypto.randomBytes(8).toString("hex") }
    : null;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const isGithub = url.pathname.includes("/repos/");
    if (req.method === "GET" && !isGithub) {
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(file.payload));
      return;
    }
    if (req.method === "GET" && isGithub) {
      if (!file) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "Not Found" }));
        return;
      }
      const accept = String(req.headers.accept || "");
      if (accept.includes("raw")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(file.payload));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          sha: file.sha,
          encoding: "base64",
          content: Buffer.from(`${JSON.stringify(file.payload)}\n`).toString("base64"),
        }),
      );
      return;
    }
    if (req.method === "PUT" && isGithub) {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const payload = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
        file = { payload, sha: crypto.randomBytes(8).toString("hex") };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ content: { sha: file.sha } }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        getFile: () => file,
        rawUrl: `http://127.0.0.1:${port}/admin-state.json`,
        apiBase: `http://127.0.0.1:${port}`,
      });
    });
  });
}

function withEnv(patch, fn) {
  const prev = {};
  for (const key of Object.keys(patch)) {
    prev[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  const restore = () => {
    for (const key of Object.keys(patch)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  };
  const run = fn();
  if (run && typeof run.then === "function") {
    return run.finally(restore);
  }
  restore();
  return run;
}

afterEach(async () => {
  await flushOffHostBackup();
  closeDatabase();
});

describe("off-host catalog backup auto-restore", () => {
  it("empty local + off-host CATALOG_BACKUP_URL restores custom catalog and never factory-fills", async () => {
    const dir = tempDir();
    const backup = await startBackupServer(customSnapshot());
    await withEnv(
      {
        ALLOW_FACTORY_SEED: undefined,
        DATA_DIR: dir,
        CATALOG_BACKUP_URL: backup.rawUrl,
        CATALOG_BACKUP_TOKEN: undefined,
        CATALOG_BACKUP_REPO: undefined,
        GITHUB_TOKEN: undefined,
        GH_TOKEN: undefined,
      },
      async () => {
        resetOffHostBackupStatus();
        initDatabase(undefined, { skipMigrate: true, hostDurableScan: false });
        const seeded = await seedDatabase();
        assert.equal(seeded.catalogSeededThisBoot, false);
        assert.equal(seeded.offHost.restored, true);
        assert.equal(listServices().find((s) => s.id === "youtube-premium").nameEn, "YouTube Premium");
        assert.equal(listServices().find((s) => s.id === "canva-pro").nameEn, "Canva Pro");
        assert.equal(
          listServices().find((s) => s.id === "youtube-premium").offerType,
          "special",
        );
        assertNoFactoryNames(assert, listServices());
        assert.equal(catalogMatchesDefaults(listServices()), false);
        assert.equal(
          listServices().some((s) => s.nameEn === "▶️ YouTube Premium Personal Account"),
          false,
        );
        assert.equal(
          listServices().some((s) => s.id === "netflix-prime-combo"),
          false,
        );

        const health = getHealthPayload();
        assert.equal(health.factorySeedDisabled, true);
        assert.equal(health.offHostBackupConfigured, true);
        assert.equal(health.offHostBackupRestoredThisBoot, true);
        assert.equal(health.liveCatalogIsFactoryDefault, false);
        assert.equal(health.catalogSeededThisBoot, false);
        assert.ok(health.offHostBackupSavedAt);
      },
    );
    backup.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("admin persist pushes GitHub Contents backup; wipe then auto-restores custom names", async () => {
    const dir = tempDir();
    const backup = await startBackupServer(null);
    await withEnv(
      {
        ALLOW_FACTORY_SEED: undefined,
        DATA_DIR: dir,
        CATALOG_BACKUP_URL: undefined,
        CATALOG_BACKUP_TOKEN: "test-token",
        CATALOG_BACKUP_REPO: "test/repo",
        CATALOG_BACKUP_API_URL: backup.apiBase,
        GITHUB_TOKEN: undefined,
        GH_TOKEN: undefined,
      },
      async () => {
        resetOffHostBackupStatus();
        initDatabase(undefined, { skipMigrate: true, hostDurableScan: false });
        await seedDatabase();
        assert.equal(listServices().length, 0);
        insertService({
          id: "youtube-premium",
          nameEn: "YouTube Premium",
          nameAr: "يوتيوب",
          descriptionEn: "Live custom",
          descriptionAr: "مخصص",
          prices: { month: 2.1, year: 18 },
          offerType: "eid",
          offerExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        });
        await flushOffHostBackup();
        assert.equal(fs.existsSync(path.join(dir, "admin-state.json")), true);
        assert.equal(fs.existsSync(path.join(dir, "admin-state.backup.json")), true);
        assert.equal(backup.getFile()?.payload.services[0].nameEn, "YouTube Premium");

        closeDatabase();
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });

        initDatabase(undefined, { skipMigrate: true, hostDurableScan: false });
        const afterWipe = await seedDatabase();
        await flushOffHostBackup();
        assert.equal(afterWipe.catalogSeededThisBoot, false);
        assert.equal(afterWipe.offHost.restored, true);
        assert.equal(youtubeLive(), "YouTube Premium");
        assert.equal(listServices()[0].offerType, "eid");
        assertNoFactoryNames(assert, listServices());
        const health = getHealthPayload();
        assert.equal(health.offHostBackupRestoredThisBoot, true);
        assert.equal(health.liveCatalogIsFactoryDefault, false);
        assert.equal(health.factorySeedDisabled, true);
      },
    );
    backup.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("wiped empty local with no off-host backup stays empty and never inserts factory names", async () => {
    const dir = tempDir();
    await withEnv(
      {
        ALLOW_FACTORY_SEED: undefined,
        DATA_DIR: dir,
        CATALOG_BACKUP_URL: undefined,
        CATALOG_BACKUP_TOKEN: undefined,
        CATALOG_BACKUP_REPO: undefined,
        CATALOG_BACKUP_API_URL: undefined,
        GITHUB_TOKEN: undefined,
        GH_TOKEN: undefined,
      },
      async () => {
        resetOffHostBackupStatus();
        initDatabase(undefined, { skipMigrate: true, hostDurableScan: false });
        const seeded = await seedDatabase();
        assert.equal(seeded.catalogSeededThisBoot, false);
        assert.equal(seeded.seedReason, "empty-no-factory-fill");
        assert.equal(listServices().length, 0);
        assertNoFactoryNames(assert, listServices());
        for (const row of DEFAULT_SERVICES) {
          assert.equal(
            listServices().some((s) => s.nameEn === row.nameEn),
            false,
          );
        }
        const health = getHealthPayload();
        assert.equal(health.factorySeedDisabled, true);
        assert.equal(health.catalogEmpty, true);
        assert.equal(health.offHostBackupConfigured, true);
        assert.equal(health.liveCatalogIsFactoryDefault, false);
        assert.equal(health.offHostBackupRestoredThisBoot, false);
        assert.equal(health.catalogState, "wiped-empty");
      },
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("default GitHub raw URL is configured without a token", () => {
    withEnv(
      {
        CATALOG_BACKUP_URL: undefined,
        CATALOG_BACKUP_TOKEN: undefined,
        CATALOG_BACKUP_REPO: undefined,
        GITHUB_TOKEN: undefined,
        GH_TOKEN: undefined,
        CATALOG_BACKUP_DISABLE: undefined,
      },
      () => {
        const config = getOffHostBackupConfig();
        assert.equal(config.configured, true);
        assert.equal(config.canPush, false);
        assert.equal(
          config.url,
          "https://raw.githubusercontent.com/Yunusbashashaik/Social_Hub-Oman/main/catalog-backup/admin-state.json",
        );
        assert.equal(config.url, defaultRawBackupUrl());
      },
    );
  });

  it("empty local + committed catalog-backup restores N>0 services without factory seed", async () => {
    const committed = JSON.parse(fs.readFileSync(COMMITTED_BACKUP, "utf8"));
    const backupCopy = JSON.parse(fs.readFileSync(COMMITTED_BACKUP_COPY, "utf8"));
    assert.ok(committed.services.length > 0);
    assert.equal(committed.services.length, DEFAULT_SERVICES.length);
    assert.equal(backupCopy.services.length, committed.services.length);
    assert.equal(typeof committed.services[0].offerType, "string");
    assert.ok("offerExpiresAt" in committed.services[0]);

    const dir = tempDir();
    const originalFetch = globalThis.fetch;
    const fetched = [];
    try {
      await withEnv(
        {
          ALLOW_FACTORY_SEED: undefined,
          DATA_DIR: dir,
          CATALOG_BACKUP_URL: undefined,
          CATALOG_BACKUP_TOKEN: undefined,
          CATALOG_BACKUP_REPO: undefined,
          CATALOG_BACKUP_API_URL: undefined,
          CATALOG_BACKUP_DISABLE: undefined,
          CATALOG_BACKUP_ALLOW_NETWORK: "1",
          GITHUB_TOKEN: undefined,
          GH_TOKEN: undefined,
        },
        async () => {
          globalThis.fetch = async (url) => {
            fetched.push(String(url));
            assert.equal(String(url), defaultRawBackupUrl());
            return {
              ok: true,
              text: async () => JSON.stringify(committed),
              json: async () => committed,
            };
          };
          resetOffHostBackupStatus();
          initDatabase(undefined, { skipMigrate: true, hostDurableScan: false });
          const seeded = await seedDatabase();
          assert.equal(seeded.catalogSeededThisBoot, false);
          assert.equal(seeded.offHost.restored, true);
          assert.ok(listServices().length > 0);
          assert.equal(listServices().length, committed.services.length);
          const health = getHealthPayload();
          assert.equal(health.factorySeedDisabled, true);
          assert.equal(health.catalogEmpty, false);
          assert.equal(health.services, committed.services.length);
          assert.equal(health.offHostBackupConfigured, true);
          assert.equal(health.offHostBackupRestoredThisBoot, true);
          assert.equal(health.offHostBackupSource, "github-raw");
          assert.ok(fetched.includes(defaultRawBackupUrl()));
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("empty local hydrates from packaged catalog-backup without a token", async () => {
    const committed = JSON.parse(fs.readFileSync(COMMITTED_BACKUP, "utf8"));
    const dir = tempDir();
    await withEnv(
      {
        ALLOW_FACTORY_SEED: undefined,
        DATA_DIR: dir,
        CATALOG_BACKUP_URL: undefined,
        CATALOG_BACKUP_TOKEN: undefined,
        CATALOG_BACKUP_REPO: undefined,
        CATALOG_BACKUP_API_URL: undefined,
        CATALOG_BACKUP_USE_PACKAGED: "1",
        CATALOG_BACKUP_ALLOW_NETWORK: undefined,
        GITHUB_TOKEN: undefined,
        GH_TOKEN: undefined,
      },
      async () => {
        resetOffHostBackupStatus();
        initDatabase(undefined, { skipMigrate: true, hostDurableScan: false });
        const seeded = await seedDatabase();
        assert.equal(seeded.catalogSeededThisBoot, false);
        assert.equal(seeded.offHost.restored, true);
        assert.equal(listServices().length, committed.services.length);
        const health = getHealthPayload();
        assert.equal(health.factorySeedDisabled, true);
        assert.equal(health.offHostBackupConfigured, true);
        assert.equal(health.offHostBackupRestoredThisBoot, true);
        assert.equal(health.catalogEmpty, false);
        assert.match(String(health.offHostBackupSource || ""), /catalog-backup/);
      },
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

function youtubeLive() {
  return listServices().find((row) => row.id === "youtube-premium")?.nameEn;
}

const COMMITTED_BACKUP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../catalog-backup/admin-state.json",
);
const COMMITTED_BACKUP_COPY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../catalog-backup/admin-state.backup.json",
);
