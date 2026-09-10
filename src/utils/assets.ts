import { join } from "node:path";

/**
 * Resolves paths to package-owned resources (fonts, images) relative to the
 * compiled module location rather than `process.cwd()`. This makes asset
 * resolution work regardless of the caller's working directory, which is
 * required when this package is bundled inside another application (e.g. a
 * packaged desktop app where the install directory may be read-only and the
 * working directory is unrelated to this package).
 *
 * Compiled layout: `<package root>/dist/utils/assets.js`, so two levels up
 * from `__dirname` is the package root, alongside the shipped `assets/` dir.
 */
function getPackageRoot(): string {
  return join(__dirname, "..", "..");
}

export function getAssetPath(...segments: string[]): string {
  return join(getPackageRoot(), "assets", ...segments);
}

/**
 * Resolves a package asset from a caller-provided assets directory when set.
 * This supports bundlers that replace `__dirname` with a build-time absolute
 * path while keeping the default package-relative behavior for Node.js users.
 */
export function resolveAssetPath(
  assetsDirectory: string | undefined,
  ...segments: string[]
): string {
  return assetsDirectory
    ? join(assetsDirectory, ...segments)
    : getAssetPath(...segments);
}
