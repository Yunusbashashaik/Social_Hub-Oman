const logoSrc = `${import.meta.env.BASE_URL || "/"}logo.jpg`;

export default function Logo({ className = "", showTagline = false }) {
  return (
    <span className={`brand-logo ${className}`.trim()}>
      <img
        className="brand-mark brand-mark-img"
        src={logoSrc}
        alt=""
        width="48"
        height="48"
        decoding="async"
      />
      <span className="brand-text">
        <span className="brand-wordmark">
          SOCIAL <span>HUB</span>
        </span>
        {showTagline ? (
          <span className="brand-tagline">
            Premium Subscriptions · Digital Services
          </span>
        ) : null}
      </span>
    </span>
  );
}
