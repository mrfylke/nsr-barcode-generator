import { promises as fs } from "fs";
import { join } from "path";

export interface FontVariant {
  weight: string;
  style: string;
  url: string;
  filename: string;
}

export interface FontFamily {
  regular: string;
  bold: string;
}

/**
 * Downloads and caches Google Fonts for use in PDFs
 */
export class FontLoader {
  private fontsDir: string;
  private cachedFonts: Map<string, FontFamily> = new Map();

  constructor(fontsDir?: string) {
    this.fontsDir = fontsDir || join(process.cwd(), ".fonts");
  }

  /**
   * Ensures the fonts directory exists
   */
  private async ensureFontsDirectory(): Promise<void> {
    try {
      await fs.access(this.fontsDir);
    } catch {
      await fs.mkdir(this.fontsDir, { recursive: true });
    }
  }

  /**
   * Downloads a font file from a URL
   */
  private async downloadFont(url: string, filepath: string): Promise<void> {
    try {
      // Check if file already exists
      await fs.access(filepath);
      console.log(`Font already cached: ${filepath}`);
      return;
    } catch {
      // File doesn't exist, download it
    }

    console.log(`Downloading font: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to download font: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    await fs.writeFile(filepath, uint8Array);
    console.log(`Font downloaded and cached: ${filepath}`);
  }

  /**
   * Gets direct TTF font URLs for Poppins from a reliable CDN
   */
  private getPoppinsTtfUrls(): FontVariant[] {
    // Use direct TTF URLs from a reliable CDN that serves TTF files
    return [
      {
        weight: "400",
        style: "normal",
        url: "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Regular.ttf",
        filename: "poppins-400-normal.ttf",
      },
      {
        weight: "700",
        style: "normal",
        url: "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf",
        filename: "poppins-700-normal.ttf",
      },
    ];
  }

  /**
   * Loads Poppins font family (regular and bold weights)
   */
  async loadPoppins(): Promise<FontFamily> {
    const cacheKey = "poppins";

    // Return cached fonts if available
    if (this.cachedFonts.has(cacheKey)) {
      return this.cachedFonts.get(cacheKey)!;
    }

    await this.ensureFontsDirectory();

    try {
      // Get direct TTF font URLs
      const variants = this.getPoppinsTtfUrls();

      // Find regular and bold variants
      const regularVariant = variants.find(
        (v) => v.weight === "400" && v.style === "normal"
      );
      const boldVariant = variants.find(
        (v) => v.weight === "700" && v.style === "normal"
      );

      if (!regularVariant || !boldVariant) {
        throw new Error("Could not find required Poppins font variants");
      }

      // Download the fonts
      const regularPath = join(this.fontsDir, regularVariant.filename);
      const boldPath = join(this.fontsDir, boldVariant.filename);

      await Promise.all([
        this.downloadFont(regularVariant.url, regularPath),
        this.downloadFont(boldVariant.url, boldPath),
      ]);

      const fontFamily: FontFamily = {
        regular: regularPath,
        bold: boldPath,
      };

      // Cache the result
      this.cachedFonts.set(cacheKey, fontFamily);

      return fontFamily;
    } catch (error) {
      console.error("Failed to load Poppins font:", error);

      // Fallback to system fonts
      const fallbackFamily: FontFamily = {
        regular: "Helvetica",
        bold: "Helvetica-Bold",
      };

      this.cachedFonts.set(cacheKey, fallbackFamily);
      return fallbackFamily;
    }
  }

  /**
   * Clears the font cache directory
   */
  async clearCache(): Promise<void> {
    try {
      await fs.rmdir(this.fontsDir, { recursive: true });
      this.cachedFonts.clear();
      console.log("Font cache cleared");
    } catch (error) {
      console.warn("Failed to clear font cache:", error);
    }
  }
}

// Export a default instance
export const fontLoader = new FontLoader();
