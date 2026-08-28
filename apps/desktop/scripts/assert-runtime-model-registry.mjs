import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const runtime = await ModelRuntime.create({ modelsPath: null });
const currentCodexModels = runtime
  .getModels("openai-codex")
  .filter((model) => /^gpt-5\.6-/.test(model.id));

if (currentCodexModels.length < 3) {
  throw new Error("Bundled Pi runtime does not expose the current openai-codex GPT-5.6 model family.");
}

const incompleteModel = currentCodexModels.find(
  (model) =>
    !model.reasoning
    || !model.input.includes("image")
    || model.thinkingLevelMap?.max !== "max",
);
if (incompleteModel) {
  throw new Error(
    `Bundled ${incompleteModel.provider}/${incompleteModel.id} is missing reasoning, image input, or max reasoning support.`,
  );
}

console.log(
  `Verified bundled Pi runtime exposes current Codex models: ${currentCodexModels.map((model) => model.id).join(", ")}.`,
);
