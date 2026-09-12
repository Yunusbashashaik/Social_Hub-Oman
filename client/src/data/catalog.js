import { DEFAULT_SETTINGS } from "./defaultSettings.js";

let supportNumbers = [...DEFAULT_SETTINGS.whatsappNumbers];
let orderLineIndex = 0;

export function setSupportNumbers(numbers) {
  if (Array.isArray(numbers) && numbers.length) {
    supportNumbers = numbers.map((n) => String(n).replace(/\D/g, "")).filter(Boolean);
    if (!supportNumbers.length) {
      supportNumbers = [...DEFAULT_SETTINGS.whatsappNumbers];
    }
  }
}

export function nextSupportNumber() {
  const num = supportNumbers[orderLineIndex % supportNumbers.length];
  orderLineIndex += 1;
  return num;
}

export function buildWhatsAppUrl(phone, message) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function buildOrderMessage(service, durationKey, priceAmount, lang) {
  const durationEn = durationKey === "month" ? "1 Month" : "1 Year";
  const durationAr = durationKey === "month" ? "شهر واحد" : "سنة واحدة";
  if (lang === "ar") {
    return `مرحباً فريق دعم Social Hub، أود شراء الاشتراك التالي:

الدولة: عُمان
الخدمة: ${service.nameAr}
المدة: ${durationAr}
السعر: ${priceAmount} ر.ع.

يرجى تزويدي بتفاصيل الدفع وإتمام طلبي.`;
  }
  return `Hello Social Hub Support Team, I would like to purchase the following subscription:

Country: Oman
Service: ${service.nameEn}
Duration: ${durationEn}
Price: ${priceAmount} OMR

Please provide payment details and complete my order.`;
}

/** Fallback catalog if the API is unavailable. Admin-added services are the source of truth. */
export const SERVICES = [];

/** Subscriptions dropdown uses the first live services from the API. */
export const FEATURED_SERVICE_IDS = [];

export async function fetchServices() {
  const { fetchPublicServices } = await import("../lib/adminApi.js");
  return fetchPublicServices();
}

export function isOutOfStock(service) {
  if (!service) return false;
  if (service.outOfStock) return true;
  const month = Number(service.prices?.month);
  const year = Number(service.prices?.year);
  return month === 0 || year === 0;
}

export function filterServices(services, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return services;
  return services.filter((service) => {
    const haystack = [service.nameEn, service.nameAr]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function ownerDisplayNames(text) {
  return String(text || "")
    .replace(/^(owned\s*(?:&\s*managed\s*)?by)\s+/i, "")
    .replace(/^(مملوك(?:ة)?(?:\s*ويُدار(?:ة)?)?\s*بواسطة)\s+/i, "")
    .trim();
}
