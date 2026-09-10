import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAssetPath, resolveAssetPath } from "./assets";

describe("getAssetPath", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("resolves bundled font and image assets that exist on disk", async () => {
    await expect(
      fs.access(getAssetPath("fonts", "poppins-400-normal.ttf")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(getAssetPath("fonts", "poppins-700-normal.ttf")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(getAssetPath("images", "fram_mor_fylkeskommune_dark.png")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(getAssetPath("images", "Bus.png")),
    ).resolves.toBeUndefined();
  });

  it("resolves the same absolute path regardless of process.cwd()", async () => {
    const expected = getAssetPath("fonts", "poppins-400-normal.ttf");

    const unrelatedDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nsr-barcode-cwd-"),
    );
    process.chdir(unrelatedDir);

    const resolvedFromElsewhere = getAssetPath(
      "fonts",
      "poppins-400-normal.ttf",
    );

    expect(resolvedFromElsewhere).toBe(expected);
    await expect(fs.access(resolvedFromElsewhere)).resolves.toBeUndefined();
  });

  it("resolves from an explicit assets directory for bundled consumers", () => {
    expect(
      resolveAssetPath(
        "/opt/my-app/resources/poster-assets",
        "images",
        "Bus.png",
      ),
    ).toBe("/opt/my-app/resources/poster-assets/images/Bus.png");
  });
});
