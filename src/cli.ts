#!/usr/bin/env node

/**
 * CLI Interface for NSR Barcode Generator
 * This file contains only CLI-specific code and delegates to the API layer
 */

import { Command } from "commander";
import { NsrBarcodeApi, IdParseError, PdfStyleConfig } from "./api";
import { version } from "../package.json";

const program = new Command();

program
  .name("nsr-barcode")
  .description("Generate PDF files for unique IDs from input files")
  .version(version);

program
  .command("file")
  .argument("<file>", "path to the file containing IDs (one per line)")
  .requiredOption(
    "-o, --output <directory>",
    "output directory for generated PDFs"
  )
  .option("-f, --format <format>", "PDF format (A4, A3, Letter)", "A4")
  .option(
    "--header-color <color>",
    "Header and footer background color (hex format, e.g., #1A4D75)"
  )
  .option(
    "--logo-path <path>",
    "Path to logo image file for lower right corner"
  )
  .option("--logo-width <width>", "Logo width in pixels", parseInt)
  .option("--fallback-text <text>", "Fallback text if logo cannot be loaded")
  .option("--fallback-subtext <text>", "Additional fallback text (subtitle)")
  .description("Generate PDF files for unique IDs from an input file")
  .action(
    async (
      filePath: string,
      options: {
        output: string;
        format?: string;
        headerColor?: string;
        logoPath?: string;
        logoWidth?: number;
        fallbackText?: string;
        fallbackSubtext?: string;
      }
    ) => {
      try {
        // Validate format option
        const format = options.format as "A4" | "A3" | "Letter" | undefined;
        if (format && !["A4", "A3", "Letter"].includes(format)) {
          console.error(
            `Error: Invalid format "${format}". Supported formats: A4, A3, Letter`
          );
          process.exit(1);
        }

        console.log(`Processing file: ${filePath}`);
        console.log(`Output directory: ${options.output}`);
        if (format && format !== "A4") {
          console.log(`PDF format: ${format}`);
        }

        // Build style configuration
        const styleConfig: PdfStyleConfig = {};
        if (options.headerColor) {
          styleConfig.headerFooterColor = options.headerColor;
        }
        if (options.logoPath) {
          styleConfig.logoPath = options.logoPath;
        }
        if (options.logoWidth) {
          styleConfig.logoWidth = options.logoWidth;
        }
        if (options.fallbackText) {
          styleConfig.fallbackLogoText = options.fallbackText;
        }
        if (options.fallbackSubtext) {
          styleConfig.fallbackLogoSubtext = options.fallbackSubtext;
        }

        const processOptions: Parameters<typeof NsrBarcodeApi.processFile>[0] =
          {
            filePath,
            outputDirectory: options.output,
          };
        if (format && format !== "A4") {
          processOptions.format = format;
        }
        if (Object.keys(styleConfig).length > 0) {
          processOptions.style = styleConfig;
        }

        const result = await NsrBarcodeApi.processFile(processOptions);

        console.log("\n" + result.summary);

        // Show warning if not all PDFs were generated successfully
        const uniqueIdsCount = result.parseResult.uniqueIds.size;
        if (result.pdfResult.totalGenerated !== uniqueIdsCount) {
          console.warn(
            `\nWarning: Only ${result.pdfResult.totalGenerated} of ${uniqueIdsCount} PDFs were generated successfully`
          );
        }
      } catch (error) {
        handleError(error);
      }
    }
  );

program
  .command("id")
  .argument("<nsrId>", "single NSR ID (e.g., NSR:StopPlace:39598)")
  .requiredOption(
    "-o, --output <directory>",
    "output directory for generated PDF"
  )
  .option("-f, --format <format>", "PDF format (A4, A3, Letter)", "A4")
  .option(
    "--header-color <color>",
    "Header and footer background color (hex format, e.g., #1A4D75)"
  )
  .option(
    "--logo-path <path>",
    "Path to logo image file for lower right corner"
  )
  .option("--logo-width <width>", "Logo width in pixels", parseInt)
  .option("--fallback-text <text>", "Fallback text if logo cannot be loaded")
  .option("--fallback-subtext <text>", "Additional fallback text (subtitle)")
  .description("Generate PDF for a single NSR ID")
  .action(
    async (
      nsrId: string,
      options: {
        output: string;
        format?: string;
        headerColor?: string;
        logoPath?: string;
        logoWidth?: number;
        fallbackText?: string;
        fallbackSubtext?: string;
      }
    ) => {
      try {
        // Validate format option
        const format = options.format as "A4" | "A3" | "Letter" | undefined;
        if (format && !["A4", "A3", "Letter"].includes(format)) {
          console.error(
            `Error: Invalid format "${format}". Supported formats: A4, A3, Letter`
          );
          process.exit(1);
        }

        console.log(`Generating PDF for ID: ${nsrId}`);
        console.log(`Output directory: ${options.output}`);
        if (format && format !== "A4") {
          console.log(`PDF format: ${format}`);
        }

        // Build style configuration
        const styleConfig: PdfStyleConfig = {};
        if (options.headerColor) {
          styleConfig.headerFooterColor = options.headerColor;
        }
        if (options.logoPath) {
          styleConfig.logoPath = options.logoPath;
        }
        if (options.logoWidth) {
          styleConfig.logoWidth = options.logoWidth;
        }
        if (options.fallbackText) {
          styleConfig.fallbackLogoText = options.fallbackText;
        }
        if (options.fallbackSubtext) {
          styleConfig.fallbackLogoSubtext = options.fallbackSubtext;
        }

        const generateOptions: Parameters<
          typeof NsrBarcodeApi.generateSinglePdf
        >[0] = {
          nsrId,
          outputDirectory: options.output,
        };
        if (format && format !== "A4") {
          generateOptions.format = format;
        }
        if (Object.keys(styleConfig).length > 0) {
          generateOptions.style = styleConfig;
        }

        const result = await NsrBarcodeApi.generateSinglePdf(generateOptions);

        console.log("\n" + result.summary);

        if (!result.success) {
          console.error(`Error: Failed to generate PDF for ID: ${nsrId}`);
          process.exit(1);
        }
      } catch (error) {
        handleError(error);
      }
    }
  );

program
  .command("validate")
  .argument("<nsrId>", "NSR ID to validate (e.g., NSR:StopPlace:39598)")
  .description("Validate NSR ID format without generating PDF")
  .action((nsrId: string) => {
    const validation = NsrBarcodeApi.validateNsrId(nsrId);

    if (validation.isValid) {
      console.log(`✓ Valid NSR ID: ${nsrId}`);
    } else {
      console.error(`✗ Invalid NSR ID: ${validation.error}`);
      process.exit(1);
    }
  });

program
  .command("parse")
  .argument("<file>", "path to the file containing IDs (one per line)")
  .description("Parse and validate IDs from file without generating PDFs")
  .action(async (filePath: string) => {
    try {
      console.log(`Parsing file: ${filePath}`);

      const result = await NsrBarcodeApi.parseIdsFromFile(filePath);
      const summary = require("./utils/idParser").formatIdCountResult(result);

      console.log("\n" + summary);
      console.log(`\nUnique IDs found:`);
      Array.from(result.uniqueIds).forEach((id, index) => {
        console.log(`${index + 1}. ${id}`);
      });
    } catch (error) {
      handleError(error);
    }
  });

/**
 * Handle CLI errors with appropriate error messages and exit codes
 */
function handleError(error: unknown): void {
  if (error instanceof Error) {
    // Handle specific ID parsing errors
    if ("code" in error) {
      const idError = error as IdParseError;
      switch (idError.code) {
        case "EMPTY_FILE":
          console.error(`Error: Input file is empty or contains no content`);
          break;
        case "NO_VALID_IDS":
          console.error(`Error: No valid IDs found in the file`);
          break;
        case "INVALID_FORMAT":
          console.error(`Error: ${idError.message}`);
          break;
        default:
          console.error(`Error: ${error.message}`);
      }
    } else {
      console.error(`Error: ${error.message}`);
    }
  } else {
    console.error("An unexpected error occurred");
  }
  process.exit(1);
}

// Handle case where no arguments are provided
if (process.argv.length === 2) {
  program.help();
}

program.parse();
