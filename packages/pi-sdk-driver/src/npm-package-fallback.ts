import {
  SessionManager,
  SettingsManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  type AgentSessionRuntime,
  type CreateAgentSessionOptions,
  type CreateAgentSessionRuntimeResult,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { SkillCatalogStore } from "./skill-catalog.js";

export function isGlobalNpmLookupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("npm root -g");
}

export function createSettingsManagerWithoutNpmPackages(current: SettingsManager): SettingsManager | null {
  const globalSettings = current.getGlobalSettings() as Record<string, unknown>;
  const projectSettings = current.getProjectSettings() as Record<string, unknown>;
  const nextGlobalPackages = filterOutNpmPackageSources(globalSettings.packages);
  const nextProjectPackages = filterOutNpmPackageSources(projectSettings.packages);

  const globalChanged = nextGlobalPackages !== globalSettings.packages;
  const projectChanged = nextProjectPackages !== projectSettings.packages;
  if (!globalChanged && !projectChanged) {
    return null;
  }

  const nextGlobalSettings = globalChanged ? { ...globalSettings, packages: nextGlobalPackages } : globalSettings;
  const nextProjectSettings = projectChanged ? { ...projectSettings, packages: nextProjectPackages } : projectSettings;
  return SettingsManager.fromStorage({
    withLock(scope, fn) {
      const currentJson =
        scope === "global"
          ? JSON.stringify(nextGlobalSettings)
          : JSON.stringify(nextProjectSettings);
      fn(currentJson);
    },
  });
}

async function createAgentSessionServicesWithNpmFallback(
  cwd: string,
  agentDir: string,
  options?: Pick<CreateAgentSessionOptions, "authStorage" | "settingsManager" | "modelRegistry">,
  skillCatalog?: SkillCatalogStore,
) {
  try {
    if (skillCatalog) {
      await skillCatalog.reload();
    }
    return await createAgentSessionServices({
      cwd,
      agentDir,
      ...(options?.authStorage ? { authStorage: options.authStorage } : {}),
      ...(options?.settingsManager ? { settingsManager: options.settingsManager } : {}),
      ...(options?.modelRegistry ? { modelRegistry: options.modelRegistry } : {}),
      ...(skillCatalog ? { resourceLoaderOptions: createSkillCatalogResourceLoaderOptions(skillCatalog) } : {}),
    });
  } catch (error) {
    if (!isGlobalNpmLookupError(error)) {
      throw error;
    }

    const currentSettingsManager = options?.settingsManager ?? SettingsManager.create(cwd, agentDir);
    const fallbackSettingsManager = createSettingsManagerWithoutNpmPackages(currentSettingsManager);
    if (!fallbackSettingsManager) {
      throw error;
    }

    console.warn(
      `[pi-gui] Falling back to session resource loading without npm package sources for ${cwd}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return createAgentSessionServices({
      cwd,
      agentDir,
      ...(options?.authStorage ? { authStorage: options.authStorage } : {}),
      settingsManager: fallbackSettingsManager,
      ...(options?.modelRegistry ? { modelRegistry: options.modelRegistry } : {}),
      ...(skillCatalog ? { resourceLoaderOptions: createSkillCatalogResourceLoaderOptions(skillCatalog) } : {}),
    });
  }
}

async function createAgentSessionResultWithNpmFallback(
  cwd: string,
  agentDir: string,
  sessionManager: SessionManager,
  options?: CreateAgentSessionOptions,
  skillCatalog?: SkillCatalogStore,
): Promise<CreateAgentSessionRuntimeResult> {
  const services = await createAgentSessionServicesWithNpmFallback(cwd, agentDir, options, skillCatalog);
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(options?.sessionStartEvent ? { sessionStartEvent: options.sessionStartEvent } : {}),
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
      ...(options?.scopedModels ? { scopedModels: options.scopedModels } : {}),
      ...(options?.tools ? { tools: options.tools } : {}),
      ...(options?.customTools ? { customTools: options.customTools } : {}),
    })),
    services,
    diagnostics: services.diagnostics,
  };
}

export async function createAgentSessionWithNpmFallback(options?: CreateAgentSessionOptions) {
  const cwd = options?.cwd ?? process.cwd();
  const agentDir = options?.agentDir ?? getAgentDir();
  const sessionManager = options?.sessionManager ?? SessionManager.create(cwd);
  return createAgentSessionResultWithNpmFallback(cwd, agentDir, sessionManager, options);
}

function createSkillCatalogResourceLoaderOptions(skillCatalog: SkillCatalogStore) {
  return {
    skillsOverride: (base: { skills: Skill[]; diagnostics: any[] }) => ({
      skills: skillCatalog.applyToSkills(base.skills),
      diagnostics: base.diagnostics,
    }),
  };
}

export async function createAgentSessionRuntimeWithNpmFallback(
  options?: CreateAgentSessionOptions,
  skillCatalogFilePath?: string,
): Promise<AgentSessionRuntime> {
  const cwd = options?.cwd ?? process.cwd();
  const agentDir = options?.agentDir ?? getAgentDir();
  const initialSessionManager = options?.sessionManager ?? SessionManager.create(cwd);
  const {
    cwd: _optionCwd,
    agentDir: _optionAgentDir,
    sessionManager: _optionSessionManager,
    sessionStartEvent: _optionSessionStartEvent,
    model: initialModel,
    thinkingLevel: initialThinkingLevel,
    ...stableOptions
  } = options ?? {};
  const skillCatalog = skillCatalogFilePath ? new SkillCatalogStore(skillCatalogFilePath) : undefined;
  let useInitialSessionOptions = true;
  return createAgentSessionRuntime(
    ({ cwd: runtimeCwd, agentDir: runtimeAgentDir, sessionManager, sessionStartEvent }) => {
      const includeInitialSessionOptions = useInitialSessionOptions;
      useInitialSessionOptions = false;
      return createAgentSessionResultWithNpmFallback(runtimeCwd, runtimeAgentDir, sessionManager, {
        ...stableOptions,
        cwd: runtimeCwd,
        agentDir: runtimeAgentDir,
        sessionManager,
        ...(sessionStartEvent ? { sessionStartEvent } : {}),
        ...(includeInitialSessionOptions && initialModel ? { model: initialModel } : {}),
        ...(includeInitialSessionOptions && initialThinkingLevel ? { thinkingLevel: initialThinkingLevel } : {}),
      }, skillCatalog);
    },
    {
      cwd,
      agentDir,
      sessionManager: initialSessionManager,
      ...(options?.sessionStartEvent ? { sessionStartEvent: options.sessionStartEvent } : {}),
    },
  );
}

function filterOutNpmPackageSources(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const filtered = value.filter((entry) => !isNpmPackageSource(entry));
  return filtered.length === value.length ? value : filtered;
}

function isNpmPackageSource(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().startsWith("npm:");
  }

  if (typeof value !== "object" || value === null || !("source" in value)) {
    return false;
  }

  return typeof value.source === "string" && value.source.trim().startsWith("npm:");
}
