import type { ComponentProps } from "react";
import { NewThreadView } from "../../new-thread-view";
import { SkillProfileSelector } from "../../skill-profile-selector";

type NewThreadViewProps = ComponentProps<typeof NewThreadView>;

export interface NewThreadSurfaceProps {
  readonly viewProps: Omit<NewThreadViewProps, "skillProfileControl">;
  readonly onSelectSkillProfile: (profileId: string) => void;
  readonly onOpenSkillProfiles: () => void;
}

export function NewThreadSurface({
  viewProps,
  onSelectSkillProfile,
  onOpenSkillProfiles,
}: NewThreadSurfaceProps) {
  if (viewProps.workspaces.length === 0) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">Workspace</div>
          <h1>Open a folder to start</h1>
          <p>Add a project folder before creating a new thread.</p>
        </div>
      </section>
    );
  }

  return (
    <NewThreadView
      {...viewProps}
      skillProfileControl={viewProps.runtime ? (
        <SkillProfileSelector
          profiles={viewProps.runtime.skillProfiles}
          activeProfileId={viewProps.runtime.activeSkillProfileId}
          onSelectProfile={onSelectSkillProfile}
          onOpenSkillProfiles={onOpenSkillProfiles}
        />
      ) : undefined}
    />
  );
}
