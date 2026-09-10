import { promises as fs } from "node:fs";
import { resolveAssetPath } from "./assets";

export interface FontFamily {
  regular: string;
  bold: string;
}

const HELVETICA_FALLBACK: FontFamily = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
};

/**
 * Resolves the bundled Poppins font family shipped with this package.
 * Fonts are read from package-owned resources (never downloaded at
 * runtime, never cached to disk) and PDF generation falls back to
 * Helvetica if a bundled font file cannot be read.
 */
export class FontLoader {
  private cachedFontFamilies = new Map<string, FontFamily>();

  /**
   * Loads the Poppins font family (regular and bold weights). Verifies the
   * bundled font files are readable and returns their absolute paths for
   * PDFKit to register; falls back to Helvetica otherwise.
   */
  async loadPoppins(assetsDirectory?: string): Promise<FontFamily> {
    const cacheKey = assetsDirectory ?? "package-default";
    const cached = this.cachedFontFamilies.get(cacheKey);
    if (cached) {
      return cached;
    }

    const regularPath = resolveAssetPath(
      assetsDirectory,
      "fonts",
      "poppins-400-normal.ttf",
    );
    const boldPath = resolveAssetPath(
      assetsDirectory,
      "fonts",
      "poppins-700-normal.ttf",
    );

    try {
      await Promise.all([fs.access(regularPath), fs.access(boldPath)]);

      const fontFamily: FontFamily = {
        regular: regularPath,
        bold: boldPath,
      };
      this.cachedFontFamilies.set(cacheKey, fontFamily);
      return fontFamily;
    } catch (error) {
      console.warn(
        "Failed to read bundled Poppins fonts, falling back to Helvetica:",
        error instanceof Error ? error.message : error,
      );
      this.cachedFontFamilies.set(cacheKey, HELVETICA_FALLBACK);
      return HELVETICA_FALLBACK;
    }
  }
}

// Export a default instance
export const fontLoader = new FontLoader();
