import { buildWhatsAppUrl } from "../data/catalog.js";

function formatWhatsAppDisplay(num) {
  const digits = String(num || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

export default function OwnerBlock({
  label,
  heading,
  names,
  numbers = [],
}) {
  if (!names && !numbers.length) return null;
  return (
    <section className="owner-block">
      {label ? <p className="owner-block-label">{label}</p> : null}
      {names ? (
        <p className="modal-owners">
          {heading ? <span className="owner-heading">{heading} </span> : null}
          {names}
        </p>
      ) : null}
      {numbers.length ? (
        <ul className="owner-numbers">
          {numbers.map((num) => {
            const digits = String(num).replace(/\D/g, "");
            const display = formatWhatsAppDisplay(digits);
            return (
              <li key={digits}>
                <a href={buildWhatsAppUrl(digits, "")}>{display}</a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
