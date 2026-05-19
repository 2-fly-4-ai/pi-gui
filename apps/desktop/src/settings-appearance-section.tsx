import type { ThemeMode } from "./desktop-state";
import { SHINOBI_ROSTER, useSelectedShinobi } from "./shinobi-roster";
import { SHURIKEN_ROSTER, useSelectedShuriken } from "./shuriken-roster";
import { SettingsGroup, SettingsRow } from "./settings-utils";

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

  return (
    <>
      <SettingsGroup title="Theme">
        {THEME_OPTIONS.map((option) => (
          <SettingsRow key={option.mode} title={option.label} description={option.description}>
            <input
              checked={themeMode === option.mode}
              name="theme"
              type="radio"
              onChange={() => onSetThemeMode(option.mode)}
            />
          </SettingsRow>
        ))}
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
