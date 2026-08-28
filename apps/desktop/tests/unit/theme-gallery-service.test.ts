import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { paletteFromVsCodeColors, parseCssColor, parseJsonc, parseVsCodeThemeFile, ThemeGalleryService } from "../../electron/theme-gallery-service";

afterEach(() => vi.unstubAllGlobals());

describe("theme gallery service", () => {
  it("parses JSONC, bounded local includes, alpha, and display-p3 colors", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-theme-"));
    await writeFile(join(root, "base.json"), JSON.stringify({ type: "dark", colors: { "editor.background": "#101010", "editor.foreground": "#777777" } }), "utf8");
    await writeFile(join(root, "theme.jsonc"), `{
      // color data only
      "name": "P3 Theme",
      "include": "./base.json",
      "colors": {
        "focusBorder": "color(display-p3 0.4 0.2 1 / 80%)",
        "editorWidget.background": "#ffffff18",
      },
    }`, "utf8");
    const theme = await parseVsCodeThemeFile(join(root, "theme.jsonc"));
    expect(theme.name).toBe("P3 Theme");
    expect(theme.source).toBe("vscode-file");
    expect(theme.palettes.dark.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(theme.palettes.dark.text, theme.palettes.dark.main)).toBeGreaterThanOrEqual(4.5);
    expect(parseCssColor("#ff000080", "#000000")).toBe("#800000");
    expect(parseCssColor("color(display-p3 1 0.5 0)")).toBe("#ff8000");
    expect(parseJsonc('{"a": 1, /* comment */}')).toEqual({ a: 1 });
  });

  it("rejects includes outside the selected theme folder and include cycles", async () => {
    const parent = await mkdtemp(join(tmpdir(), "pi-theme-traversal-"));
    const root = join(parent, "themes");
    await mkdir(root);
    await writeFile(join(parent, "outside.json"), "{}", "utf8");
    await writeFile(join(root, "escape.json"), '{"include":"../outside.json"}', "utf8");
    await expect(parseVsCodeThemeFile(join(root, "escape.json"))).rejects.toThrow(/escapes/i);
    await writeFile(join(root, "a.json"), '{"include":"b.json"}', "utf8");
    await writeFile(join(root, "b.json"), '{"include":"a.json"}', "utf8");
    await expect(parseVsCodeThemeFile(join(root, "a.json"))).rejects.toThrow(/cycle/i);
  });

  it("repairs inaccessible semantic text roles", () => {
    const palette = paletteFromVsCodeColors({ "editor.background": "#ffffff", "editor.foreground": "#eeeeee", foreground: "#fefefe", descriptionForeground: "#dddddd" }, "light");
    expect(contrast(palette.text, palette.main)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.textStrong, palette.main)).toBeGreaterThanOrEqual(7);
    expect(contrast(palette.muted, palette.main)).toBeGreaterThanOrEqual(4.5);
  });

  it("searches and installs only allowlisted Open VSX theme color resources, with caching", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/-/search")) return json({ extensions: [{ namespace: "acme", name: "night", displayName: "Acme Night", description: "Night theme", version: "1.2.3", verified: true, files: { download: "https://open-vsx.org/api/acme/night/1.2.3/file/night.vsix", sha256: "https://open-vsx.org/api/acme/night/1.2.3/file/night.sha256" } }] });
      if (url === "https://open-vsx.org/api/acme/night/1.2.3") return json({ categories: ["Themes"], license: "MIT", displayName: "Acme Night", description: "Night theme", files: { manifest: "https://open-vsx.org/api/acme/night/1.2.3/file/package.json" } });
      if (url.endsWith("/file/package.json")) return json({ contributes: { themes: [{ label: "Acme Night", path: "./themes/night.json" }] } });
      if (url.endsWith("/themes/night.json")) return new Response(JSON.stringify({ type: "dark", colors: { "editor.background": "#111111", "editor.foreground": "#eeeeee" } }), { status: 200, headers: { "content-type": "application/json" } });
      throw new Error(`Unexpected URL ${url}`);
    });
    const root = await mkdtemp(join(tmpdir(), "pi-theme-openvsx-"));
    const service = new ThemeGalleryService(root);
    const first = await service.searchOpenVsx("acme");
    const second = await service.searchOpenVsx("acme");
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({ namespace: "acme", name: "night", verified: true, sha256: expect.stringContaining("sha256") });
    expect(calls.filter((url) => url.includes("/search"))).toHaveLength(1);
    const installed = await service.installOpenVsx("acme", "night", "1.2.3");
    expect(installed).toMatchObject({ source: "open-vsx", license: "MIT", version: "1.2.3" });
    expect((await service.snapshot()).installed).toHaveLength(1);
    expect(calls.some((url) => url.endsWith(".vsix"))).toBe(false);
  });

  it("rejects disallowed licenses and remote traversal before fetching a theme resource", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/acme/bad/1.0.0")) return json({ categories: ["Themes"], license: "Proprietary", files: { manifest: "https://open-vsx.org/api/acme/bad/1.0.0/file/package.json" } });
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = new ThemeGalleryService(await mkdtemp(join(tmpdir(), "pi-theme-license-")));
    await expect(service.installOpenVsx("acme", "bad", "1.0.0")).rejects.toThrow(/allowlist/i);
  });
});

function json(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function contrast(a: string, b: string): number { const values = [a, b].map((value) => { const hex = value.slice(1); const rgb = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4); return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722; }); return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05); }
