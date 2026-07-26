import { useState } from "react";
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
