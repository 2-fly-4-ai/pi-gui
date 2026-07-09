import { useEffect, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { DesktopCustomInstructionsRecord, DiagnosticReportingPreferences, ModelSettingsScopeMode } from "./desktop-state";
import { SettingsGroup, SettingsInfoRow, SettingsRow } from "./settings-utils";

interface SettingsGeneralSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly integratedTerminalShell: string;
  readonly desktopCustomInstructions: DesktopCustomInstructionsRecord;
  readonly diagnosticReporting: DiagnosticReportingPreferences;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onSetDesktopCustomInstructions: (input: Partial<DesktopCustomInstructionsRecord>) => void;
  readonly onSetDiagnosticReportingPreferences: (input: Partial<DiagnosticReportingPreferences>) => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
}

export function SettingsGeneralSection({
  runtime,
  modelSettingsScopeMode,
  integratedTerminalShell,
  desktopCustomInstructions,
  diagnosticReporting,
  onSetModelSettingsScopeMode,
  onSetIntegratedTerminalShell,
  onSetDesktopCustomInstructions,
  onSetDiagnosticReportingPreferences,
  onToggleSkillCommands,
}: SettingsGeneralSectionProps) {
  const connectedCount = runtime?.providers.filter((p) => p.hasAuth).length ?? 0;
  const [terminalShellDraft, setTerminalShellDraft] = useState(integratedTerminalShell);
  const [customInstructionsDraft, setCustomInstructionsDraft] = useState(desktopCustomInstructions.text);

  useEffect(() => {
    setTerminalShellDraft(integratedTerminalShell);
  }, [integratedTerminalShell]);

  useEffect(() => {
    setCustomInstructionsDraft(desktopCustomInstructions.text);
  }, [desktopCustomInstructions.text]);

  const commitTerminalShellDraft = () => {
    if (terminalShellDraft !== integratedTerminalShell) {
      onSetIntegratedTerminalShell(terminalShellDraft);
    }
  };

  const commitCustomInstructionsDraft = () => {
    if (customInstructionsDraft !== desktopCustomInstructions.text) {
      onSetDesktopCustomInstructions({ text: customInstructionsDraft });
    }
  };

  return (
    <>
      <SettingsGroup>
        <SettingsInfoRow
          label="Connected providers"
          value={connectedCount > 0 ? String(connectedCount) : "None"}
        />
        <SettingsInfoRow label="Discovered skills" value={String(runtime?.skills.length ?? 0)} />
        <SettingsRow title="Model settings scope" description="Choose whether model defaults apply everywhere or per repo.">
          <div className="settings-pill-row">
            <button
              className={`settings-pill${modelSettingsScopeMode === "app-global" ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={modelSettingsScopeMode === "app-global"}
              onClick={() => onSetModelSettingsScopeMode("app-global")}
            >
              App global
            </button>
            <button
              className={`settings-pill${modelSettingsScopeMode === "per-repo" ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={modelSettingsScopeMode === "per-repo"}
              onClick={() => onSetModelSettingsScopeMode("per-repo")}
            >
              Per repo
            </button>
          </div>
        </SettingsRow>
        <SettingsRow title="Enable skill slash commands" description="Keep skill slash commands available in the composer.">
          <input
            aria-label="Enable skill slash commands"
            checked={runtime?.settings.enableSkillCommands ?? true}
            type="checkbox"
            onChange={(event) => onToggleSkillCommands(event.target.checked)}
          />
        </SettingsRow>
        <SettingsRow title="Shell of integrated terminal" description="Leave blank to use your default login shell.">
          <input
            aria-label="Shell of integrated terminal"
            className="settings-text-input"
            placeholder="/bin/zsh"
            spellCheck={false}
            type="text"
            value={terminalShellDraft}
            onBlur={commitTerminalShellDraft}
            onChange={(event) => setTerminalShellDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Diagnostics">
        <SettingsRow
          title="Enable diagnostic issue drafts"
          description="Allow App Logs to prefill a redacted GitHub issue. Nothing is sent automatically."
        >
          <input
            aria-label="Enable diagnostic issue drafts"
            checked={diagnosticReporting.issueDraftsEnabled}
            type="checkbox"
            onChange={(event) =>
              onSetDiagnosticReportingPreferences({
                issueDraftsEnabled: event.target.checked,
                onboardingDismissed: true,
              })
            }
          />
        </SettingsRow>
        <SettingsRow
          title="Enable local native crash reports"
          description="Allow Electron to save local native crash artifacts for App Logs. Uploads stay off."
        >
          <input
            aria-label="Enable local native crash reports"
            checked={diagnosticReporting.nativeCrashReportsEnabled}
            type="checkbox"
            onChange={(event) =>
              onSetDiagnosticReportingPreferences({
                nativeCrashReportsEnabled: event.target.checked,
                onboardingDismissed: true,
              })
            }
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Desktop custom instructions">
        <SettingsRow
          title="Use desktop custom instructions"
          description="Append these instructions only to sessions launched from the desktop app. This does not edit ~/.pi/agent/APPEND_SYSTEM.md."
        >
          <input
            aria-label="Use desktop custom instructions"
            checked={desktopCustomInstructions.enabled}
            type="checkbox"
            onChange={(event) => onSetDesktopCustomInstructions({ enabled: event.target.checked })}
          />
        </SettingsRow>
        <SettingsRow
          title="Instructions"
          description="Keep this short. These instructions are appended after Pi's normal system prompt sources for new desktop sessions."
        >
          <textarea
            aria-label="Desktop custom instructions"
            className="settings-textarea"
            disabled={!desktopCustomInstructions.enabled}
            placeholder={"Conversation style:\n\n- Keep answers short and concise."}
            spellCheck={false}
            value={customInstructionsDraft}
            onBlur={commitCustomInstructionsDraft}
            onChange={(event) => setCustomInstructionsDraft(event.target.value)}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Shortcuts">
        <SettingsInfoRow label="New thread" value="Cmd+Shift+O" />
        <SettingsInfoRow label="Open settings" value="Cmd+," />
        <SettingsInfoRow label="Toggle terminal" value="Cmd+J" />
        <SettingsInfoRow label="New terminal tab" value="Cmd+T" />
        <SettingsInfoRow label="Send message" value="Enter" />
        <SettingsInfoRow label="New line" value="Shift+Enter" />
      </SettingsGroup>
    </>
  );
}
