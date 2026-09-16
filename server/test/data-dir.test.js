import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultDurableDataDir,
  durableDataDirCandidates,
  isInsideAppTree,
  LOCAL_HOST_DATA_DIR,
  ROOT_HOST_DATA_DIR,
  selectDataDirFromCandidates,
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

  it("lists /local as a replica but prefers /root as the empty default", () => {
    assert.equal(defaultDurableDataDir("/local/app", "/home/node"), ROOT_HOST_DATA_DIR);
    const candidates = durableDataDirCandidates("/local/app", "/home/node");
    assert.equal(candidates[0], ROOT_HOST_DATA_DIR);
    assert.ok(candidates.includes(LOCAL_HOST_DATA_DIR));
    assert.ok(candidates.includes("/home/node/socialhub-oman-data"));
    assert.ok(candidates.includes("/local/socialhub-oman-data"));
  });

  it("selects an existing catalog over the first empty writable path", () => {
    const local = "/local/socialhub-oman-data";
    const root = "/root/socialhub-oman-data";
    const chosen = selectDataDirFromCandidates([local, root], {
      canWrite: () => true,
      hasStore: (dir) => dir === root,
    });
    assert.equal(chosen, root);
  });
});
