import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultDurableDataDir,
  durableDataDirCandidates,
  isInsideAppTree,
  ROOT_HOST_DATA_DIR,
} from "../src/db/connection.js";

describe("durable data directory", () => {
  it("keeps live data under /root when the app itself is installed at /root", () => {
    assert.equal(defaultDurableDataDir("/root", "/root"), ROOT_HOST_DATA_DIR);
  });

  it("uses a sibling folder when the app is a child of /root", () => {
    assert.equal(
      defaultDurableDataDir("/root/Social_Hub-Oman", "/root"),
      "/root/socialhub-oman-data",
    );
  });

  it("does not store live data under /app for GoDaddy Published App", () => {
    assert.equal(defaultDurableDataDir("/app", "/app"), ROOT_HOST_DATA_DIR);
    assert.equal(isInsideAppTree("/app/socialhub-oman-data", "/app"), true);
    assert.equal(
      durableDataDirCandidates("/app", "/app").includes("/app/socialhub-oman-data"),
      false,
    );
    assert.ok(durableDataDirCandidates("/app", "/app").includes(ROOT_HOST_DATA_DIR));
  });
});
