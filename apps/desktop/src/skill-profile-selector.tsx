import { useState } from "react";
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
  const active = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const activeName = active?.name ?? "Default";
  return (
    <div className="skill-profile-selector">
      <button aria-label={`Skills profile: ${activeName}`} className="composer-control" type="button" onClick={() => setOpen((value) => !value)}>
        <SkillIcon />
        <span>{activeName}</span>
      </button>
      {open ? (
        <div className="skill-profile-selector__menu">
          {profiles.map((profile) => (
            <button className="skill-profile-selector__item" key={profile.id} type="button" onClick={() => { onSelectProfile(profile.id); setOpen(false); }}>
              <strong>{profile.name}</strong>
              {profile.description ? <span>{profile.description}</span> : null}
            </button>
          ))}
          <button className="skill-profile-selector__manage" type="button" onClick={() => { onOpenSkillProfiles(); setOpen(false); }}>Manage profiles…</button>
        </div>
      ) : null}
    </div>
  );
}
