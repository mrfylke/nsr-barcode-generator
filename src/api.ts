/**
 * Application API Layer - Core functionality for NSR barcode generation
 * This module provides programmatic access to PDF generation functionality
 */

import { readFile } from "./utils/fileReader";
import {
  parseUniqueIds,
  formatIdCountResult,
  IdParseError,
  IdParseResult,
} from "./utils/idParser";
import {
  generatePdfsForIds,
  PdfGenerationOptions,
  PdfGenerationResult,
  PdfStyleConfig,
} from "./utils/pdfGenerator";

/**
 * Options for processing a file containing NSR IDs
 */
export interface ProcessFileOptions {
  /** Path to the input file containing NSR IDs */
  filePath: string;
  /** Output directory for generated PDFs */
  outputDirectory: string;
  /** PDF format (defaults to A4) */
  format?: "A4" | "A3" | "Letter";
  /** Style configuration for PDF appearance */
  style?: PdfStyleConfig;
}

/**
 * Result of processing a file with NSR IDs
 */
export interface ProcessFileResult {
  /** Parsing result with statistics */
  parseResult: IdParseResult;
  /** PDF generation result */
  pdfResult: PdfGenerationResult;
  /** Formatted summary string */
  summary: string;
}

/**
 * Options for generating a PDF from a single NSR ID
 */
export interface GenerateSinglePdfOptions {
  /** The NSR ID (e.g., "NSR:StopPlace:39598") */
  nsrId: string;
  /** Output directory for generated PDF */
  outputDirectory: string;
  /** PDF format (defaults to A4) */
  format?: "A4" | "A3" | "Letter";
  /** Style configuration for PDF appearance */
  style?: PdfStyleConfig;
}

/**
 * Result of generating a single PDF
 */
export interface GenerateSinglePdfResult {
  /** PDF generation result */
  pdfResult: PdfGenerationResult;
  /** Whether the generation was successful */
  success: boolean;
  /** Summary message */
  summary: string;
}

/**
 * Validation result for NSR ID format
 */
export interface ValidationResult {
  /** Whether the ID is valid */
  isValid: boolean;
  /** Error message if invalid */
  error?: string;
}

/**
 * Core API class for NSR barcode generation
 */
export class NsrBarcodeApi {
  /**
   * Process a file containing NSR IDs and generate PDFs for all unique IDs
   * @param options - File processing options
   * @returns Promise that resolves to the processing result
   */
  static async processFile(
    options: ProcessFileOptions
  ): Promise<ProcessFileResult> {
    const { filePath, outputDirectory, format, style } = options;

    try {
      // Read and parse the file
      const content = await readFile(filePath);
      const parseResult = await parseUniqueIds(content);

      // Generate PDFs for all unique IDs
      const uniqueIdsArray = Array.from(parseResult.uniqueIds);
      const pdfOptions: PdfGenerationOptions = { outputDirectory };
      if (format) {
        pdfOptions.format = format;
      }
      if (style) {
        pdfOptions.style = style;
      }
      const pdfResult = await generatePdfsForIds(uniqueIdsArray, pdfOptions);

      // Create summary
      const parseSummary = formatIdCountResult(parseResult);
      const pdfSummary = `Generated ${pdfResult.totalGenerated} PDF files in ${pdfResult.outputDirectory}`;
      const summary = `${parseSummary}\n\n${pdfSummary}`;

      return {
        parseResult,
        pdfResult,
        summary,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("An unexpected error occurred during file processing");
    }
  }

  /**
   * Generate a PDF for a single NSR ID
   * @param options - Single PDF generation options
   * @returns Promise that resolves to the generation result
   */
  static async generateSinglePdf(
    options: GenerateSinglePdfOptions
  ): Promise<GenerateSinglePdfResult> {
    const { nsrId, outputDirectory, format, style } = options;

    try {
      // Validate the NSR ID format
      const validation = this.validateNsrId(nsrId);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      // Generate PDF
      const pdfOptions: PdfGenerationOptions = { outputDirectory };
      if (format) {
        pdfOptions.format = format;
      }
      if (style) {
        pdfOptions.style = style;
      }
      const pdfResult = await generatePdfsForIds([nsrId], pdfOptions);

      const success = pdfResult.totalGenerated > 0;
      const summary = success
        ? `Successfully generated PDF for ${nsrId} in ${pdfResult.outputDirectory}`
        : `Failed to generate PDF for ${nsrId}`;

      return {
        pdfResult,
        success,
        summary,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("An unexpected error occurred during PDF generation");
    }
  }

  /**
   * Generate PDFs for multiple NSR IDs
   * @param nsrIds - Array of NSR IDs
   * @param options - PDF generation options
   * @returns Promise that resolves to the generation result
   */
  static async generateMultiplePdfs(
    nsrIds: string[],
    options: PdfGenerationOptions
  ): Promise<PdfGenerationResult> {
    // Validate all NSR IDs
    for (const nsrId of nsrIds) {
      const validation = this.validateNsrId(nsrId);
      if (!validation.isValid) {
        throw new Error(`Invalid NSR ID "${nsrId}": ${validation.error}`);
      }
    }

    return generatePdfsForIds(nsrIds, options);
  }

  /**
   * Validate NSR ID format
   * @param nsrId - The NSR ID to validate
   * @returns Validation result
   */
  static validateNsrId(nsrId: string): ValidationResult {
    if (!nsrId) {
      return {
        isValid: false,
        error: "NSR ID cannot be empty",
      };
    }

    if (!nsrId.startsWith("NSR:StopPlace:")) {
      return {
        isValid: false,
        error: "Invalid NSR ID format. Expected format: NSR:StopPlace:XXXXX",
      };
    }

    const parts = nsrId.split(":");
    if (parts.length !== 3) {
      return {
        isValid: false,
        error: "Invalid NSR ID format. Expected format: NSR:StopPlace:XXXXX",
      };
    }

    const idPart = parts[2];
    if (!idPart || !/^\d+$/.test(idPart)) {
      return {
        isValid: false,
        error: "Invalid NSR ID format. ID part must be numeric",
      };
    }

    return { isValid: true };
  }

  /**
   * Parse and validate IDs from file content without generating PDFs
   * @param content - File content to parse
   * @returns Promise that resolves to the parse result
   */
  static async parseIds(content: string): Promise<IdParseResult> {
    return parseUniqueIds(content);
  }

  /**
   * Parse and validate IDs from a file without generating PDFs
   * @param filePath - Path to the file to parse
   * @returns Promise that resolves to the parse result
   */
  static async parseIdsFromFile(filePath: string): Promise<IdParseResult> {
    const content = await readFile(filePath);
    return parseUniqueIds(content);
  }
}

// Export types and errors for external use
export {
  IdParseResult,
  IdParseError,
  PdfGenerationOptions,
  PdfGenerationResult,
  PdfStyleConfig,
  formatIdCountResult,
};

// Default export
export default NsrBarcodeApi;
