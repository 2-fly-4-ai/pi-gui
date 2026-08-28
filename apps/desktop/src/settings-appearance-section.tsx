import { useEffect, useMemo, useState } from "react";
import type { ThemeMode } from "./desktop-state";
import { SHINOBI_ROSTER, useSelectedShinobi } from "./shinobi-roster";
import { SHURIKEN_ROSTER, useSelectedShuriken } from "./shuriken-roster";
import { SettingsGroup, SettingsRow } from "./settings-utils";
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  readAppearancePreferences,
  saveAppearancePreferences,
  type AppearancePreferences,
} from "./appearance-preferences";
import { applyThemeDefinition, type OpenVsxThemeSearchResult, type ThemeDefinition, type ThemeGallerySnapshot } from "./theme-types";

interface SettingsAppearanceSectionProps {
  readonly themeMode: ThemeMode;
  readonly onSetThemeMode: (mode: ThemeMode) => void;
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; description: string }[] = [
  { mode: "system", label: "System", description: "Follow your OS appearance setting" },
  { mode: "light", label: "Light", description: "Always use the light theme" },
  { mode: "dark", label: "Dark", description: "Always use the dark theme" },
];

export function SettingsAppearanceSection({ themeMode, onSetThemeMode }: SettingsAppearanceSectionProps) {
  const [selectedShinobi, selectShinobi] = useSelectedShinobi();
  const [selectedShuriken, selectShuriken] = useSelectedShuriken();
  const [appearance, setAppearance] = useState(readAppearancePreferences);
  const [gallery, setGallery] = useState<ThemeGallerySnapshot>();
  const [previewTheme, setPreviewTheme] = useState<ThemeDefinition>();
  const [themeError, setThemeError] = useState<string>();
  const [openVsxQuery, setOpenVsxQuery] = useState("");
  const [openVsxResults, setOpenVsxResults] = useState<readonly OpenVsxThemeSearchResult[]>([]);
  const [openVsxPending, setOpenVsxPending] = useState(false);
  const allThemes = useMemo(() => gallery ? [...gallery.builtIns, ...gallery.installed] : [], [gallery]);
  const selectedTheme = allThemes.find((theme) => theme.id === gallery?.selectedThemeId);
  const applyForCurrentMode = async (theme: ThemeDefinition) => {
    await window.piApp?.previewThemePalette(theme.id);
    const resolved = await window.piApp?.getResolvedTheme();
    if (resolved) applyThemeDefinition(theme, resolved);
  };

  useEffect(() => {
    let active = true;
    void window.piApp?.getThemeGallery().then((snapshot) => { if (active) setGallery(snapshot); }).catch((error) => { if (active) setThemeError(errorMessage(error)); });
    return () => {
      active = false;
      void window.piApp?.getThemeGallery().then(async (snapshot) => {
        const selected = [...snapshot.builtIns, ...snapshot.installed].find((theme) => theme.id === snapshot.selectedThemeId);
        if (selected) await applyForCurrentMode(selected);
      });
    };
  }, []);
  const updateAppearance = (patch: Partial<AppearancePreferences>) => {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    saveAppearancePreferences(next);
  };

  return (
    <>
      <SettingsGroup title="Theme">
        {THEME_OPTIONS.map((option) => (
          <SettingsRow key={option.mode} title={option.label} description={option.description}>
            <input
              aria-label={option.label}
              checked={themeMode === option.mode}
              name="theme"
              type="radio"
              onChange={() => onSetThemeMode(option.mode)}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Theme gallery" description="Curated Pi palettes and imported VS Code color themes. Theme files are treated as bounded color data only—no extension code, CSS, fonts, settings, or lifecycle scripts run.">
        {themeError ? <div className="inline-error" role="alert">{themeError}</div> : null}
        {previewTheme ? (
          <div className="theme-preview-banner" role="status">
            <div><strong>Previewing {previewTheme.name}</strong><span>This preview reverts unless you apply it.</span></div>
            <button type="button" onClick={() => { setPreviewTheme(undefined); if (selectedTheme) void applyForCurrentMode(selectedTheme); }}>Cancel preview</button>
            <button className="button button--primary" type="button" onClick={() => void window.piApp?.selectThemePalette(previewTheme.id).then((snapshot) => { setGallery(snapshot); setPreviewTheme(undefined); })}>Apply theme</button>
          </div>
        ) : null}
        <div className="theme-gallery" data-testid="theme-gallery">
          {allThemes.map((theme) => (
            <article className={`theme-card${theme.id === gallery?.selectedThemeId ? " theme-card--selected" : ""}`} key={theme.id}>
              <div className="theme-card__swatches" aria-hidden="true">
                {[theme.palettes.light, theme.palettes.dark].map((palette, index) => <span key={index} style={{ background: palette.main }}><i style={{ background: palette.surface }} /><i style={{ background: palette.accent }} /><i style={{ background: palette.textStrong }} /></span>)}
              </div>
              <div className="theme-card__copy"><div><h3>{theme.name}</h3>{theme.id === gallery?.selectedThemeId ? <span>Applied</span> : null}</div><p>{theme.description}</p><small>{theme.sourceLabel}{theme.license ? ` · ${theme.license}` : ""}</small></div>
              <div className="theme-card__actions">
                <button type="button" onClick={() => { setPreviewTheme(theme); void applyForCurrentMode(theme); }}>Preview</button>
                {theme.id !== gallery?.selectedThemeId ? <button type="button" onClick={() => void window.piApp?.selectThemePalette(theme.id).then(async (snapshot) => { setGallery(snapshot); await applyForCurrentMode(theme); })}>Apply</button> : null}
                {theme.source !== "built-in" ? <button className="danger-text" type="button" onClick={() => void window.piApp?.removeThemePalette(theme.id).then(async (snapshot) => {
                  setGallery(snapshot);
                  if (previewTheme?.id === theme.id) setPreviewTheme(undefined);
                  const selected = [...snapshot.builtIns, ...snapshot.installed].find((candidate) => candidate.id === snapshot.selectedThemeId);
                  if (selected) await applyForCurrentMode(selected);
                }).catch((error) => setThemeError(errorMessage(error)))}>Remove</button> : null}
              </div>
            </article>
          ))}
        </div>
        <div className="theme-gallery__footer">
          <div><strong>Import VS Code theme</strong><span>JSON/JSONC only. Includes must remain inside the selected theme folder.</span></div>
          <button className="button button--secondary" type="button" onClick={() => void window.piApp?.importVsCodeTheme().then(async (theme) => { if (!theme) return; const snapshot = await window.piApp!.getThemeGallery(); setGallery(snapshot); setPreviewTheme(theme); await applyForCurrentMode(theme); }).catch((error) => setThemeError(errorMessage(error)))}>Choose theme file…</button>
          <button type="button" onClick={() => void window.piApp?.resetThemePalette().then(async (snapshot) => { setGallery(snapshot); setPreviewTheme(undefined); const selected = snapshot.builtIns.find((theme) => theme.id === snapshot.selectedThemeId); if (selected) await applyForCurrentMode(selected); })}>Reset palette</button>
        </div>
        <form className="open-vsx-theme-search" onSubmit={(event) => { event.preventDefault(); if (openVsxQuery.trim().length < 2) return; setOpenVsxPending(true); setThemeError(undefined); void window.piApp?.searchOpenVsxThemes(openVsxQuery).then(setOpenVsxResults).catch((error) => setThemeError(errorMessage(error))).finally(() => setOpenVsxPending(false)); }}>
          <div><strong>Search Open VSX themes</strong><span>Pi downloads only declared JSON/JSONC color resources from open-vsx.org after checking category and license. Extension code and archives are never installed.</span></div>
          <label><span className="sr-only">Search Open VSX themes</span><input value={openVsxQuery} minLength={2} placeholder="Search themes…" onChange={(event) => setOpenVsxQuery(event.target.value)} /></label>
          <button className="button button--secondary" disabled={openVsxPending || openVsxQuery.trim().length < 2} type="submit">{openVsxPending ? "Searching…" : "Search"}</button>
        </form>
        {openVsxResults.length ? <div className="open-vsx-theme-results" aria-label="Open VSX theme results">{openVsxResults.map((result) => <article key={`${result.namespace}/${result.name}/${result.version}`}><div><h3>{result.displayName}</h3><p>{result.description}</p><small>{result.namespace}/{result.name} · {result.version}{result.verified ? " · verified publisher" : ""}</small></div><button type="button" onClick={() => { setThemeError(undefined); void window.piApp?.installOpenVsxTheme(result.namespace, result.name, result.version).then(async (theme) => { const snapshot = await window.piApp!.getThemeGallery(); setGallery(snapshot); setPreviewTheme(theme); await applyForCurrentMode(theme); }).catch((error) => setThemeError(errorMessage(error))); }}>Install color data</button></article>)}</div> : null}
      </SettingsGroup>

      <SettingsGroup title="Reading and density" description="Tune transcript spacing and text size across the app. Saved on this device.">
        <SettingsRow title="Interface density" description="Compact reduces timeline and card spacing; Comfortable keeps the default breathing room.">
          <select
            aria-label="Interface density"
            className="settings-select"
            value={appearance.density}
            onChange={(event) => updateAppearance({ density: event.target.value === "compact" ? "compact" : "comfortable" })}
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </SettingsRow>
        <SettingsRow title="Transcript text" description="Changes conversation prose without scaling the surrounding controls.">
          <select
            aria-label="Transcript text size"
            className="settings-select"
            value={appearance.transcriptFontSize}
            onChange={(event) => updateAppearance({ transcriptFontSize: Number(event.target.value) })}
          >
            {[13, 14, 15, 16, 17, 18].map((size) => <option key={size} value={size}>{size}px</option>)}
          </select>
        </SettingsRow>
        <SettingsRow title="Code and terminal text" description="Adjusts monospace content in transcripts and tool output.">
          <select
            aria-label="Monospace text size"
            className="settings-select"
            value={appearance.monoFontSize}
            onChange={(event) => updateAppearance({ monoFontSize: Number(event.target.value) })}
          >
            {[11, 12, 13, 14, 15, 16].map((size) => <option key={size} value={size}>{size}px</option>)}
          </select>
        </SettingsRow>
        <SettingsRow title="Timeline compression" description="Automatic groups repetition in long threads; Compact groups more aggressively; Fully expanded keeps every raw row visible.">
          <select
            aria-label="Timeline compression"
            className="settings-select"
            value={appearance.timelineCompression}
            onChange={(event) => updateAppearance({
              timelineCompression:
                event.target.value === "compact" || event.target.value === "expanded"
                  ? event.target.value
                  : "automatic",
            })}
          >
            <option value="automatic">Automatic</option>
            <option value="compact">Compact</option>
            <option value="expanded">Fully expanded</option>
          </select>
        </SettingsRow>
        <SettingsRow title="Timeline minimap" description="Show an opt-in narrow event overview only when a thread is long enough to benefit.">
          <input
            aria-label="Show timeline minimap"
            type="checkbox"
            checked={appearance.timelineMinimap}
            onChange={(event) => updateAppearance({ timelineMinimap: event.currentTarget.checked })}
          />
        </SettingsRow>
        <SettingsRow title="Success moments" description="Show a brief, non-blocking accent only for evidence-backed completed work. Reduced motion and focused writing are always respected.">
          <input
            aria-label="Show success moments"
            type="checkbox"
            checked={appearance.successMoments}
            onChange={(event) => updateAppearance({ successMoments: event.currentTarget.checked })}
          />
        </SettingsRow>
        <SettingsRow title="Reset reading preferences" description="Restore Comfortable, 15px transcript text, 13px code text, automatic compression, a hidden minimap, and success moments.">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              setAppearance(DEFAULT_APPEARANCE_PREFERENCES);
              saveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
            }}
          >
            Reset
          </button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Choose your Shinobi"
        description="Pick the character that represents you in threads. Your choice is saved on this device."
      >
        <div className="shinobi-picker" data-testid="shinobi-picker">
          <div className="shinobi-picker__hero" data-testid="selected-shinobi">
            <div className="shinobi-picker__portrait-shell">
              <img src={selectedShinobi.imageUrl} alt="" aria-hidden="true" />
            </div>
            <div>
              <div className="shinobi-picker__eyebrow">Current Shinobi</div>
              <h3>{selectedShinobi.name}</h3>
              <p>{selectedShinobi.meaning}</p>
            </div>
          </div>

          <div className="shinobi-picker__grid" role="radiogroup" aria-label="Choose your Shinobi">
            {SHINOBI_ROSTER.map((shinobi, index) => {
              const selected = shinobi.id === selectedShinobi.id;
              return (
                <button
                  aria-checked={selected}
                  className={`shinobi-card${selected ? " shinobi-card--selected" : ""}`}
                  data-testid={`shinobi-option-${shinobi.id}`}
                  key={shinobi.id}
                  role="radio"
                  type="button"
                  onClick={() => selectShinobi(shinobi.id)}
                >
                  <span className="shinobi-card__number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="shinobi-card__image-shell">
                    <img src={shinobi.imageUrl} alt="" aria-hidden="true" loading="lazy" />
                  </span>
                  <span className="shinobi-card__copy">
                    <strong>{shinobi.name}</strong>
                    <span>{shinobi.meaning}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Choose your Shuriken"
        description="Pick the spinning thinking icon used in chat. Your choice is saved on this device."
      >
        <div className="shinobi-picker shuriken-picker" data-testid="shuriken-picker">
          <div className="shinobi-picker__hero shuriken-picker__hero" data-testid="selected-shuriken">
            <div className="shinobi-picker__portrait-shell shuriken-picker__portrait-shell">
              <img src={selectedShuriken.imageUrl} alt="" aria-hidden="true" />
            </div>
            <div>
              <div className="shinobi-picker__eyebrow">Current Shuriken</div>
              <h3>{selectedShuriken.name}</h3>
              <p>{selectedShuriken.meaning}</p>
            </div>
          </div>

          <div className="shinobi-picker__grid shuriken-picker__grid" role="radiogroup" aria-label="Choose your Shuriken">
            {SHURIKEN_ROSTER.map((shuriken, index) => {
              const selected = shuriken.id === selectedShuriken.id;
              return (
                <button
                  aria-checked={selected}
                  className={`shinobi-card shuriken-card${selected ? " shinobi-card--selected shuriken-card--selected" : ""}`}
                  data-testid={`shuriken-option-${shuriken.id}`}
                  key={shuriken.id}
                  role="radio"
                  type="button"
                  onClick={() => selectShuriken(shuriken.id)}
                >
                  <span className="shinobi-card__number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="shinobi-card__image-shell shuriken-card__image-shell">
                    <img src={shuriken.imageUrl} alt="" aria-hidden="true" loading="lazy" />
                  </span>
                  <span className="shinobi-card__copy">
                    <strong>{shuriken.name}</strong>
                    <span>{shuriken.meaning}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </SettingsGroup>
    </>
  );
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
