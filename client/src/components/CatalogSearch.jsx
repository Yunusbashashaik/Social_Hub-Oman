export default function CatalogSearch({ value, onChange, t, inputRef }) {
  return (
    <label className="catalog-search">
      <span className="visually-hidden">{t.searchLabel}</span>
      <svg className="catalog-search-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
        />
      </svg>
      <input
        ref={inputRef}
        type="search"
        className="catalog-search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.searchPlaceholder}
        autoComplete="off"
        enterKeyHint="search"
        spellCheck="false"
      />
      {value ? (
        <button
          type="button"
          className="catalog-search-clear"
          aria-label={t.searchClear}
          onClick={() => onChange("")}
        >
          ×
        </button>
      ) : null}
    </label>
  );
}
