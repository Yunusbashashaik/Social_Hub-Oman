import { useEffect, useState } from "react";
import { serviceImageUrl } from "../data/serviceImages.js";
import { apiUrl } from "../lib/adminApi.js";

/** Artwork from an admin upload, with initials fallback when none is set. */
export default function ServiceIcon({ service, size = "md" }) {
  const accent = service.accent || "#0055ff";
  const id = service.id || "";
  const uploaded = resolveUploadedSrc(service);
  const bundled = serviceImageUrl(id);
  const [src, setSrc] = useState(uploaded || bundled);
  const [failed, setFailed] = useState(false);
  const name = service.nameEn || id;

  useEffect(() => {
    setSrc(uploaded || bundled);
    setFailed(false);
  }, [uploaded, bundled]);

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
              const blobUrl = id
                ? apiUrl(`/api/services/${encodeURIComponent(id)}/image`)
                : null;
              if (blobUrl && src !== blobUrl) {
                setSrc(blobUrl);
                return;
              }
              if (bundled && src !== bundled) {
                setSrc(bundled);
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

function resolveUploadedSrc(service) {
  const src = service?.imageSrc || "";
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;
  const url = service?.imageUrl || "";
  if (!url) {
    if (service?.hasCustomImage && service.id) {
      return apiUrl(`/api/services/${encodeURIComponent(service.id)}/image`);
    }
    return null;
  }
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("http")) {
    return url;
  }
  return apiUrl(url);
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
