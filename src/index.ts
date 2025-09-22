#!/usr/bin/env node

import { Command } from "commander";
import { readFile } from "./utils/fileReader";
import {
  parseUniqueIds,
  formatIdCountResult,
  IdParseError,
} from "./utils/idParser";
import { generatePdfsForIds } from "./utils/pdfGenerator";
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
  .description("Generate PDF files for unique IDs from an input file")
  .action(async (filePath: string, options: { output: string }) => {
    try {
      const content = await readFile(filePath);
      const result = await parseUniqueIds(content);
      console.log(formatIdCountResult(result));

      // Generate PDFs for all unique IDs
      console.log(`\nGenerating PDFs in directory: ${options.output}`);
      const uniqueIdsArray = Array.from(result.uniqueIds);

      const pdfResult = await generatePdfsForIds(uniqueIdsArray, {
        outputDirectory: options.output,
      });

      console.log(`\nPDF Generation Complete:`);
      console.log(`- Generated ${pdfResult.totalGenerated} PDF files`);
      console.log(`- Output directory: ${pdfResult.outputDirectory}`);

      if (pdfResult.totalGenerated !== uniqueIdsArray.length) {
        console.warn(
          `Warning: Only ${pdfResult.totalGenerated} of ${uniqueIdsArray.length} PDFs were generated successfully`
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        // Handle specific ID parsing errors
        if ("code" in error) {
          const idError = error as IdParseError;
          switch (idError.code) {
            case "EMPTY_FILE":
              console.error(
                `Error: Input file is empty or contains no content`
              );
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
  });

program
  .command("id")
  .argument("<nsrId>", "single NSR ID (e.g., NSR:StopPlace:39598)")
  .requiredOption(
    "-o, --output <directory>",
    "output directory for generated PDF"
  )
  .description("Generate PDF for a single NSR ID")
  .action(async (nsrId: string, options: { output: string }) => {
    try {
      // Validate the NSR ID format
      if (!nsrId.startsWith("NSR:StopPlace:")) {
        console.error(
          `Error: Invalid NSR ID format. Expected format: NSR:StopPlace:XXXXX`
        );
        process.exit(1);
      }

      console.log(`Generating PDF for ID: ${nsrId}`);
      console.log(`Output directory: ${options.output}`);

      const pdfResult = await generatePdfsForIds([nsrId], {
        outputDirectory: options.output,
      });

      console.log(`\nPDF Generation Complete:`);
      console.log(`- Generated ${pdfResult.totalGenerated} PDF file`);
      console.log(`- Output directory: ${pdfResult.outputDirectory}`);

      if (pdfResult.totalGenerated === 0) {
        console.error(`Error: Failed to generate PDF for ID: ${nsrId}`);
        process.exit(1);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error("An unexpected error occurred");
      }
      process.exit(1);
    }
  });

// Handle case where no arguments are provided
if (process.argv.length === 2) {
  program.help();
}

program.parse();
