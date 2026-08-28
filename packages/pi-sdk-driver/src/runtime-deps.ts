import { join, resolve } from "node:path";
import { ModelRuntime, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface RuntimeDependencyOptions {
  readonly agentDir?: string;
  readonly modelRuntime?: ModelRuntime;
}

export interface RuntimeDependencies {
  readonly agentDir: string;
  readonly getModelRuntime: () => Promise<ModelRuntime>;
  readonly reloadModelRuntime: () => Promise<ModelRuntime>;
}

export function createRuntimeDependencies(options: RuntimeDependencyOptions = {}): RuntimeDependencies {
  const agentDir = resolve(options.agentDir ?? getAgentDir());
  const createModelRuntime = () =>
    options.modelRuntime ? Promise.resolve(options.modelRuntime) : createCacheFirstModelRuntime(agentDir);
  let modelRuntime = createModelRuntime();
  return {
    agentDir,
    getModelRuntime: () => modelRuntime,
    reloadModelRuntime: async () => {
      if (options.modelRuntime) {
        await options.modelRuntime.refresh();
        return options.modelRuntime;
      }
      modelRuntime = createModelRuntime();
      return modelRuntime;
    },
  };
}

async function createCacheFirstModelRuntime(agentDir: string): Promise<ModelRuntime> {
  const previousOfflineValue = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "1";
  try {
    return await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
      allowModelNetwork: false,
    });
  } finally {
    if (previousOfflineValue === undefined) {
      delete process.env.PI_OFFLINE;
    } else {
      process.env.PI_OFFLINE = previousOfflineValue;
    }
  }
}
