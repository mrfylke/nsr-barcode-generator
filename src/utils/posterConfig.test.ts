import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadFramPosterConfig,
  loadPosterConfig,
  renderPosterTemplate,
  validatePosterConfig,
} from "./posterConfig";

describe("poster configuration", () => {
  it("ships a valid FRAM config linked to a readable JSON Schema", async () => {
    const configPath = path.join(
      __dirname,
      "..",
      "..",
      "assets",
      "config",
      "fram-poster.json",
    );
    const raw = JSON.parse(await fs.readFile(configPath, "utf8"));
    const config = await loadFramPosterConfig();

    expect(validatePosterConfig(raw).version).toBe(1);
    expect(config.colors.headerFooter).toBe("#1A4D75");
    expect(config.layout.header.title).toBe("{{stopName}}");
    expect(config.qrUrlTemplate).toBe(
      "https://reise.frammr.no/departures/{{encodedNsrId}}?qr",
    );
    expect(config.logo?.path).toBe(
      path.join(
        __dirname,
        "..",
        "..",
        "assets",
        "images",
        "fram_mor_fylkeskommune_dark.png",
      ),
    );

    const schemaPath = path.resolve(path.dirname(configPath), raw.$schema);
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("resolves a custom logo path relative to the config file", async () => {
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "nsr-poster-config-"),
    );
    const source = JSON.parse(
      await fs.readFile(
        path.join(
          __dirname,
          "..",
          "..",
          "assets",
          "config",
          "fram-poster.json",
        ),
        "utf8",
      ),
    );
    source.logo.path = "./logo.png";
    const configPath = path.join(tempDirectory, "poster.json");
    await fs.writeFile(configPath, JSON.stringify(source));

    const config = await loadPosterConfig(configPath);

    expect(config.logo?.path).toBe(path.join(tempDirectory, "logo.png"));
  });

  it("rejects unsupported properties and invalid colors", async () => {
    const config = await loadFramPosterConfig();

    expect(() => validatePosterConfig({ ...config, unexpected: true })).toThrow(
      /unexpected is not supported/,
    );
    expect(() =>
      validatePosterConfig({
        ...config,
        colors: { ...config.colors, bodyText: "blue" },
      }),
    ).toThrow(/#RRGGBB/);
  });

  it("renders supported stop-place placeholders", () => {
    expect(
      renderPosterTemplate(
        "{{stopName}}|{{nsrId}}|{{encodedStopName}}|{{encodedNsrId}}",
        { id: "NSR:StopPlace:1", name: "Åsen øst" },
      ),
    ).toBe("Åsen øst|NSR:StopPlace:1|%C3%85sen%20%C3%B8st|NSR%3AStopPlace%3A1");
  });
});
