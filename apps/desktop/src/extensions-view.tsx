import { useMemo, useState } from "react";
import type { RuntimeExtensionRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ExtensionCommandCompatibilityRecord, WorkspaceRecord } from "./desktop-state";
import { CloseIcon, RefreshIcon } from "./icons";

interface ExtensionGroup {
  readonly id: string;
  readonly displayName: string;
  readonly sourceInfo: RuntimeExtensionRecord["sourceInfo"];
  readonly extensions: readonly RuntimeExtensionRecord[];
  readonly enabledCount: number;
  readonly commands: readonly string[];
  readonly tools: readonly string[];
  readonly flags: readonly string[];
  readonly shortcuts: readonly string[];
  readonly diagnostics: RuntimeExtensionRecord["diagnostics"];
}

interface ExtensionsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly commandCompatibility?: readonly ExtensionCommandCompatibilityRecord[];
  readonly onRefresh: () => void;
  readonly onOpenExtensionFolder: (filePath: string) => void;
  readonly onToggleExtension: (filePath: string, enabled: boolean) => void;
}

export function ExtensionsView({
  workspace,
  runtime,
  commandCompatibility = [],
  onRefresh,
  onOpenExtensionFolder,
  onToggleExtension,
}: ExtensionsViewProps) {
  const [query, setQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>();
  const extensions = runtime?.extensions ?? [];
  const extensionGroups = useMemo(() => groupExtensions(extensions), [extensions]);
  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return extensionGroups;
    }

    return extensionGroups.filter((group) =>
      [
        group.displayName,
        group.sourceInfo.source,
        group.sourceInfo.scope,
        group.sourceInfo.origin,
        group.sourceInfo.baseDir ?? "",
        ...group.extensions.map((extension) => extension.path),
        ...group.commands,
        ...group.tools,
        ...group.flags,
        ...group.shortcuts,
        ...group.diagnostics.map((diagnostic) => diagnostic.message),
      ].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [extensionGroups, query]);
  const selectedGroup = filteredGroups.find((group) => group.id === selectedGroupId);
  const isPanelOpen = !!selectedGroup;
  const selectedCompatibilityRecords = useMemo(
    () =>
      selectedGroup
        ? commandCompatibility
            .filter((record) => selectedGroup.extensions.some((extension) => extension.path === record.extensionPath))
            .sort((left, right) => left.commandName.localeCompare(right.commandName))
        : [],
    [commandCompatibility, selectedGroup],
  );

  if (!workspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">Extensions</div>
          <h1>Select a workspace</h1>
          <p>Extensions are discovered from the selected workspace plus your user-level extension directories.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas">
      <div className="conversation skills-view">
        <header className="view-header">
          <div>
            <div className="chat-header__eyebrow">Extensions</div>
            <h1 className="view-header__title">Extensions</h1>
            <p className="view-header__body">
              Inspect and manage first-class runtime extensions for this workspace.
            </p>
          </div>
          <div className="view-header__actions">
            <button className="button button--secondary" type="button" onClick={onRefresh}>
              <RefreshIcon />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        <div className="skills-toolbar">
          <input
            aria-label="Search extensions"
            className="skills-search"
            placeholder="Search extensions"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>

        <div className={`skills-layout ${isPanelOpen ? "skills-layout--panel-open" : ""}`}>
          <div className="skills-grid" data-testid="extensions-list">
            {filteredGroups.length === 0 ? (
              <ExtensionsEmptyState message="Refresh runtime discovery to load workspace and user-level extensions." />
            ) : (
              filteredGroups.map((group) => (
                <div
                  className={`skill-card ${selectedGroup?.id === group.id ? "skill-card--active" : ""}`}
                  key={group.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedGroupId(selectedGroupId === group.id ? undefined : group.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setSelectedGroupId(selectedGroupId === group.id ? undefined : group.id);
                  }}
                >
                  <span className="skill-card__title-row">
                    <span className="skill-card__title">{group.displayName}</span>
                    <span className={`skill-card__badge ${group.enabledCount > 0 ? "skill-card__badge--enabled" : ""}`}>
                      {formatGroupEnabledLabel(group)}
                    </span>
                  </span>
                  <span className="skill-card__description">
                    {group.sourceInfo.scope} · {group.sourceInfo.origin}
                  </span>
                  <span className="skill-card__meta">
                    <span>{group.sourceInfo.source}</span>
                    {group.extensions.length > 1 ? <span>{group.extensions.length} entries</span> : null}
                    {group.commands.length > 0 ? <span>{group.commands.length} commands</span> : null}
                    {group.tools.length > 0 ? <span>{group.tools.length} tools</span> : null}
                    {group.diagnostics.length > 0 ? <span>{group.diagnostics.length} issues</span> : null}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="skill-detail-wrap">
            <div className="skill-detail">
              {selectedGroup ? (
                <>
                  <div className="skill-detail__header">
                    <div>
                      <h2>{selectedGroup.displayName}</h2>
                      <div className="skill-detail__slash">{selectedGroup.sourceInfo.source}</div>
                    </div>
                    <div className="skill-detail__header-end">
                      <span className={`skill-detail__status ${selectedGroup.enabledCount > 0 ? "skill-detail__status--enabled" : ""}`}>
                        {formatGroupEnabledLabel(selectedGroup)}
                      </span>
                      <button
                        aria-label="Close detail panel"
                        className="skill-detail__close"
                        type="button"
                        onClick={() => setSelectedGroupId(undefined)}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  </div>
                  <div className="skill-detail__meta-list">
                    <DetailItem label="Scope" value={selectedGroup.sourceInfo.scope} />
                    <DetailItem label="Origin" value={selectedGroup.sourceInfo.origin} />
                    {selectedGroup.sourceInfo.baseDir ? (
                      <DetailItem label="Base dir" value={selectedGroup.sourceInfo.baseDir} mono />
                    ) : null}
                  </div>
                  <div className="skill-detail__actions">
                    <button className="button button--secondary" type="button" onClick={() => onOpenExtensionFolder(selectedGroup.sourceInfo.baseDir ?? selectedGroup.extensions[0]?.path ?? "")}>
                      Open folder
                    </button>
                  </div>

                  <ExtensionEntrypoints extensions={selectedGroup.extensions} onToggleExtension={onToggleExtension} />
                  <ExtensionContributionSection title="Commands" items={selectedGroup.commands} emptyLabel="No commands contributed." />
                  <ExtensionCompatibilitySection
                    commands={selectedGroup.commands}
                    compatibilityRecords={selectedCompatibilityRecords}
                  />
                  <ExtensionContributionSection title="Tools" items={selectedGroup.tools} emptyLabel="No tools contributed." />
                  <ExtensionContributionSection title="Flags" items={selectedGroup.flags} emptyLabel="No flags contributed." />
                  <ExtensionContributionSection title="Shortcuts" items={selectedGroup.shortcuts} emptyLabel="No shortcuts contributed." />
                  <ExtensionDiagnostics diagnostics={selectedGroup.diagnostics} />
                </>
              ) : (
                <ExtensionDetailPlaceholder />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function groupExtensions(extensions: readonly RuntimeExtensionRecord[]): readonly ExtensionGroup[] {
  const groups = new Map<string, RuntimeExtensionRecord[]>();
  for (const extension of extensions) {
    const key = extension.sourceInfo.baseDir
      ? `${extension.sourceInfo.scope}:${extension.sourceInfo.origin}:${extension.sourceInfo.baseDir}`
      : `${extension.sourceInfo.scope}:${extension.sourceInfo.origin}:${extension.sourceInfo.source}`;
    const existing = groups.get(key) ?? [];
    existing.push(extension);
    groups.set(key, existing);
  }

  return [...groups.entries()]
    .map(([id, groupExtensions]) => {
      const sortedExtensions = [...groupExtensions].sort((left, right) => left.path.localeCompare(right.path));
      const first = sortedExtensions[0];
      if (!first) {
        throw new Error("Extension group unexpectedly empty");
      }
      return {
        id,
        displayName: first.displayName,
        sourceInfo: first.sourceInfo,
        extensions: sortedExtensions,
        enabledCount: sortedExtensions.filter((extension) => extension.enabled).length,
        commands: uniqueSorted(sortedExtensions.flatMap((extension) => extension.commands)),
        tools: uniqueSorted(sortedExtensions.flatMap((extension) => extension.tools)),
        flags: uniqueSorted(sortedExtensions.flatMap((extension) => extension.flags)),
        shortcuts: uniqueSorted(sortedExtensions.flatMap((extension) => extension.shortcuts)),
        diagnostics: sortedExtensions.flatMap((extension) => extension.diagnostics),
      } satisfies ExtensionGroup;
    })
    .sort((left, right) =>
      left.displayName === right.displayName
        ? left.sourceInfo.source.localeCompare(right.sourceInfo.source)
        : left.displayName.localeCompare(right.displayName),
    );
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function formatGroupEnabledLabel(group: ExtensionGroup): string {
  if (group.enabledCount === group.extensions.length) {
    return "Enabled";
  }
  if (group.enabledCount === 0) {
    return "Disabled";
  }
  return `${group.enabledCount}/${group.extensions.length} enabled`;
}

function DetailItem({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <div className="skill-detail__meta-label">{label}</div>
      <div className={mono ? "skill-detail__path" : "skill-detail__description"}>{value}</div>
    </div>
  );
}

function ExtensionEntrypoints({
  extensions,
  onToggleExtension,
}: {
  readonly extensions: readonly RuntimeExtensionRecord[];
  readonly onToggleExtension: (filePath: string, enabled: boolean) => void;
}) {
  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">Entries</div>
        <div className="extension-entrypoints">
          {extensions.map((extension) => (
            <div className="extension-entrypoint" key={extension.path}>
              <div className="extension-entrypoint__main">
                <span className="extension-entrypoint__path">{extension.path}</span>
                <span className="extension-entrypoint__meta">
                  {extension.commands.length > 0 ? `${extension.commands.length} commands` : "No commands"}
                  {extension.tools.length > 0 ? ` · ${extension.tools.length} tools` : ""}
                </span>
              </div>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => onToggleExtension(extension.path, !extension.enabled)}
              >
                {extension.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExtensionContributionSection({
  title,
  items,
  emptyLabel,
}: {
  readonly title: string;
  readonly items: readonly string[];
  readonly emptyLabel: string;
}) {
  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">{title}</div>
        {items.length > 0 ? (
          <div className="extension-detail__tokens">
            {items.map((item) => (
              <span className="slash-menu__skill-badge" key={item}>
                {item}
              </span>
            ))}
          </div>
        ) : (
          <div className="skill-detail__description">{emptyLabel}</div>
        )}
      </div>
    </div>
  );
}

function ExtensionDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: RuntimeExtensionRecord["diagnostics"];
}) {
  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">Diagnostics</div>
        {diagnostics.length > 0 ? (
          <div className="extension-detail__diagnostics">
            {diagnostics.map((diagnostic, index) => (
              <div className={`activity-item activity-item--${diagnostic.type === "error" ? "error" : "info"}`} key={`${diagnostic.message}:${index}`}>
                <div className="activity-item__text">{diagnostic.message}</div>
                {diagnostic.path ? <div className="activity-item__meta">{diagnostic.path}</div> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="skill-detail__description">No diagnostics reported.</div>
        )}
      </div>
    </div>
  );
}

function ExtensionCompatibilitySection({
  commands,
  compatibilityRecords,
}: {
  readonly commands: readonly string[];
  readonly compatibilityRecords: readonly ExtensionCommandCompatibilityRecord[];
}) {
  const supported = compatibilityRecords.filter((record) => record.status === "supported");
  const terminalOnly = compatibilityRecords.filter((record) => record.status === "terminal-only");
  const unknown = commands.filter((commandName) =>
    compatibilityRecords.every(
      (record) => record.commandName !== commandName && !record.commandName.startsWith(`${commandName}:`),
    ),
  );

  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">Command compatibility</div>
        <div className="skill-detail__description">
          Learned from real GUI execution. Unlisted commands remain unknown until exercised.
        </div>
        <div className="extension-detail__tokens">
          {supported.map((record) => (
            <span className="slash-menu__skill-badge" key={`supported:${record.commandName}`}>
              {record.commandName} · GUI-compatible
            </span>
          ))}
          {terminalOnly.map((record) => (
            <span className="slash-menu__skill-badge slash-menu__skill-badge--warning" key={`terminal:${record.commandName}`}>
              {record.commandName} · Terminal-only
            </span>
          ))}
          {unknown.map((commandName) => (
            <span className="slash-menu__skill-badge" key={`unknown:${commandName}`}>
              {commandName} · Unknown
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExtensionDetailPlaceholder() {
  return (
    <div className="skill-detail__placeholder">
      <h2>Select an extension</h2>
      <p>Pick a card to inspect entrypoints, commands, tools, diagnostics, and enablement.</p>
    </div>
  );
}

function ExtensionsEmptyState({ message }: { readonly message: string }) {
  return (
    <div className="empty-state">
      <h2>No extensions found</h2>
      <p>{message}</p>
    </div>
  );
}
