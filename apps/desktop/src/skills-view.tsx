import { useMemo, useState, type ReactNode } from "react";
import type { RuntimeSkillMode, RuntimeSkillProfileRecord, RuntimeSkillRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { WorkspaceRecord } from "./desktop-state";
import { CloseIcon, RefreshIcon, SkillIcon } from "./icons";
import type { SkillUsageByPath, SkillUsageRecord } from "./skill-usage";
import { formatRelativeTime, titleCase } from "./string-utils";

type SkillCategory = "all" | "project" | "pi" | "cloudflare" | "frontend" | "code" | "docs" | "debug" | "verification" | "planning" | "review" | "git" | "workflow";

interface SkillViewModel {
  readonly skill: RuntimeSkillRecord;
  readonly category: SkillCategory;
  readonly categoryLabel: string;
  readonly tags: readonly string[];
  readonly summary: string;
  readonly sourceLabel: string;
  readonly sourceDetail: string;
}

const CATEGORY_FILTERS: readonly { readonly id: SkillCategory; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "project", label: "Project" },
  { id: "pi", label: "Pi dev" },
  { id: "cloudflare", label: "Cloudflare" },
  { id: "frontend", label: "Frontend" },
  { id: "code", label: "Code" },
  { id: "docs", label: "Docs" },
  { id: "debug", label: "Debug" },
  { id: "verification", label: "Verify" },
  { id: "planning", label: "Plan" },
  { id: "review", label: "Review" },
  { id: "git", label: "Git" },
  { id: "workflow", label: "Workflow" },
];

interface SkillsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly usageByPath?: SkillUsageByPath;
  readonly onRefresh: () => void;
  readonly onOpenSkillFolder: (filePath: string) => void;
  readonly onSetSkillMode: (filePath: string, mode: RuntimeSkillMode) => void;
  readonly onSetActiveProfile: (profileId: string) => void;
  readonly onSaveProfile: (profile: RuntimeSkillProfileRecord) => void;
  readonly onDeleteProfile: (profileId: string) => void;
  readonly onTrySkill: (skill: RuntimeSkillRecord) => void;
  readonly discoveryWorkspaceControl?: ReactNode;
}

export function SkillsView({
  workspace,
  runtime,
  usageByPath = {},
  onRefresh,
  onOpenSkillFolder,
  onSetSkillMode,
  onSetActiveProfile,
  onSaveProfile,
  onDeleteProfile,
  onTrySkill,
  discoveryWorkspaceControl,
}: SkillsViewProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SkillCategory>("all");
  const [selectedSkillPath, setSelectedSkillPath] = useState<string | undefined>();
  const [profileDialog, setProfileDialog] = useState<"new" | "rename" | undefined>();
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const skills = runtime?.skills ?? [];
  const profiles = runtime?.skillProfiles ?? [{ id: "default", name: "Default", description: "Use default skill modes from Pi and the local catalog.", skills: {} }];
  const activeProfileId = runtime?.activeSkillProfileId ?? "default";
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const workspaceName = workspace?.name ?? "selected workspace";
  const skillModels = useMemo(() => skills.map((skill) => toSkillViewModel(skill, workspaceName)), [skills, workspaceName]);
  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return skillModels.filter((model) => {
      if (category !== "all" && model.category !== category && !model.tags.includes(categoryLabel(category))) {
        return false;
      }
      if (!normalized) {
        return true;
      }

      const skill = model.skill;
      return [
        skill.name,
        skill.description,
        skill.source,
        skill.slashCommand,
        model.categoryLabel,
        ...model.tags,
      ].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [category, query, skillModels]);
  const selectedSkillModel = filteredSkills.find((model) => model.skill.filePath === selectedSkillPath);
  const selectedSkill = selectedSkillModel?.skill;
  const isPanelOpen = !!selectedSkill;

  if (!workspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">Skills</div>
          <h1>Select a workspace</h1>
          <p>Skills are discovered from the selected workspace plus your user-level skill directories.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas">
      <div className="conversation skills-view">
        <header className="view-header">
          <div>
            <div className="chat-header__eyebrow">Skills</div>
            <h1 className="view-header__title">Skill profiles</h1>
            <p className="view-header__body">
              Choose which skills Pi may use automatically, manually, or never.
            </p>
          </div>
          <div className="view-header__actions">
            {discoveryWorkspaceControl ? (
              <div className="skills-header-discovery">
                {discoveryWorkspaceControl}
                <span className={`skills-header-discovery__count ${skills.some((skill) => skill.source === "project") ? "skills-header-discovery__count--active" : ""}`}>
                  {skills.filter((skill) => skill.source === "project").length} local
                </span>
              </div>
            ) : null}
            <button className="button button--secondary" type="button" onClick={onRefresh}>
              <RefreshIcon />
              <span>Refresh</span>
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={() =>
                onTrySkill({
                  name: "new-skill",
                  description: "Create a new skill for this workspace",
                  filePath: "",
                  baseDir: workspace.path,
                  source: "project",
                  enabled: true,
                  disableModelInvocation: false,
                  slashCommand: "/skill:new-skill",
                  mode: "auto",
                })
              }
            >
              New skill
            </button>
          </div>
        </header>

        <div className="skill-profile-manager">
          <div>
            <div className="skill-profile-manager__eyebrow">{activeProfile?.name ?? "Default"}</div>
            <p>Global profile · workspace only affects project-local discovery</p>
          </div>
          <div className="skill-profile-manager__actions">
            <select
              aria-label="Active skill profile"
              className="settings-select"
              value={activeProfileId}
              onChange={(event) => onSetActiveProfile(event.target.value)}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            <button className="button button--secondary" type="button" onClick={() => {
              setProfileName("");
              setProfileDescription("");
              setProfileDialog("new");
            }}>New profile</button>
            <button className="button button--secondary" type="button" onClick={() => {
              const name = `${activeProfile?.name ?? "Default"} Copy`;
              onSaveProfile({
                id: slugifyProfileName(name),
                name,
                description: activeProfile?.description,
                skills: activeProfile?.skills ?? {},
              });
            }}>Duplicate</button>
            <button className="button button--secondary" type="button" onClick={() => {
              setProfileName(activeProfile?.name ?? "Default");
              setProfileDescription(activeProfile?.description ?? "");
              setProfileDialog("rename");
            }}>Rename</button>
            {activeProfileId !== "default" ? (
              <button className="button button--danger" type="button" onClick={() => onDeleteProfile(activeProfileId)}>Delete</button>
            ) : null}
          </div>
        </div>

        <div className="skills-toolbar skills-toolbar--rich">
          <label className="skills-search-control">
            <SkillIcon />
            <input
              aria-label="Search skills"
              className="skills-search"
              placeholder="Search by name, tag, source, or slash command"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            {query.trim() ? (
              <button
                aria-label="Clear skill search"
                className="skills-search-control__clear"
                type="button"
                onClick={() => setQuery("")}
              >
                <CloseIcon />
              </button>
            ) : null}
          </label>
          <div className="skills-toolbar__meta">
            <span>{filteredSkills.length} of {skillModels.length} skills</span>
          </div>
          <div className="skills-filter-tabs" aria-label="Filter skills by category">
            {CATEGORY_FILTERS.map((filter) => (
              <button
                className={`skills-filter-tabs__item${category === filter.id ? " skills-filter-tabs__item--active" : ""}`}
                key={filter.id}
                type="button"
                onClick={() => setCategory(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`skills-layout ${isPanelOpen ? "skills-layout--panel-open" : ""}`}>
          <div className="skills-grid" data-testid="skills-list">
            {filteredSkills.length === 0 ? (
              <SkillsEmptyState message="No skills discovered in this workspace context. Global profiles still apply wherever those skills are available." />
            ) : (
              filteredSkills.map((model) => (
                <div
                  className={`skill-card ${model.skill.source === "project" ? "skill-card--project" : ""} ${selectedSkill?.filePath === model.skill.filePath ? "skill-card--active" : ""}`}
                  key={model.skill.filePath}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedSkillPath(
                      selectedSkillPath === model.skill.filePath ? undefined : model.skill.filePath
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setSelectedSkillPath(
                      selectedSkillPath === model.skill.filePath ? undefined : model.skill.filePath
                    );
                  }}
                >
                  <span className="skill-card__title-row">
                    <span className="skill-card__title">{titleCase(model.skill.name)}</span>
                    <span className={`skill-card__badge ${model.skill.mode !== "off" ? "skill-card__badge--enabled" : ""}`}>
                      {skillModeLabel(model.skill.mode)}
                    </span>
                  </span>
                  <span className="skill-card__description">{model.summary}</span>
                  <span className="skill-card__tags">
                    {model.skill.source === "project" ? (
                      <span className="skill-tag skill-tag--project" title={`Project-local skill from ${workspace.name}`}>Local to this project</span>
                    ) : null}
                    {model.tags.filter((tag) => tag !== "Project").slice(0, model.skill.source === "project" ? 2 : 3).map((tag) => (
                      <span className="skill-tag" key={tag} title={tag}>{tag}</span>
                    ))}
                  </span>
                  <span className="skill-card__footer">
                    <SkillModeControl
                      compact
                      mode={model.skill.mode}
                      onChange={(mode) => onSetSkillMode(model.skill.filePath, mode)}
                    />
                    <span className="skill-card__stats">
                      <SkillUsageStats usage={usageByPath[model.skill.filePath]} compact />
                    </span>
                  </span>
                  <span className="skill-card__meta">
                    <span>{model.sourceLabel}</span>
                    <code>{model.skill.slashCommand}</code>
                    {model.skill.mode === "manual" ? <span>slash only</span> : null}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="skill-detail-wrap">
            <div className="skill-detail">
              {selectedSkill ? (
                <>
                  <div className="skill-detail__header">
                    <div>
                      <h2>{titleCase(selectedSkill.name)}</h2>
                      <div className="skill-detail__slash">{selectedSkill.slashCommand}</div>
                    </div>
                    <div className="skill-detail__header-end">
                      <span className={`skill-detail__status ${selectedSkill.mode !== "off" ? "skill-detail__status--enabled" : ""}`}>
                        {skillModeLabel(selectedSkill.mode)}
                      </span>
                      <button
                        aria-label="Close detail panel"
                        className="skill-detail__close"
                        type="button"
                        onClick={() => setSelectedSkillPath(undefined)}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  </div>
                  <p className="skill-detail__description">{selectedSkill.description}</p>
                  <SkillModeControl
                    mode={selectedSkill.mode}
                    onChange={(mode) => onSetSkillMode(selectedSkill.filePath, mode)}
                  />
                  <SkillUsageStats usage={usageByPath[selectedSkill.filePath]} />
                  {selectedSkillModel ? (
                    <div className="skill-detail__tags">
                      {selectedSkillModel.tags.map((tag) => (
                        <span className="skill-tag" key={tag} title={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="skill-detail__command">
                    <div>
                      <div className="skill-detail__meta-label">Use</div>
                      <div className="skill-detail__command-token">{selectedSkill.slashCommand}</div>
                    </div>
                    <button className="button button--primary" type="button" onClick={() => onTrySkill(selectedSkill)}>
                      Try skill
                    </button>
                  </div>
                  <div className="skill-detail__meta-list">
                    <div>
                      <div className="skill-detail__meta-label">Source</div>
                      <div className="skill-detail__description">{selectedSkillModel?.sourceDetail ?? selectedSkill.source}</div>
                    </div>
                    <div>
                      <div className="skill-detail__meta-label">Category</div>
                      <div className="skill-detail__description">{selectedSkillModel?.categoryLabel ?? "Workflow"}</div>
                    </div>
                    <div>
                      <div className="skill-detail__meta-label">Path</div>
                      <div className="skill-detail__path">{selectedSkill.filePath}</div>
                    </div>
                  </div>
                  <div className="skill-detail__actions">
                    <button className="button button--secondary" type="button" onClick={() => onOpenSkillFolder(selectedSkill.filePath)}>
                      Open folder
                    </button>
                  </div>
                </>
              ) : (
                <SkillDetailPlaceholder title="Select a skill" body="Pick a card to inspect usage, tags, command details, and enablement." />
              )}
            </div>
          </div>
        </div>
        {profileDialog ? (
          <div className="action-dialog-backdrop" role="presentation">
            <section aria-label={profileDialog === "new" ? "New skill profile" : "Rename skill profile"} aria-modal="true" className="action-dialog" role="dialog">
              <h2>{profileDialog === "new" ? "New profile" : "Rename profile"}</h2>
              <label className="action-dialog__field">
                <span>Profile name</span>
                <input aria-label="Profile name" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
              </label>
              <label className="action-dialog__field">
                <span>Description</span>
                <input aria-label="Profile description" value={profileDescription} onChange={(event) => setProfileDescription(event.target.value)} />
              </label>
              <div className="action-dialog__actions">
                <button className="button button--secondary" type="button" onClick={() => setProfileDialog(undefined)}>Cancel</button>
                <button className="button button--primary" type="button" onClick={() => {
                  const name = profileName.trim();
                  if (!name) return;
                  const id = profileDialog === "rename" ? activeProfileId : slugifyProfileName(name);
                  onSaveProfile({
                    id,
                    name,
                    ...(profileDescription.trim() ? { description: profileDescription.trim() } : {}),
                    skills: profileDialog === "rename" ? activeProfile?.skills ?? {} : {},
                  });
                  setProfileDialog(undefined);
                }}>{profileDialog === "new" ? "Create profile" : "Save profile"}</button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function toSkillViewModel(skill: RuntimeSkillRecord, workspaceName: string): SkillViewModel {
  const category = inferSkillCategory(skill);
  return {
    skill,
    category,
    categoryLabel: categoryLabel(category),
    tags: inferSkillTags(skill, category),
    summary: summarizeSkill(skill.summary ?? skill.description),
    sourceLabel: sourceLabel(skill.source),
    sourceDetail: sourceDetail(skill.source, workspaceName),
  };
}

function inferSkillCategory(skill: RuntimeSkillRecord): SkillCategory {
  const explicitCategory = normalizeSkillCategory(skill.category);
  if (explicitCategory) return explicitCategory;
  const text = skillSearchText(skill);
  if (isCloudflareSkill(skill, text)) return "cloudflare";
  if (isPiDevelopmentSkill(skill, text)) return "pi";
  if (/\b(design|interface|frontend|ui|css|html|react|vue)\b/.test(text)) return "frontend";
  if (/\b(verify|verification|test|playwright|e2e|proof)\b/.test(text)) return "verification";
  if (/\b(plan|planning|spec|brainstorm|prd|task contract)\b/.test(text)) return "planning";
  if (/\b(review|critique|standards|pull request|pr)\b/.test(text)) return "review";
  if (/\b(debug|diagnos|bug|fix|regression|performance)\b/.test(text)) return "debug";
  if (/\b(doc|docs|readme|article|content|adr|writing|write)\b/.test(text)) return "docs";
  if (/\b(git|commit|branch|pr|pull request|merge)\b/.test(text)) return "git";
  if (/\b(code|codebase|architecture|refactor|api|sdk|implementation)\b/.test(text)) return "code";
  if (skill.source === "project") return "project";
  return "workflow";
}

function inferSkillTags(skill: RuntimeSkillRecord, category: SkillCategory): readonly string[] {
  const text = skillSearchText(skill);
  const tags = new Set<string>([categoryLabel(category), sourceTag(skill.source), ...(skill.tags ?? [])]);
  if (skill.disableModelInvocation) tags.add("Slash only");
  if (isCloudflareSkill(skill, text)) tags.add("Cloudflare");
  if (isPiDevelopmentSkill(skill, text)) tags.add("Pi dev");
  if (/\b(workers?|pages|r2|d1|kv|durable objects?|wrangler|vectorize|queues?|agents sdk)\b/.test(text)) tags.add("Edge");
  if (/\b(plan|workflow|handoff|process|session)\b/.test(text)) tags.add("Workflow");
  if (/\b(design|interface|frontend|ui|visual|react|css)\b/.test(text)) tags.add("Frontend");
  if (/\b(verify|verification|test|playwright|e2e|proof)\b/.test(text)) tags.add("Verify");
  if (/\b(plan|planning|spec|brainstorm|prd|task contract)\b/.test(text)) tags.add("Plan");
  if (/\b(review|critique|standards|pull request|pr)\b/.test(text)) tags.add("Review");
  if (/\b(debug|diagnos|bug|regression)\b/.test(text)) tags.add("Debug");
  if (/\b(doc|docs|readme|article|content|writing)\b/.test(text)) tags.add("Docs");
  if (/\b(git|commit|branch|pr|merge)\b/.test(text)) tags.add("Git");
  if (/\b(code|codebase|architecture|refactor|api|sdk)\b/.test(text)) tags.add("Code");
  return [...tags].slice(0, 6);
}

function skillSearchText(skill: RuntimeSkillRecord): string {
  return `${skill.name} ${skill.description} ${skill.summary ?? ""} ${skill.category ?? ""} ${(skill.tags ?? []).join(" ")} ${skill.slashCommand} ${skill.filePath} ${skill.baseDir}`.toLowerCase();
}

function isCloudflareSkill(skill: RuntimeSkillRecord, text: string): boolean {
  return skill.filePath.includes("cloudflare-skills") || /\b(cloudflare|workers?|wrangler|durable objects?|r2|d1|kv|vectorize|pages|queues?)\b/.test(text);
}

function isPiDevelopmentSkill(skill: RuntimeSkillRecord, text: string): boolean {
  return skill.filePath.includes("pi-agent-skills") || /^pi-/.test(skill.name) || /\b(pi-mono|pi coding agent|pi-coding-agent|@mariozechner\/pi|pi sdk|pi tui|pi extension|pi package|agent session)\b/.test(text);
}

function sourceTag(source: string): string {
  if (source === "project") return "Project";
  if (source === "user") return "User";
  return packageSourceName(source);
}

function sourceLabel(source: string): string {
  if (source === "project") return "Project-local skill";
  if (source === "user") return "User skill";
  return `Package: ${packageSourceName(source)}`;
}

function sourceDetail(source: string, workspaceName: string): string {
  if (source === "project") return `Project-local skill from ${workspaceName}`;
  if (source === "user") return "User-level skill available across projects";
  return `Installed package skill from ${packageSourceName(source)}`;
}

function packageSourceName(source: string): string {
  const withoutPrefix = source.replace(/^(git|npm):/, "");
  const withoutVersion = withoutPrefix.replace(/@[a-f0-9]{7,40}$/i, "");
  if (withoutVersion.includes("github.com/")) {
    const repoName = withoutVersion.split("/").filter(Boolean).at(-1);
    return repoName ? titleCase(repoName.replace(/\.git$/, "").replace(/[-_]+/g, " ")) : "Git package";
  }
  if (source.startsWith("npm:")) {
    return withoutPrefix.replace(/@[^/]+$/, "");
  }
  return withoutVersion.length > 28 ? `${withoutVersion.slice(0, 25).trimEnd()}...` : withoutVersion;
}

function normalizeSkillCategory(value: string | undefined): SkillCategory | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  return CATEGORY_FILTERS.some((filter) => filter.id === normalized) ? normalized as SkillCategory : undefined;
}

function categoryLabel(category: SkillCategory): string {
  return CATEGORY_FILTERS.find((filter) => filter.id === category)?.label ?? "Workflow";
}

function summarizeSkill(description: string): string {
  const normalized = description.trim().replace(/\s+/g, " ");
  const firstSentence = normalized.match(/^[^.!?]+[.!?]?/)?.[0]?.trim() ?? normalized;
  return firstSentence.length > 190 ? `${firstSentence.slice(0, 187).trimEnd()}...` : firstSentence;
}

function SkillModeControl({
  mode,
  compact = false,
  onChange,
}: {
  readonly mode: RuntimeSkillMode;
  readonly compact?: boolean;
  readonly onChange: (mode: RuntimeSkillMode) => void;
}) {
  return (
    <div className={compact ? "skill-mode-control skill-mode-control--compact" : "skill-mode-control"} aria-label="Skill mode">
      {(["auto", "manual", "off"] as const).map((option) => (
        <button
          aria-pressed={mode === option}
          className={`skill-mode-control__item${mode === option ? " skill-mode-control__item--active" : ""}`}
          key={option}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onChange(option);
          }}
        >
          {skillModeLabel(option)}
        </button>
      ))}
    </div>
  );
}

function skillModeLabel(mode: RuntimeSkillMode): string {
  switch (mode) {
    case "auto":
      return "Auto";
    case "manual":
      return "Manual";
    case "off":
      return "Off";
  }
}

function SkillUsageStats({ usage, compact = false }: { readonly usage?: SkillUsageRecord; readonly compact?: boolean }) {
  const count = usage?.count ?? 0;
  const countLabel = count === 1 ? "1 slash use" : `${count} slash uses`;
  const lastUsedLabel = usage?.lastUsedAt ? `Last used ${formatRelativeTime(usage.lastUsedAt)}` : "Never used";
  return (
    <span className={compact ? "skill-usage skill-usage--compact" : "skill-usage"}>
      <span>{countLabel}</span>
      <span>{lastUsedLabel}</span>
    </span>
  );
}

function slugifyProfileName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
}

function SkillDetailPlaceholder({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="skill-detail__placeholder">
      <div className="skill-detail__placeholder-icon"><SkillIcon /></div>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function SkillsEmptyState({ message }: { readonly message: string }) {
  return (
    <div className="empty-state">
      <h2>No skills found</h2>
      <p>{message}</p>
    </div>
  );
}
