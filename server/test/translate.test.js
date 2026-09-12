import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { translateEnglishToArabic } from "../src/services/translate.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("English to Arabic translation", () => {
  it("translates with the free Google endpoint", async () => {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /clients5\.google\.com\/translate_a\/t/);
      assert.match(String(url), /q=Private%20Screen/);
      return new Response(JSON.stringify(["شاشة خاصة"]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const out = await translateEnglishToArabic("Private Screen");
    assert.equal(out, "شاشة خاصة");
  });

  it("keeps description line breaks from Google", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify(["استمتع بالبث\nالتنشيط الفوري"]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const out = await translateEnglishToArabic(
      "Enjoy streaming\nInstant Activation",
    );
    assert.equal(out, "استمتع بالبث\nالتنشيط الفوري");
  });

  it("falls back to MyMemory when Google is unavailable", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("google")) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(
        JSON.stringify({
          responseStatus: 200,
          responseData: { translatedText: "مرحبا" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const out = await translateEnglishToArabic("Hello");
    assert.equal(out, "مرحبا");
  });

  it("does not accept MyMemory quota warnings as Arabic", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          responseStatus: 200,
          responseData: {
            translatedText:
              "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    await assert.rejects(
      () => translateEnglishToArabic("Hello"),
      /unavailable/i,
    );
  });
});
