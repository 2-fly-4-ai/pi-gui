import { useEffect, useRef, useState } from "react";
import type { RuntimeSkillProfileRecord } from "@pi-gui/session-driver/runtime-types";
import { SkillIcon } from "./icons";

interface SkillProfileSelectorProps {
  readonly profiles: readonly RuntimeSkillProfileRecord[];
  readonly activeProfileId?: string;
  readonly onSelectProfile: (profileId: string) => void;
  readonly onOpenSkillProfiles: () => void;
}

export function SkillProfileSelector({ profiles, activeProfileId, onSelectProfile, onOpenSkillProfiles }: SkillProfileSelectorProps) {
  const [open, setOpen] = useState(false);
  const [previewProfileId, setPreviewProfileId] = useState<string | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const active = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const previewProfile = profiles.find((profile) => profile.id === previewProfileId) ?? active ?? profiles[0];
  const activeName = active?.name ?? "Default";

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className="skill-profile-selector" ref={rootRef}>
      <button aria-label={`Skills profile: ${activeName}`} className="composer-control" type="button" onClick={() => setOpen((value) => !value)}>
        <SkillIcon />
        <span>{activeName}</span>
      </button>
      {open ? (
        <div className="skill-profile-selector__popover">
          <div className="skill-profile-selector__menu">
            {profiles.map((profile) => (
              <button
                className={`skill-profile-selector__item${profile.id === active?.id ? " skill-profile-selector__item--active" : ""}`}
                key={profile.id}
                type="button"
                onClick={() => { onSelectProfile(profile.id); setOpen(false); }}
                onFocus={() => setPreviewProfileId(profile.id)}
                onMouseEnter={() => setPreviewProfileId(profile.id)}
              >
                <span className="skill-profile-selector__item-label">{profile.name}</span>
                {profile.description ? <span className="skill-profile-selector__item-meta">{profile.description}</span> : null}
              </button>
            ))}
            <button className="skill-profile-selector__manage" type="button" onClick={() => { onOpenSkillProfiles(); setOpen(false); }}>Manage profiles…</button>
          </div>
          {previewProfile ? <SkillProfilePreview profile={previewProfile} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function SkillProfilePreview({ profile }: { readonly profile: RuntimeSkillProfileRecord }) {
  const enabledSkills = Object.entries(profile.skills)
    .filter(([, mode]) => mode !== "off")
    .sort(([leftKey, leftMode], [rightKey, rightMode]) => {
      if (leftMode !== rightMode) return leftMode === "auto" ? -1 : 1;
      return skillNameFromProfileKey(leftKey).localeCompare(skillNameFromProfileKey(rightKey));
    });
  const autoCount = enabledSkills.filter(([, mode]) => mode === "auto").length;
  const manualCount = enabledSkills.filter(([, mode]) => mode === "manual").length;

  return (
    <aside className="skill-profile-selector__preview" aria-label={`${profile.name} skill profile details`}>
      <div className="skill-profile-selector__preview-header">
        <strong>{profile.name}</strong>
        <span>{autoCount} auto · {manualCount} manual</span>
      </div>
      {profile.description ? <p>{profile.description}</p> : null}
      <div className="skill-profile-selector__skills" aria-label="Active skills">
        {enabledSkills.length ? (
          enabledSkills.slice(0, 18).map(([skillKey, mode]) => (
            <span className={`skill-profile-selector__skill skill-profile-selector__skill--${mode}`} key={skillKey} title={skillNameFromProfileKey(skillKey)}>
              <span>{skillNameFromProfileKey(skillKey)}</span>
              <em>{mode}</em>
            </span>
          ))
        ) : (
          <span className="skill-profile-selector__empty">No profile-specific skill modes. Uses catalog defaults.</span>
        )}
      </div>
      {enabledSkills.length > 18 ? <div className="skill-profile-selector__more">+{enabledSkills.length - 18} more active skills</div> : null}
    </aside>
  );
}

function skillNameFromProfileKey(key: string): string {
  const rawName = key.split(":").at(-1) ?? key;
  return rawName.replace(/[-_]+/g, " ");
}
