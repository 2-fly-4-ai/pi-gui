import { useMemo, useState } from "react";
import type { RuntimeSkillRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { WorkspaceRecord } from "./desktop-state";
import { CloseIcon, RefreshIcon, SkillIcon } from "./icons";
import { titleCase } from "./string-utils";

type SkillCategory = "all" | "project" | "pi" | "cloudflare" | "frontend" | "code" | "docs" | "debug" | "git" | "workflow";

interface SkillViewModel {
  readonly skill: RuntimeSkillRecord;
  readonly category: SkillCategory;
  readonly categoryLabel: string;
  readonly tags: readonly string[];
  readonly summary: string;
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
  { id: "git", label: "Git" },
  { id: "workflow", label: "Workflow" },
];

interface SkillsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly onRefresh: () => void;
  readonly onOpenSkillFolder: (filePath: string) => void;
  readonly onToggleSkill: (filePath: string, enabled: boolean) => void;
  readonly onTrySkill: (skill: RuntimeSkillRecord) => void;
}

export function SkillsView({
  workspace,
  runtime,
  onRefresh,
  onOpenSkillFolder,
  onToggleSkill,
  onTrySkill,
}: SkillsViewProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SkillCategory>("all");
  const [selectedSkillPath, setSelectedSkillPath] = useState<string | undefined>();
  const skills = runtime?.skills ?? [];
  const skillModels = useMemo(() => skills.map(toSkillViewModel), [skills]);
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
            <h1 className="view-header__title">Skills</h1>
            <p className="view-header__body">
              Give pi workspace-specific capabilities and reusable workflows.
            </p>
          </div>
          <div className="view-header__actions">
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
                })
              }
            >
              New skill
            </button>
          </div>
        </header>

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
              <SkillsEmptyState message="Refresh discovery or create a new skill for this workspace." />
            ) : (
              filteredSkills.map((model) => (
                <button
                  className={`skill-card ${selectedSkill?.filePath === model.skill.filePath ? "skill-card--active" : ""}`}
                  key={model.skill.filePath}
                  type="button"
                  onClick={() => {
                    setSelectedSkillPath(
                      selectedSkillPath === model.skill.filePath ? undefined : model.skill.filePath
                    );
                  }}
                >
                  <span className="skill-card__title-row">
                    <span className="skill-card__title">{titleCase(model.skill.name)}</span>
                    <span className={`skill-card__badge ${model.skill.enabled ? "skill-card__badge--enabled" : ""}`}>
                      {model.skill.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </span>
                  <span className="skill-card__description">{model.summary}</span>
                  <span className="skill-card__tags">
                    {model.tags.slice(0, 3).map((tag) => (
                      <span className="skill-tag" key={tag}>{tag}</span>
                    ))}
                  </span>
                  <span className="skill-card__meta">
                    <span>{model.skill.source}</span>
                    <span>{model.skill.slashCommand}</span>
                    {model.skill.disableModelInvocation ? <span>slash only</span> : null}
                  </span>
                </button>
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
                      <span className={`skill-detail__status ${selectedSkill.enabled ? "skill-detail__status--enabled" : ""}`}>
                        {selectedSkill.enabled ? "Enabled" : "Disabled"}
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
                  {selectedSkillModel ? (
                    <div className="skill-detail__tags">
                      {selectedSkillModel.tags.map((tag) => (
                        <span className="skill-tag" key={tag}>{tag}</span>
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
                      <div className="skill-detail__description">{selectedSkill.source}</div>
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
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => onToggleSkill(selectedSkill.filePath, !selectedSkill.enabled)}
                    >
                      {selectedSkill.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function toSkillViewModel(skill: RuntimeSkillRecord): SkillViewModel {
  const category = inferSkillCategory(skill);
  return {
    skill,
    category,
    categoryLabel: categoryLabel(category),
    tags: inferSkillTags(skill, category),
    summary: summarizeSkill(skill.description),
  };
}

function inferSkillCategory(skill: RuntimeSkillRecord): SkillCategory {
  const text = skillSearchText(skill);
  if (isCloudflareSkill(skill, text)) return "cloudflare";
  if (isPiDevelopmentSkill(skill, text)) return "pi";
  if (/\b(design|interface|frontend|ui|css|html|react|vue)\b/.test(text)) return "frontend";
  if (/\b(debug|diagnos|bug|fix|regression|performance|verify|test)\b/.test(text)) return "debug";
  if (/\b(doc|docs|readme|article|content|adr|writing|write)\b/.test(text)) return "docs";
  if (/\b(git|commit|branch|pr|pull request|merge)\b/.test(text)) return "git";
  if (/\b(code|codebase|architecture|refactor|api|sdk|implementation)\b/.test(text)) return "code";
  if (skill.source === "project") return "project";
  return "workflow";
}

function inferSkillTags(skill: RuntimeSkillRecord, category: SkillCategory): readonly string[] {
  const text = skillSearchText(skill);
  const tags = new Set<string>([categoryLabel(category), sourceTag(skill.source)]);
  if (skill.disableModelInvocation) tags.add("Slash only");
  if (isCloudflareSkill(skill, text)) tags.add("Cloudflare");
  if (isPiDevelopmentSkill(skill, text)) tags.add("Pi dev");
  if (/\b(workers?|pages|r2|d1|kv|durable objects?|wrangler|vectorize|queues?|agents sdk)\b/.test(text)) tags.add("Edge");
  if (/\b(plan|workflow|handoff|process|session)\b/.test(text)) tags.add("Workflow");
  if (/\b(design|interface|frontend|ui|visual|react|css)\b/.test(text)) tags.add("Frontend");
  if (/\b(debug|diagnos|bug|regression|verify|test)\b/.test(text)) tags.add("Debug");
  if (/\b(doc|docs|readme|article|content|writing)\b/.test(text)) tags.add("Docs");
  if (/\b(git|commit|branch|pr|merge)\b/.test(text)) tags.add("Git");
  if (/\b(code|codebase|architecture|refactor|api|sdk)\b/.test(text)) tags.add("Code");
  return [...tags].slice(0, 6);
}

function skillSearchText(skill: RuntimeSkillRecord): string {
  return `${skill.name} ${skill.description} ${skill.slashCommand} ${skill.filePath} ${skill.baseDir}`.toLowerCase();
}

function isCloudflareSkill(skill: RuntimeSkillRecord, text: string): boolean {
  return skill.filePath.includes("cloudflare-skills") || /\b(cloudflare|workers?|wrangler|durable objects?|r2|d1|kv|vectorize|pages|queues?)\b/.test(text);
}

function isPiDevelopmentSkill(skill: RuntimeSkillRecord, text: string): boolean {
  return skill.filePath.includes("pi-agent-skills") || /^pi-/.test(skill.name) || /\b(pi-mono|pi coding agent|pi-coding-agent|@mariozechner\/pi|pi sdk|pi tui|pi extension|pi package|agent session)\b/.test(text);
}

function sourceTag(source: string): string {
  return source === "project" ? "Project" : source;
}

function categoryLabel(category: SkillCategory): string {
  return CATEGORY_FILTERS.find((filter) => filter.id === category)?.label ?? "Workflow";
}

function summarizeSkill(description: string): string {
  const normalized = description.trim().replace(/\s+/g, " ");
  const firstSentence = normalized.match(/^[^.!?]+[.!?]?/)?.[0]?.trim() ?? normalized;
  return firstSentence.length > 190 ? `${firstSentence.slice(0, 187).trimEnd()}...` : firstSentence;
}

function SkillsEmptyState({ message }: { readonly message: string }) {
  return (
    <div className="empty-state">
      <h2>No skills found</h2>
      <p>{message}</p>
    </div>
  );
}
