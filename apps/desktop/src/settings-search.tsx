import { useMemo, useRef, useState } from "react";
import { searchSettings, type SettingsSearchEntry } from "./product-experience/settings-search";
import type { SettingsSection } from "./settings-utils";

export function SettingsSearch({
  onSelectSection,
}: {
  readonly onSelectSection: (section: SettingsSection) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchSettings(query), [query]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const select = (entry: SettingsSearchEntry) => {
    onSelectSection(entry.section);
    window.setTimeout(() => {
      document.querySelectorAll(".settings-search-target").forEach((target) =>
        target.classList.remove("settings-search-target"));
      const rows = Array.from(document.querySelectorAll<HTMLElement>(".settings-row"));
      const target = rows.find((row) => row.textContent?.toLowerCase().includes(entry.rowText.toLowerCase()));
      target?.classList.add("settings-search-target");
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.querySelector<HTMLElement>("input, select, button, textarea")?.focus();
    }, 0);
  };

  return (
    <div className="settings-search">
      <label>
        <span className="sr-only">Search settings</span>
        <input
          ref={inputRef}
          aria-label="Search settings"
          placeholder="Try “make text bigger” or “turn off crash reports”…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) {
              event.preventDefault();
              select(results[0]);
            }
          }}
        />
      </label>
      {query.trim() ? (
        <div className="settings-search__results" role="listbox" aria-label="Settings search results">
          {results.length ? results.map((entry) => (
            <button key={entry.id} role="option" type="button" onClick={() => select(entry)}>
              <strong>{entry.label}</strong>
              <span>{entry.description}</span>
              <small>{entry.section}</small>
            </button>
          )) : <p>No matching setting.</p>}
        </div>
      ) : null}
    </div>
  );
}
