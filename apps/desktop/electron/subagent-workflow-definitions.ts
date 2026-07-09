import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import {
  builtinSubagentWorkflowRecords,
  workflowById,
  type DeleteSubagentWorkflowInput,
  type SaveSubagentWorkflowInput,
  type SubagentWorkflowRecord,
  type SubagentWorkflowScope,
  type SubagentWorkflowSnapshot,
  type SubagentWorkflowTemplate,
} from "../src/subagent-workflows";

type FrontmatterRecord = Record<string, string>;

export async function listSubagentWorkflows(workspacePath: string | undefined): Promise<SubagentWorkflowSnapshot> {
  const globalWorkflowsDir = join(resolveAgentDir(), "workflows");
  const projectWorkflowsDir = workspacePath ? join(workspacePath, ".pi", "workflows") : undefined;
  const globalRecords = await readWorkflowDir(globalWorkflowsDir, "global");
  const projectRecords = projectWorkflowsDir ? await readWorkflowDir(projectWorkflowsDir, "project") : [];
  const merged = new Map<string, SubagentWorkflowRecord>();

  for (const workflow of builtinSubagentWorkflowRecords()) {
    merged.set(workflow.id, workflow);
  }
  for (const workflow of globalRecords) {
    merged.set(workflow.id, workflow);
  }
  for (const workflow of projectRecords) {
    merged.set(workflow.id, workflow);
  }

  return {
    globalWorkflowsDir,
    ...(projectWorkflowsDir ? { projectWorkflowsDir } : {}),
    workflows: [...merged.values()].sort(compareWorkflowRecords),
  };
}

export async function saveSubagentWorkflow(
  workspacePath: string | undefined,
  input: SaveSubagentWorkflowInput,
): Promise<SubagentWorkflowSnapshot> {
  validateSaveInput(input);
  const dir = resolveScopeDir(workspacePath, input.scope);
  const path = safeWorkflowPath(dir, input.workflow.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path, serializeWorkflow(input.workflow), "utf8");
  return listSubagentWorkflows(workspacePath);
}

export async function deleteSubagentWorkflow(
  workspacePath: string | undefined,
  input: DeleteSubagentWorkflowInput,
): Promise<SubagentWorkflowSnapshot> {
  validateScope(input.scope);
  safeWorkflowPath("/tmp", input.id);
  const dir = resolveScopeDir(workspacePath, input.scope);
  await rm(safeWorkflowPath(dir, input.id), { force: true });
  return listSubagentWorkflows(workspacePath);
}

export async function resolveSubagentWorkflow(
  workspacePath: string | undefined,
  id: string,
): Promise<SubagentWorkflowTemplate> {
  const workflow = (await listSubagentWorkflows(workspacePath)).workflows.find((entry) => entry.id === id);
  if (!workflow) {
    throw new Error(`Unknown subagent workflow: ${id}`);
  }
  return workflow;
}

function resolveAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ? resolve(process.env.PI_CODING_AGENT_DIR) : join(homedir(), ".pi", "agent");
}

function resolveScopeDir(workspacePath: string | undefined, scope: SubagentWorkflowScope): string {
  if (scope === "global") {
    return join(resolveAgentDir(), "workflows");
  }
  if (!workspacePath) {
    throw new Error("Project workflow settings require a workspace.");
  }
  return join(workspacePath, ".pi", "workflows");
}

function safeWorkflowPath(dir: string, id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error(`Invalid workflow ID: ${id}`);
  }
  const resolvedDir = resolve(dir);
  const resolvedPath = resolve(resolvedDir, `${id}.md`);
  if (!resolvedPath.startsWith(resolvedDir + sep)) {
    throw new Error("Workflow path escapes workflow directory.");
  }
  return resolvedPath;
}

async function readWorkflowDir(dir: string, scope: SubagentWorkflowScope): Promise<SubagentWorkflowRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const records: SubagentWorkflowRecord[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".md")).sort()) {
    const id = basename(entry, ".md");
    const path = safeWorkflowPath(dir, id);
    try {
      const raw = await readFile(path, "utf8");
      records.push(toWorkflowRecord(parseWorkflowDefinition(id, raw), scope, path, []));
    } catch (error) {
      records.push(toWorkflowRecord(fallbackWorkflow(id), scope, path, [error instanceof Error ? error.message : String(error)]));
    }
  }
  return records;
}

function parseWorkflowDefinition(id: string, raw: string): SubagentWorkflowTemplate {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontmatter = match ? parseFrontmatter(match[1] ?? "") : {};
  const body = match ? (match[2] ?? "").trim() : raw.trim();
  const title = frontmatter.title?.trim() || titleFromId(id);
  const description = frontmatter.description?.trim() || body || title;
  const roles = parseWorkflowList(frontmatter.roles);
  const artifacts = parseWorkflowList(frontmatter.artifacts);
  if (roles.length === 0) {
    throw new Error("Workflow roles must include at least one role.");
  }
  return {
    id,
    title,
    description,
    roles,
    artifacts,
  };
}

function parseFrontmatter(source: string): FrontmatterRecord {
  const result: FrontmatterRecord = {};
  for (const line of source.split("\n")) {
    if (/^\s/.test(line)) continue;
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    if (!key) continue;
    result[key] = parseFrontmatterString(rawValue);
  }
  return result;
}

function parseWorkflowList(value: string | undefined): readonly string[] {
  if (!value) return [];
  return value
    .split(/(?:\s*->\s*|,)/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function serializeWorkflow(workflow: SubagentWorkflowTemplate): string {
  return [
    "---",
    `title: ${quoteFrontmatterString(workflow.title)}`,
    `description: ${quoteFrontmatterString(workflow.description)}`,
    `roles: ${workflow.roles.join(" -> ")}`,
    `artifacts: ${workflow.artifacts.join(", ")}`,
    "---",
    "",
  ].join("\n");
}

function toWorkflowRecord(
  workflow: SubagentWorkflowTemplate,
  scope: SubagentWorkflowScope,
  path: string,
  warnings: readonly string[],
): SubagentWorkflowRecord {
  const overridden = isBuiltinWorkflow(workflow.id);
  return {
    ...workflow,
    source: scope,
    scope,
    path,
    builtin: overridden,
    overridden,
    warnings,
  };
}

function fallbackWorkflow(id: string): SubagentWorkflowTemplate {
  const builtin = maybeBuiltinWorkflow(id);
  return builtin ?? {
    id,
    title: titleFromId(id),
    description: id,
    roles: [],
    artifacts: [],
  };
}

function maybeBuiltinWorkflow(id: string): SubagentWorkflowTemplate | undefined {
  try {
    return workflowById(id);
  } catch {
    return undefined;
  }
}

function isBuiltinWorkflow(id: string): boolean {
  return maybeBuiltinWorkflow(id) !== undefined;
}

function validateSaveInput(input: SaveSubagentWorkflowInput): void {
  validateScope(input.scope);
  safeWorkflowPath("/tmp", input.workflow.id);
  if (!input.workflow.title.trim() || input.workflow.title.length > 200) {
    throw new Error("Workflow title must be 1-200 characters.");
  }
  if (!input.workflow.description.trim() || input.workflow.description.length > 1_000) {
    throw new Error("Workflow description must be 1-1000 characters.");
  }
  if (input.workflow.roles.length === 0) {
    throw new Error("Workflow must include at least one role.");
  }
  for (const role of input.workflow.roles) {
    validateListScalar(role, "role");
  }
  for (const artifact of input.workflow.artifacts) {
    validateListScalar(artifact, "artifact");
  }
}

function validateScope(scope: string): asserts scope is SubagentWorkflowScope {
  if (scope !== "global" && scope !== "project") throw new Error("Invalid workflow scope.");
}

function validateListScalar(value: string, label: string): void {
  if (!value.trim() || /[\r\n,]/.test(value) || value.includes("---")) {
    throw new Error(`Invalid workflow ${label}.`);
  }
}

function parseFrontmatterString(value: string): string {
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value.replace(/^"|"$/g, "");
    }
  }
  return value;
}

function quoteFrontmatterString(value: string): string {
  return JSON.stringify(value);
}

function titleFromId(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compareWorkflowRecords(left: SubagentWorkflowRecord, right: SubagentWorkflowRecord): number {
  return workflowSourceRank(left) - workflowSourceRank(right) || left.title.localeCompare(right.title);
}

function workflowSourceRank(workflow: SubagentWorkflowRecord): number {
  if (workflow.source === "builtin") return 0;
  if (workflow.source === "global") return 1;
  return 2;
}
