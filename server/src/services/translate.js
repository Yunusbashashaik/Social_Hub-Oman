const ARABIC_RE = /[\u0600-\u06FF]/;
const PROVIDER_ERROR_RE =
  /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR/i;

const FETCH_HEADERS = {
  Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (compatible; SocialHubOman/1.0; +https://socialhubomr.com)",
};

export async function translateEnglishToArabic(text) {
  const input = String(text || "").trim();
  if (!input) {
    throw new Error("Text is required");
  }

  const chunks = splitTranslateChunks(input);
  const translatedChunks = [];
  for (const chunk of chunks) {
    translatedChunks.push(await translateChunk(chunk));
  }
  return translatedChunks.join("\n");
}

async function translateChunk(chunk) {
  const errors = [];
  for (const provider of [translateWithGoogle, translateWithMyMemory]) {
    try {
      const raw = await provider(chunk);
      const cleaned = decodeEntities(String(raw || "")).trim();
      if (isUsableTranslation(chunk, cleaned)) return cleaned;
      errors.push(`${provider.name}: unusable result`);
    } catch (err) {
      errors.push(`${provider.name}: ${err.message}`);
    }
  }
  throw new Error("Translation service is unavailable");
}

async function translateWithGoogle(text) {
  const url =
    "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=ar&q=" +
    encodeURIComponent(text);
  const payload = await fetchJson(url);
  const translated = extractGoogleTranslation(payload);
  if (!translated) {
    throw new Error("Google Translate returned an empty result");
  }
  return translated;
}

async function translateWithMyMemory(text) {
  const url =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(text) +
    "&langpair=en|ar";
  const data = await fetchJson(url);
  const translated = data?.responseData?.translatedText;
  if (!translated || Number(data?.responseStatus) >= 400) {
    throw new Error("MyMemory returned an empty result");
  }
  return translated;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(12000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Translation provider returned non-JSON");
  }
}

function extractGoogleTranslation(payload) {
  if (typeof payload === "string") return payload;
  if (!Array.isArray(payload)) return "";
  if (payload.every((item) => typeof item === "string")) {
    return payload.join("");
  }
  const first = payload[0];
  if (typeof first === "string") return payload.filter((p) => typeof p === "string").join("");
  if (Array.isArray(first)) {
    return first
      .map((row) => (Array.isArray(row) ? row[0] : ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

function isUsableTranslation(source, translated) {
  if (!translated) return false;
  if (PROVIDER_ERROR_RE.test(translated)) return false;
  if (ARABIC_RE.test(translated)) return true;
  return !/[A-Za-z]/.test(source);
}

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function splitTranslateChunks(text) {
  if (text.length <= 450) return [text];
  const lines = text.split("\n");
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if (`${current}\n${line}`.length > 450 && current) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
