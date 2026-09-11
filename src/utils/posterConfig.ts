import { promises as fs } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { resolveAssetPath } from "./assets";

export interface PosterColors {
  headerFooter: string;
  headerText: string;
  bodyText: string;
  border: string;
  qrDark: string;
  qrLight: string;
}

export interface PosterLogoConfig {
  path: string;
  maxWidth: number;
  maxHeight: number;
  /** Defaults to true. The FRAM preset disables this to preserve its legacy rendering exactly. */
  preserveAspectRatio?: boolean;
  fallbackText: string;
  fallbackSubtext: string;
}

export interface PosterSection {
  headingLines: string[];
  bodyLines: string[];
  /** Vertical space before this section, in PDF points. */
  marginTop?: number;
  /** Vertical space between the heading and body, in PDF points. */
  bodyMarginTop?: number;
}

export interface PosterTextGroup {
  weight: "regular" | "bold";
  lines: string[];
  /** Optional portrait-only copy, useful when the two formats need different wrapping. */
  portraitLines?: string[];
  /** Vertical space before this group, in PDF points. */
  marginTop?: number;
  /** Horizontal indentation in PDF points. */
  indent?: number;
}

export interface PosterLayoutConfig {
  header: {
    /** Supports {{stopName}} and {{nsrId}} placeholders. */
    title: string;
  };
  main: {
    sections: PosterSection[];
  };
  aside: {
    groups: PosterTextGroup[];
    /** Top offset for the aside column in landscape mode. */
    landscapeTop: number;
    /** Gap between main and aside content in portrait mode. */
    portraitMarginTop: number;
  };
}

/**
 * Serializable poster definition shared by the API and CLI. `$schema` is
 * optional at runtime, but allows editors to discover the bundled JSON Schema.
 */
export interface PosterConfig {
  $schema?: string;
  version: 1;
  colors: PosterColors;
  logo: PosterLogoConfig | null;
  layout: PosterLayoutConfig;
  /**
   * URL template used for the QR payload when `generateQrUrl` is not supplied.
   * Supports {{nsrId}}, {{encodedNsrId}}, {{stopName}}, and
   * {{encodedStopName}}.
   */
  qrUrlTemplate: string;
}

export const builtInPosterConfigNames = ["fram"] as const;
export type BuiltInPosterConfigName = (typeof builtInPosterConfigNames)[number];
export type PosterConfigSource = PosterConfig | BuiltInPosterConfigName;

const builtInPosterConfigFiles: Record<BuiltInPosterConfigName, string> = {
  fram: "fram-poster.json",
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertObject(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${path} must be an object`);
  return value;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${path}.${unknown} is not supported`);
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative number`);
  }
}

function assertLines(value: unknown, path: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((line) => typeof line !== "string")
  ) {
    throw new Error(`${path} must be a non-empty array of strings`);
  }
}

/** Validates an unknown value and returns it as a PosterConfig. */
export function validatePosterConfig(value: unknown): PosterConfig {
  const config = assertObject(value, "poster config");
  assertOnlyKeys(
    config,
    ["$schema", "version", "colors", "logo", "layout", "qrUrlTemplate"],
    "poster config",
  );
  if (config.$schema !== undefined) assertString(config.$schema, "$schema");
  if (config.version !== 1) throw new Error("version must be 1");

  const colors = assertObject(config.colors, "colors");
  const colorKeys = [
    "headerFooter",
    "headerText",
    "bodyText",
    "border",
    "qrDark",
    "qrLight",
  ];
  assertOnlyKeys(colors, colorKeys, "colors");
  for (const key of colorKeys) {
    const color = colors[key];
    assertString(color, `colors.${key}`);
    if (!HEX_COLOR.test(color)) {
      throw new Error(`colors.${key} must use #RRGGBB format`);
    }
  }

  if (config.logo !== null) {
    const logo = assertObject(config.logo, "logo");
    assertOnlyKeys(
      logo,
      [
        "path",
        "maxWidth",
        "maxHeight",
        "preserveAspectRatio",
        "fallbackText",
        "fallbackSubtext",
      ],
      "logo",
    );
    assertString(logo.path, "logo.path");
    assertNumber(logo.maxWidth, "logo.maxWidth");
    assertNumber(logo.maxHeight, "logo.maxHeight");
    if (logo.maxWidth === 0 || logo.maxHeight === 0) {
      throw new Error("logo dimensions must be greater than zero");
    }
    if (
      logo.preserveAspectRatio !== undefined &&
      typeof logo.preserveAspectRatio !== "boolean"
    ) {
      throw new Error("logo.preserveAspectRatio must be a boolean");
    }
    if (typeof logo.fallbackText !== "string") {
      throw new Error("logo.fallbackText must be a string");
    }
    if (typeof logo.fallbackSubtext !== "string") {
      throw new Error("logo.fallbackSubtext must be a string");
    }
  }

  const layout = assertObject(config.layout, "layout");
  assertOnlyKeys(layout, ["header", "main", "aside"], "layout");
  const header = assertObject(layout.header, "layout.header");
  assertOnlyKeys(header, ["title"], "layout.header");
  assertString(header.title, "layout.header.title");

  const main = assertObject(layout.main, "layout.main");
  assertOnlyKeys(main, ["sections"], "layout.main");
  if (!Array.isArray(main.sections) || main.sections.length === 0) {
    throw new Error("layout.main.sections must be a non-empty array");
  }
  main.sections.forEach((candidate, index) => {
    const section = assertObject(candidate, `layout.main.sections[${index}]`);
    assertOnlyKeys(
      section,
      ["headingLines", "bodyLines", "marginTop", "bodyMarginTop"],
      `layout.main.sections[${index}]`,
    );
    assertLines(
      section.headingLines,
      `layout.main.sections[${index}].headingLines`,
    );
    assertLines(section.bodyLines, `layout.main.sections[${index}].bodyLines`);
    if (section.marginTop !== undefined) {
      assertNumber(
        section.marginTop,
        `layout.main.sections[${index}].marginTop`,
      );
    }
    if (section.bodyMarginTop !== undefined) {
      assertNumber(
        section.bodyMarginTop,
        `layout.main.sections[${index}].bodyMarginTop`,
      );
    }
  });

  const aside = assertObject(layout.aside, "layout.aside");
  assertOnlyKeys(
    aside,
    ["groups", "landscapeTop", "portraitMarginTop"],
    "layout.aside",
  );
  if (!Array.isArray(aside.groups)) {
    throw new Error("layout.aside.groups must be an array");
  }
  aside.groups.forEach((candidate, index) => {
    const group = assertObject(candidate, `layout.aside.groups[${index}]`);
    assertOnlyKeys(
      group,
      ["weight", "lines", "portraitLines", "marginTop", "indent"],
      `layout.aside.groups[${index}]`,
    );
    if (group.weight !== "regular" && group.weight !== "bold") {
      throw new Error(
        `layout.aside.groups[${index}].weight must be regular or bold`,
      );
    }
    assertLines(group.lines, `layout.aside.groups[${index}].lines`);
    if (group.portraitLines !== undefined) {
      assertLines(
        group.portraitLines,
        `layout.aside.groups[${index}].portraitLines`,
      );
    }
    if (group.marginTop !== undefined) {
      assertNumber(group.marginTop, `layout.aside.groups[${index}].marginTop`);
    }
    if (group.indent !== undefined) {
      assertNumber(group.indent, `layout.aside.groups[${index}].indent`);
    }
  });
  assertNumber(aside.landscapeTop, "layout.aside.landscapeTop");
  assertNumber(aside.portraitMarginTop, "layout.aside.portraitMarginTop");

  assertString(config.qrUrlTemplate, "qrUrlTemplate");
  return config as unknown as PosterConfig;
}

/** Reads, validates, and resolves file paths in a poster config file. */
export async function loadPosterConfig(
  filePath: string,
): Promise<PosterConfig> {
  const absolutePath = resolve(filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Failed to read poster config "${filePath}": ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  try {
    const config = validatePosterConfig(parsed);
    if (config.logo && !isAbsolute(config.logo.path)) {
      config.logo.path = resolve(dirname(absolutePath), config.logo.path);
    }
    return config;
  } catch (error) {
    throw new Error(
      `Invalid poster config "${filePath}": ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}

/** Loads a named poster pack shipped with the package. */
export function loadBuiltInPosterConfig(
  name: BuiltInPosterConfigName,
  assetsDirectory?: string,
): Promise<PosterConfig> {
  const fileName = builtInPosterConfigFiles[name];
  if (!fileName) {
    throw new Error(
      `Unknown built-in poster config "${String(name)}". Available packs: ${builtInPosterConfigNames.join(
        ", ",
      )}`,
    );
  }
  return loadPosterConfig(
    resolveAssetPath(assetsDirectory, "config", fileName),
  );
}

/**
 * Resolves a CLI-style config reference: a built-in pack name such as `fram`,
 * or a path to a JSON configuration file.
 */
export function loadPosterConfigSource(
  source: string,
  assetsDirectory?: string,
): Promise<PosterConfig> {
  if ((builtInPosterConfigNames as readonly string[]).includes(source)) {
    return loadBuiltInPosterConfig(
      source as BuiltInPosterConfigName,
      assetsDirectory,
    );
  }
  return loadPosterConfig(source);
}

/** Resolves the API's object-or-pack configuration value. */
export async function resolvePosterConfig(
  source: PosterConfigSource | undefined,
  assetsDirectory?: string,
): Promise<PosterConfig> {
  if (source === undefined) {
    return loadBuiltInPosterConfig("fram", assetsDirectory);
  }
  if (typeof source === "string") {
    return loadBuiltInPosterConfig(source, assetsDirectory);
  }
  return validatePosterConfig(source);
}

export function renderPosterTemplate(
  template: string,
  context: { id: string; name: string },
): string {
  return template
    .replaceAll("{{encodedNsrId}}", encodeURIComponent(context.id))
    .replaceAll("{{encodedStopName}}", encodeURIComponent(context.name))
    .replaceAll("{{nsrId}}", context.id)
    .replaceAll("{{stopName}}", context.name);
}
