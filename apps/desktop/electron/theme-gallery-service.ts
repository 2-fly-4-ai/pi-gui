import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { OpenVsxThemeSearchResult, SemanticThemePalette, ThemeDefinition, ThemeGallerySnapshot, ThemePaletteMode } from "../src/theme-types";
import { JsonFileStore } from "./json-file-store";

const MAX_THEME_COUNT = 20;
const MAX_STORE_BYTES = 2 * 1024 * 1024;
const MAX_THEME_FILE_BYTES = 2 * 1024 * 1024;
const MAX_INCLUDE_DEPTH = 5;
const DEFAULT_THEME_ID = "builtin:pi-default";
const OPEN_VSX_ORIGIN = "https://open-vsx.org";
const MAX_NETWORK_BYTES = 2 * 1024 * 1024;
const NETWORK_TIMEOUT_MS = 10_000;
const OPEN_VSX_CACHE_MS = 5 * 60 * 1_000;
const ALLOWED_LICENSES = new Set(["mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause", "isc", "mpl-2.0", "unlicense", "cc0-1.0"]);

interface PersistedThemeGallery {
  readonly version: 1;
  readonly selectedThemeId: string;
  readonly installed: readonly ThemeDefinition[];
}

export class ThemeGalleryService {
  private readonly store: JsonFileStore<PersistedThemeGallery>;
  private readonly searchCache = new Map<string, { readonly expiresAt: number; readonly results: readonly OpenVsxThemeSearchResult[] }>();
  private testFetchText?: (url: string) => Promise<string>;

  constructor(userDataDir: string) {
    this.store = new JsonFileStore(userDataDir, "theme-gallery");
  }

  async snapshot(): Promise<ThemeGallerySnapshot> {
    const persisted = await this.read();
    return { selectedThemeId: persisted.selectedThemeId, builtIns: BUILT_IN_THEMES, installed: persisted.installed, countLimit: MAX_THEME_COUNT, byteLimit: MAX_STORE_BYTES };
  }

  async select(themeId: string): Promise<ThemeGallerySnapshot> {
    const current = await this.read();
    const theme = [...BUILT_IN_THEMES, ...current.installed].find((candidate) => candidate.id === themeId);
    if (!theme) throw new Error("Theme was not found.");
    await this.persist({ ...current, selectedThemeId: theme.id });
    return this.snapshot();
  }

  async reset(): Promise<ThemeGallerySnapshot> {
    const current = await this.read();
    await this.persist({ ...current, selectedThemeId: DEFAULT_THEME_ID });
    return this.snapshot();
  }

  async importVsCodeTheme(filePath: string): Promise<ThemeDefinition> {
    const parsed = await parseVsCodeThemeFile(filePath);
    const current = await this.read();
    const withoutSameSource = current.installed.filter((theme) => theme.sourceLabel !== parsed.sourceLabel);
    if (withoutSameSource.length >= MAX_THEME_COUNT) throw new Error(`Theme gallery is full (${MAX_THEME_COUNT} imported themes).`);
    const next = { ...current, installed: [parsed, ...withoutSameSource] };
    await this.persist(next);
    return parsed;
  }

  async remove(themeId: string): Promise<ThemeGallerySnapshot> {
    const current = await this.read();
    const installed = current.installed.filter((theme) => theme.id !== themeId);
    if (installed.length === current.installed.length) throw new Error("Only installed themes can be removed.");
    await this.persist({ ...current, installed, selectedThemeId: current.selectedThemeId === themeId ? DEFAULT_THEME_ID : current.selectedThemeId });
    return this.snapshot();
  }

  async searchOpenVsx(query: string): Promise<readonly OpenVsxThemeSearchResult[]> {
    const normalized = query.trim().slice(0, 120);
    if (normalized.length < 2) return [];
    const cached = this.searchCache.get(normalized.toLowerCase());
    if (cached && cached.expiresAt > Date.now()) return cached.results;
    const payload = await this.fetchJson(`${OPEN_VSX_ORIGIN}/api/-/search?query=${encodeURIComponent(`${normalized} theme`)}&size=20`, MAX_NETWORK_BYTES);
    const extensions = isRecord(payload) && Array.isArray(payload.extensions) ? payload.extensions : [];
    const results = extensions.slice(0, 20).flatMap((value) => normalizeOpenVsxSearchResult(value));
    this.searchCache.set(normalized.toLowerCase(), { expiresAt: Date.now() + OPEN_VSX_CACHE_MS, results });
    if (this.searchCache.size > 20) this.searchCache.delete(this.searchCache.keys().next().value ?? "");
    return results;
  }

  async installOpenVsx(namespace: string, name: string, version: string): Promise<ThemeDefinition> {
    const safeNamespace = registrySegment(namespace);
    const safeName = registrySegment(name);
    const safeVersion = registrySegment(version);
    const metadata = await this.fetchJson(`${OPEN_VSX_ORIGIN}/api/${safeNamespace}/${safeName}/${safeVersion}`, MAX_NETWORK_BYTES);
    if (!isRecord(metadata)) throw new Error("Open VSX metadata is invalid.");
    const categories = Array.isArray(metadata.categories) ? metadata.categories.map(String) : [];
    if (!categories.some((category) => /theme/i.test(category))) throw new Error("This Open VSX extension does not declare a theme category.");
    const license = text(metadata.license, "", 100);
    if (!ALLOWED_LICENSES.has(license.toLowerCase())) throw new Error(`Theme license ${license || "unknown"} is not in Pi's allowlist.`);
    const files = isRecord(metadata.files) ? metadata.files : {};
    const manifestUrl = allowedOpenVsxUrl(files.manifest);
    const manifest = await this.fetchJson(manifestUrl, MAX_NETWORK_BYTES);
    if (!isRecord(manifest) || !isRecord(manifest.contributes) || !Array.isArray(manifest.contributes.themes)) throw new Error("Open VSX extension contains no declared color themes.");
    const declaration = manifest.contributes.themes.slice(0, 20).find((candidate) => isRecord(candidate) && typeof candidate.path === "string");
    if (!isRecord(declaration) || typeof declaration.path !== "string") throw new Error("Open VSX extension contains no usable color theme.");
    const themePath = safeResourcePath(declaration.path);
    const rootUrl = `${OPEN_VSX_ORIGIN}/vscode/unpkg/${encodeURIComponent(safeNamespace)}/${encodeURIComponent(safeName)}/${encodeURIComponent(safeVersion)}`;
    const merged = await readRemoteThemeWithIncludes(rootUrl, themePath, 0, new Set(), (url, limit) => this.fetchText(url, limit));
    const definition = themeFromVsCodeData(merged, {
      id: `openvsx:${safeNamespace}/${safeName}`,
      name: text(declaration.label, text(metadata.displayName, safeName, 120), 120),
      description: text(metadata.description, `Theme from ${safeNamespace}/${safeName}.`, 500),
      source: "open-vsx",
      sourceLabel: `Open VSX · ${safeNamespace}/${safeName}`,
      version: safeVersion,
      license,
    });
    const current = await this.read();
    const installed = [definition, ...current.installed.filter((theme) => theme.id !== definition.id)];
    if (installed.length > MAX_THEME_COUNT) throw new Error(`Theme gallery is full (${MAX_THEME_COUNT} imported themes).`);
    await this.persist({ ...current, installed });
    return definition;
  }

  useDeterministicOpenVsxFixtureForTest(): void {
    this.searchCache.clear();
    this.testFetchText = async (url) => {
      if (url.includes("/api/-/search")) return JSON.stringify({ extensions: [{ namespace: "pi-test", name: "safe-ocean", displayName: "Safe Ocean", description: "Deterministic test theme", version: "1.0.0", verified: true, files: { download: `${OPEN_VSX_ORIGIN}/api/pi-test/safe-ocean/1.0.0/file/theme.vsix`, sha256: `${OPEN_VSX_ORIGIN}/api/pi-test/safe-ocean/1.0.0/file/theme.sha256` } }] });
      if (url === `${OPEN_VSX_ORIGIN}/api/pi-test/safe-ocean/1.0.0`) return JSON.stringify({ categories: ["Themes"], license: "MIT", displayName: "Safe Ocean", description: "Deterministic test theme", files: { manifest: `${OPEN_VSX_ORIGIN}/api/pi-test/safe-ocean/1.0.0/file/package.json` } });
      if (url.endsWith("/file/package.json")) return JSON.stringify({ contributes: { themes: [{ label: "Safe Ocean", path: "./themes/ocean.json" }] } });
      if (url.endsWith("/themes/ocean.json")) return JSON.stringify({ type: "dark", colors: { "editor.background": "#08131f", "editor.foreground": "#e8f3ff", "focusBorder": "#39a7ff" } });
      throw new Error("Unexpected deterministic Open VSX fixture URL.");
    };
  }

  private fetchText(url: string, limit: number): Promise<string> { return this.testFetchText ? this.testFetchText(allowedOpenVsxUrl(url)).then((raw) => { if (Buffer.byteLength(raw, "utf8") > limit) throw new Error("Open VSX response exceeds the size limit."); return raw; }) : fetchBoundedText(url, limit); }
  private async fetchJson(url: string, limit: number): Promise<unknown> { return JSON.parse(await this.fetchText(url, limit)); }

  private async read(): Promise<PersistedThemeGallery> {
    const persisted = await this.store.read("global");
    if (persisted?.version !== 1 || !Array.isArray(persisted.installed)) return { version: 1, selectedThemeId: DEFAULT_THEME_ID, installed: [] };
    const installed = persisted.installed.slice(0, MAX_THEME_COUNT).flatMap(normalizeTheme);
    const selectedThemeId = [...BUILT_IN_THEMES, ...installed].some((theme) => theme.id === persisted.selectedThemeId) ? persisted.selectedThemeId : DEFAULT_THEME_ID;
    return { version: 1, selectedThemeId, installed };
  }

  private async persist(value: PersistedThemeGallery): Promise<void> {
    if (value.installed.length > MAX_THEME_COUNT) throw new Error("Theme count exceeds the gallery limit.");
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_STORE_BYTES) throw new Error("Theme gallery exceeds its 2 MiB storage budget.");
    await this.store.write("global", value);
  }
}

export async function parseVsCodeThemeFile(filePath: string): Promise<ThemeDefinition> {
  const root = dirname(resolve(filePath));
  const merged = await readThemeWithIncludes(resolve(filePath), root, 0, new Set());
  const name = text(merged.name, filePath.split(/[\\/]/).pop()?.replace(/\.jsonc?$/i, "") || "Imported theme", 120);
  const sourceLabel = relative(root, resolve(filePath)) || filePath.split(/[\\/]/).pop() || "theme.json";
  return themeFromVsCodeData(merged, {
    id: `vscode:${createHash("sha256").update(resolve(filePath)).digest("hex").slice(0, 20)}:${randomUUID().slice(0, 8)}`,
    name,
    description: `Imported from ${sourceLabel}. Only color data was read.`,
    source: "vscode-file",
    sourceLabel,
  });
}

function themeFromVsCodeData(merged: Record<string, unknown>, metadata: Omit<ThemeDefinition, "installedAt" | "palettes">): ThemeDefinition {
  const colors = isRecord(merged.colors) ? merged.colors : {};
  const inferredMode: ThemePaletteMode = String(merged.type).toLowerCase().includes("light") ? "light" : "dark";
  const intended = paletteFromVsCodeColors(colors, inferredMode);
  const opposite = deriveOppositePalette(intended, inferredMode === "light" ? "dark" : "light");
  return normalizeThemeDefinition({ ...metadata, installedAt: new Date().toISOString(), palettes: inferredMode === "light" ? { light: intended, dark: opposite } : { light: opposite, dark: intended } });
}

async function readRemoteThemeWithIncludes(rootUrl: string, resourcePath: string, depth: number, seen: Set<string>, fetchText: (url: string, limit: number) => Promise<string> = fetchBoundedText): Promise<Record<string, unknown>> {
  if (depth > MAX_INCLUDE_DEPTH) throw new Error("Open VSX theme include depth exceeds the limit.");
  const safePath = safeResourcePath(resourcePath);
  if (seen.has(safePath)) throw new Error("Open VSX theme includes contain a cycle.");
  seen.add(safePath);
  const raw = await fetchText(`${rootUrl}/${safePath.split("/").map(encodeURIComponent).join("/")}`, MAX_THEME_FILE_BYTES);
  const parsed = parseJsonc(raw);
  if (!isRecord(parsed)) throw new Error("Open VSX theme root must be an object.");
  let base: Record<string, unknown> = {};
  if (typeof parsed.include === "string" && parsed.include.trim()) {
    const parent = safePath.split("/").slice(0, -1);
    base = await readRemoteThemeWithIncludes(rootUrl, [...parent, parsed.include].join("/"), depth + 1, seen, fetchText);
  }
  seen.delete(safePath);
  return { ...base, ...parsed, colors: { ...(isRecord(base.colors) ? base.colors : {}), ...(isRecord(parsed.colors) ? parsed.colors : {}) } };
}

async function readThemeWithIncludes(path: string, root: string, depth: number, seen: Set<string>): Promise<Record<string, unknown>> {
  if (depth > MAX_INCLUDE_DEPTH) throw new Error("VS Code theme include depth exceeds the limit.");
  const absolute = resolve(path);
  const traversal = relative(root, absolute);
  if (traversal.startsWith(`..${sep}`) || traversal === ".." || traversal.startsWith(sep)) throw new Error("VS Code theme include escapes the selected theme folder.");
  if (seen.has(absolute)) throw new Error("VS Code theme includes contain a cycle.");
  seen.add(absolute);
  const raw = await readBounded(absolute, MAX_THEME_FILE_BYTES);
  const parsed = parseJsonc(raw);
  if (!isRecord(parsed)) throw new Error("VS Code theme root must be an object.");
  let base: Record<string, unknown> = {};
  if (typeof parsed.include === "string" && parsed.include.trim()) base = await readThemeWithIncludes(resolve(dirname(absolute), parsed.include), root, depth + 1, seen);
  seen.delete(absolute);
  return { ...base, ...parsed, colors: { ...(isRecord(base.colors) ? base.colors : {}), ...(isRecord(parsed.colors) ? parsed.colors : {}) } };
}

export function parseJsonc(raw: string): unknown {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    const next = raw[index + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; output += char; continue; }
    if (char === "/" && next === "/") { while (index < raw.length && raw[index] !== "\n") index += 1; output += "\n"; continue; }
    if (char === "/" && next === "*") { index += 2; while (index < raw.length - 1 && !(raw[index] === "*" && raw[index + 1] === "/")) index += 1; index += 1; output += " "; continue; }
    output += char;
  }
  return JSON.parse(output.replace(/,\s*([}\]])/g, "$1"));
}

export function paletteFromVsCodeColors(colors: Record<string, unknown>, mode: ThemePaletteMode): SemanticThemePalette {
  const base = mode === "dark" ? BUILT_IN_THEMES[0]!.palettes.dark : BUILT_IN_THEMES[0]!.palettes.light;
  const background = color(colors["editor.background"], base.main, base.main);
  const surface = color(colors["sideBar.background"], background, base.surface);
  const foreground = ensureContrast(color(colors["editor.foreground"], background, base.text), background, 4.5);
  const strong = ensureContrast(color(colors["foreground"], background, base.textStrong), background, 7);
  const muted = ensureContrast(color(colors["descriptionForeground"], background, base.muted), background, 4.5);
  const accent = color(colors["focusBorder"] ?? colors["button.background"] ?? colors["textLink.foreground"], background, base.accent);
  return {
    window: color(colors["activityBar.background"], background, base.window),
    sidebar: surface,
    main: background,
    surface: color(colors["editorWidget.background"], background, base.surface),
    surfaceMuted: color(colors["input.background"], background, base.surfaceMuted),
    line: color(colors["panel.border"], background, base.line),
    lineStrong: color(colors["contrastBorder"], background, base.lineStrong),
    text: foreground,
    textStrong: strong,
    muted,
    mutedStrong: ensureContrast(color(colors["disabledForeground"], background, base.mutedStrong), background, 4.5),
    accent,
    link: ensureContrast(color(colors["textLink.foreground"], background, accent), background, 4.5),
    error: color(colors["errorForeground"], background, base.error),
    errorInk: ensureContrast(color(colors["editorError.foreground"], background, base.errorInk), background, 4.5),
    success: color(colors["testing.iconPassed"], background, base.success),
    warning: color(colors["editorWarning.foreground"], background, base.warning),
  };
}

function deriveOppositePalette(source: SemanticThemePalette, targetMode: ThemePaletteMode): SemanticThemePalette {
  const base = BUILT_IN_THEMES[0]!.palettes[targetMode];
  return repairPalette({ ...base, accent: source.accent, link: source.link, error: source.error, success: source.success, warning: source.warning });
}

function normalizeTheme(value: unknown): readonly ThemeDefinition[] { try { return [normalizeThemeDefinition(value)]; } catch { return []; } }
function normalizeThemeDefinition(value: unknown): ThemeDefinition {
  if (!isRecord(value) || !isRecord(value.palettes) || !isRecord(value.palettes.light) || !isRecord(value.palettes.dark)) throw new Error("Theme definition is invalid.");
  return {
    id: text(value.id, "theme", 200), name: text(value.name, "Theme", 120), description: text(value.description, "", 500),
    source: value.source === "open-vsx" || value.source === "vscode-file" || value.source === "built-in" ? value.source : "vscode-file",
    sourceLabel: text(value.sourceLabel, "Imported theme", 300),
    version: optionalText(value.version, 100), license: optionalText(value.license, 100), installedAt: optionalIso(value.installedAt),
    palettes: { light: repairPalette(normalizePalette(value.palettes.light)), dark: repairPalette(normalizePalette(value.palettes.dark)) },
  };
}
function normalizePalette(value: Record<string, unknown>): SemanticThemePalette { const output = {} as Record<keyof SemanticThemePalette, string>; for (const key of PALETTE_KEYS) output[key] = color(value[key], "#ffffff", "#000000"); return output; }
function repairPalette(palette: SemanticThemePalette): SemanticThemePalette { return { ...palette, text: ensureContrast(palette.text, palette.main, 4.5), textStrong: ensureContrast(palette.textStrong, palette.main, 7), muted: ensureContrast(palette.muted, palette.main, 4.5), mutedStrong: ensureContrast(palette.mutedStrong, palette.main, 4.5), link: ensureContrast(palette.link, palette.main, 4.5), errorInk: ensureContrast(palette.errorInk, palette.main, 4.5) }; }

const PALETTE_KEYS = ["window", "sidebar", "main", "surface", "surfaceMuted", "line", "lineStrong", "text", "textStrong", "muted", "mutedStrong", "accent", "link", "error", "errorInk", "success", "warning"] as const;
function color(value: unknown, background: string, fallback: string): string { return parseCssColor(typeof value === "string" ? value : "", background) ?? fallback; }
export function parseCssColor(value: string, background = "#ffffff"): string | undefined {
  const rgba = parseRawCssColor(value);
  if (!rgba) return undefined;
  const backgroundRgba = parseRawCssColor(background) ?? [255, 255, 255, 1];
  const backgroundChannels = backgroundRgba.slice(0, 3).map((channel) => clamp(channel));
  const backgroundAlpha = backgroundRgba[3];
  const opaqueBackground = backgroundChannels.map((channel) => channel * backgroundAlpha + 255 * (1 - backgroundAlpha));
  return toHex(rgba.slice(0, 3).map((channel, index) => clamp(channel) * rgba[3] + opaqueBackground[index]! * (1 - rgba[3])) as [number, number, number]);
}

function parseRawCssColor(value: string): [number, number, number, number] | undefined {
  const normalized = value.trim().toLowerCase();
  let rgba: [number, number, number, number] | undefined;
  const hex = normalized.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map((char) => char + char).join("") : hex;
    if (expanded.length === 6 || expanded.length === 8) rgba = [parseInt(expanded.slice(0, 2), 16), parseInt(expanded.slice(2, 4), 16), parseInt(expanded.slice(4, 6), 16), expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1];
  }
  const rgb = normalized.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (rgb) rgba = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha(rgb[4])];
  const p3 = normalized.match(/^color\(display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)$/);
  if (p3) rgba = [Number(p3[1]) * 255, Number(p3[2]) * 255, Number(p3[3]) * 255, alpha(p3[4])];
  if (!rgba || rgba.some((channel) => !Number.isFinite(channel))) return undefined;
  return [clamp(rgba[0]), clamp(rgba[1]), clamp(rgba[2]), Math.max(0, Math.min(1, rgba[3]))];
}
function ensureContrast(foreground: string, background: string, ratio: number): string { if (contrast(foreground, background) >= ratio) return foreground; const black = contrast("#000000", background); const white = contrast("#ffffff", background); const target = black >= white ? [0, 0, 0] as const : [255, 255, 255] as const; const start = hexChannels(foreground); for (let step = 1; step <= 20; step += 1) { const weight = step / 20; const candidate = toHex(start.map((value, index) => value * (1 - weight) + target[index]! * weight) as [number, number, number]); if (contrast(candidate, background) >= ratio) return candidate; } throw new Error("Theme cannot satisfy required text contrast."); }
function contrast(a: string, b: string): number { const [la, lb] = [luminance(a), luminance(b)]; return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
function luminance(value: string): number { return hexChannels(value).map((channel) => channel / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0); }
function hexChannels(value: string): [number, number, number] { const parsed = value.match(/^#([0-9a-f]{6})$/i)?.[1] ?? "ffffff"; return [parseInt(parsed.slice(0, 2), 16), parseInt(parsed.slice(2, 4), 16), parseInt(parsed.slice(4, 6), 16)]; }
function toHex(values: [number, number, number]): string { return `#${values.map((value) => Math.round(clamp(value)).toString(16).padStart(2, "0")).join("")}`; }
function clamp(value: number): number { return Math.max(0, Math.min(255, value)); }
function alpha(value: string | undefined): number { if (!value) return 1; return value.endsWith("%") ? Math.max(0, Math.min(1, Number(value.slice(0, -1)) / 100)) : Math.max(0, Math.min(1, Number(value))); }
function text(value: unknown, fallback: string, max: number): string { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback; }
function optionalText(value: unknown, max: number): string | undefined { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined; }
function optionalIso(value: unknown): string | undefined { return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
async function readBounded(path: string, limit: number): Promise<string> { const raw = await readFile(path); if (raw.byteLength > limit) throw new Error("Theme file exceeds the 2 MiB limit."); return raw.toString("utf8"); }

function normalizeOpenVsxSearchResult(value: unknown): readonly OpenVsxThemeSearchResult[] {
  if (!isRecord(value) || !isRecord(value.files)) return [];
  try {
    const namespace = registrySegment(value.namespace);
    const name = registrySegment(value.name);
    const version = registrySegment(value.version);
    return [{
      namespace,
      name,
      displayName: text(value.displayName, name, 120),
      version,
      description: text(value.description, "Open VSX theme extension", 500),
      downloadUrl: allowedOpenVsxUrl(value.files.download),
      sha256: typeof value.files.sha256 === "string" ? allowedOpenVsxUrl(value.files.sha256) : undefined,
      verified: value.verified === true,
    }];
  } catch {
    return [];
  }
}

function registrySegment(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("Open VSX extension identifier is invalid.");
  return value;
}

function safeResourcePath(value: string): string {
  const decoded = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = decoded.split("/");
  if (!segments.length || segments.length > 20 || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\u0000"))) throw new Error("Open VSX theme path is unsafe.");
  const joined = segments.join("/");
  if (joined.length > 1_000 || !/\.jsonc?$/i.test(joined)) throw new Error("Open VSX theme resource must be JSON or JSONC.");
  return joined;
}

function allowedOpenVsxUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Open VSX resource URL is missing.");
  const parsed = new URL(value);
  if (parsed.origin !== OPEN_VSX_ORIGIN || parsed.username || parsed.password) throw new Error("Open VSX resource host is not allowed.");
  return parsed.toString();
}

async function fetchBoundedText(url: string, limit: number): Promise<string> {
  const target = allowedOpenVsxUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(target, { signal: controller.signal, redirect: "error", headers: { accept: "application/json, text/plain;q=0.9" } });
    if (!response.ok || !response.body) throw new Error(`Open VSX request failed (${response.status}).`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > limit) throw new Error("Open VSX response exceeds the size limit.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bytes = chunk.value;
      total += bytes.byteLength;
      if (total > limit) { await reader.cancel(); throw new Error("Open VSX response exceeds the size limit."); }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Open VSX request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const PI_LIGHT: SemanticThemePalette = { window: "#eceef3", sidebar: "#f4f5f8", main: "#f8f8fb", surface: "#ffffff", surfaceMuted: "#f1f3f7", line: "#dde1ea", lineStrong: "#d2d7e2", text: "#39435b", textStrong: "#1f2638", muted: "#5e687e", mutedStrong: "#4f596f", accent: "#6a55f2", link: "#3358d4", error: "#c45666", errorInk: "#8f3040", success: "#247a52", warning: "#8a5b10" };
const PI_DARK: SemanticThemePalette = { window: "#1a1b1e", sidebar: "#202124", main: "#1e1f22", surface: "#2b2d31", surfaceMuted: "#232428", line: "#3a3c42", lineStrong: "#4a4d55", text: "#d4d4d8", textStrong: "#f4f4f5", muted: "#a8aab1", mutedStrong: "#b6b8be", accent: "#7c6bf5", link: "#8da7ff", error: "#e05467", errorInk: "#f87171", success: "#55b985", warning: "#d6a74a" };
function themed(id: string, name: string, description: string, accent: string, lightMain: string, darkMain: string): ThemeDefinition { return normalizeThemeDefinition({ id: `builtin:${id}`, name, description, source: "built-in", sourceLabel: "Pi GUI", license: "MIT", palettes: { light: { ...PI_LIGHT, main: lightMain, accent, link: accent }, dark: { ...PI_DARK, main: darkMain, accent, link: accent } } }); }
export const BUILT_IN_THEMES: readonly ThemeDefinition[] = [
  normalizeThemeDefinition({ id: DEFAULT_THEME_ID, name: "Pi Default", description: "The balanced original Pi palette.", source: "built-in", sourceLabel: "Pi GUI", license: "MIT", palettes: { light: PI_LIGHT, dark: PI_DARK } }),
  themed("violet-night", "Violet Night", "Deeper violet focus with a quiet graphite canvas.", "#8b72ff", "#f8f7ff", "#17151f"),
  themed("ocean-terminal", "Ocean Terminal", "Cool blue focus inspired by precise terminal tools.", "#2f7de1", "#f3f8ff", "#111a24"),
  themed("forest-signal", "Forest Signal", "Calm green focus for long-running engineering work.", "#238b62", "#f4faf7", "#121c18"),
];
