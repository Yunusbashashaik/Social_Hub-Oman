import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultDurableDataDir } from "../src/db/connection.js";

describe("durable data directory", () => {
  it("keeps live data under /root when the app itself is installed at /root", () => {
    assert.equal(defaultDurableDataDir("/root"), "/root/socialhub-oman-data");
  });

  it("uses a sibling folder when the app is a child of /root", () => {
    assert.equal(
      defaultDurableDataDir("/root/Social_Hub-Oman"),
      "/root/socialhub-oman-data",
    );
  });
});
