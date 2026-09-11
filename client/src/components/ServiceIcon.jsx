import { useEffect, useState } from "react";
import { serviceImageUrl } from "../data/serviceImages.js";
import { apiUrl } from "../lib/adminApi.js";

/** Brand artwork from DB upload or static public assets, with SVG fallback. */
export default function ServiceIcon({ service, size = "md" }) {
  const accent = service.accent || "#0055ff";
  const id = service.id || "";
  const imageUrl = service.imageUrl;
  const imageSrc = service.imageSrc;
  const hasCustomImage = Boolean(service.hasCustomImage || imageSrc || imageUrl);
  const custom = customImageSrc(service);
  const bundled = hasCustomImage ? null : serviceImageUrl(id);
  const [src, setSrc] = useState(custom || bundled);
  const [failed, setFailed] = useState(!custom && !bundled);
  const name = service.nameEn || id;

  useEffect(() => {
    const nextCustom = customImageSrc({
      id,
      imageUrl,
      imageSrc,
      hasCustomImage,
    });
    const nextBundled = hasCustomImage ? null : serviceImageUrl(id);
    setSrc(nextCustom || nextBundled);
    setFailed(!nextCustom && !nextBundled);
  }, [id, imageUrl, imageSrc, hasCustomImage]);

  return (
    <div
      className={`service-icon service-icon--${size}`}
      style={{ "--service-accent": accent }}
      aria-hidden="true"
    >
      <span className="service-icon-glow" />
      <span className="service-icon-mark" data-brand={id}>
        {src && !failed ? (
          <img
            className="service-icon-img"
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => {
              if (custom && src !== custom) {
                setSrc(custom);
                return;
              }
              setFailed(true);
            }}
          />
        ) : null}
        <span hidden={Boolean(src) && !failed} className="service-icon-fallback">
          {renderFallback(id, accent, name)}
        </span>
      </span>
    </div>
  );
}

function customImageSrc(service) {
  const src = service?.imageSrc || "";
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;
  const url = service?.imageUrl || "";
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("http")) {
    return url;
  }
  if (service?.hasCustomImage || url) {
    if (service.id) return apiUrl(`/api/services/${encodeURIComponent(service.id)}/image`);
    if (url) return apiUrl(url);
  }
  return null;
}

function renderFallback(id, accent, name) {
  const label = (name || id || "??").slice(0, 2).toUpperCase();
  return (
    <svg viewBox="0 0 48 48" className="brand-svg">
      <rect width="48" height="48" rx="12" fill="#0b1220" />
      <rect x="4" y="4" width="40" height="40" rx="10" fill={accent} opacity="0.92" />
      <text
        x="24"
        y="29"
        textAnchor="middle"
        fill="#fff"
        fontSize="14"
        fontWeight="800"
        fontFamily="Sora,sans-serif"
      >
        {label}
      </text>
    </svg>
  );
}
