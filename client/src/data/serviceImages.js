import { DEFAULT_SERVICES } from "../../../shared/defaultServices.js";

const assetBase = import.meta.env.BASE_URL || "/";

export const SERVICE_IMAGES = Object.fromEntries(
  DEFAULT_SERVICES.filter((service) => service.imageUrl).map((service) => [
    service.id,
    service.imageUrl,
  ]),
);

export function serviceImageUrl(id) {
  const url = SERVICE_IMAGES[id];
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  const base = assetBase.endsWith("/") ? assetBase.slice(0, -1) : assetBase;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${base}${path}`;
}

export function wallpaperUrl() {
  return `${assetBase}hero-wallpaper-hd.jpg`;
}
