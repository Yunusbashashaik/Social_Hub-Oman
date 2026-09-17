import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterPublicServices,
  formatCountdown,
  isActiveOffer,
  isExpiredOffer,
  normalizeOfferType,
} from "../../shared/offers.js";

describe("optional limited-time offers", () => {
  it("treats missing offer type as none", async () => {
    assert.equal(normalizeOfferType(undefined), "none");
    assert.equal(isActiveOffer({ offerType: "none" }), false);
    assert.equal(isExpiredOffer({ offerType: "none" }), false);
    const kept = filterPublicServices([{ id: "a", offerType: "none" }]);
    assert.equal(kept.length, 1);
  });

  it("exposes countdown fields for an active offer", async () => {
    const service = {
      id: "flash",
      offerType: "eid",
      offerExpiresAt: new Date(Date.now() + 90_000).toISOString(),
    };
    assert.equal(isActiveOffer(service), true);
    const countdown = formatCountdown(90_000);
    assert.equal(countdown.days, 0);
    assert.equal(countdown.minutes, 1);
    assert.equal(countdown.seconds, 30);
    assert.match(countdown.label, /0d 00:01:30/);
  });

  it("hides expired offers from the public list", async () => {
    const expired = {
      id: "gone",
      offerType: "special",
      offerExpiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const regular = { id: "keep", offerType: "none" };
    const publicList = filterPublicServices([expired, regular]);
    assert.deepEqual(
      publicList.map((s) => s.id),
      ["keep"],
    );
  });
});
