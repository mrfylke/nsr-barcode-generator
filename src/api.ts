/**
 * Application API Layer - Core functionality for NSR barcode generation
 * This module provides programmatic access to PDF generation functionality
 */

import { readFile } from "./utils/fileReader";
import {
  formatIdCountResult,
  IdParseError,
  IdParseResult,
  parseUniqueIds,
} from "./utils/idParser";
import { extractStopPlaceNumber, isValidNsrStopPlaceId } from "./utils/nsrId";
import {
  DataFetchingBatchProgressEvent,
  DataFetchingProgressEvent,
  GenerationProgressEvent,
  generatePdfsForStopPlaces,
  PdfGenerationFailure,
  PdfGenerationItemResult,
  PdfGenerationOptions,
  PdfGenerationResult,
  PdfProgressEvent,
  PdfStyleConfig,
  StopPlaceId,
  StopPlaceInput,
  StopPlaceQrContext,
  StopPlaceRequest,
} from "./utils/pdfGenerator";
import {
  loadFramPosterConfig,
  loadPosterConfig,
  PosterColors,
  PosterConfig,
  PosterLayoutConfig,
  PosterLogoConfig,
  PosterSection,
  PosterTextGroup,
  validatePosterConfig,
} from "./utils/posterConfig";

/**
 * Options shared by all PDF-generating API entry points, beyond the base
 * output/format/orientation/style options.
 */
interface CommonPdfOptions {
  /** Absolute path to copied package assets for bundled executables. */
  assetsDirectory?: string;
  /** PDF format (defaults to A4) */
  format?: "A4" | "A3" | "Letter";
  /** PDF orientation (defaults to landscape) */
  orientation?: "landscape" | "portrait";
  /** Style configuration for PDF appearance */
  style?: PdfStyleConfig;
  /** Complete poster content and branding configuration. */
  posterConfig?: PosterConfig;
  /**
   * Builds the complete QR code URL for a stop place. Falls back to the
   * package's built-in departures URL when omitted.
   */
  generateQrUrl?: (stopPlace: StopPlaceQrContext) => string;
  /** Replace existing output files instead of skipping them (defaults to false) */
  overwrite?: boolean;
  /**
   * Called once per requested NSR ID as processing progresses - first with
   * `type: "data-fetching"` events while stop place metadata is resolved
   * from Entur, then with `type: "generation"` events as each PDF is
   * written.
   */
  onProgress?: (event: PdfProgressEvent) => void;
  /** Overrides how stop place metadata is fetched (defaults to the Entur API) */
  stopPlaceFetcher?: PdfGenerationOptions["stopPlaceFetcher"];
  /**
   * When true, a supplied `name`/`StopPlaceInput` that omits transport mode
   * still triggers an Entur lookup for just the transport mode (used to
   * pick the correct poster icon); the supplied name is never overwritten.
   * Defaults to false, which falls back to the default bus icon and never
   * fetches. Has no effect on IDs without any locally-supplied metadata -
   * those are always fetched from Entur regardless of this option.
   */
  enrichTransportMode?: boolean;
}

/**
 * Options for processing a file containing NSR IDs
 */
export interface ProcessFileOptions extends CommonPdfOptions {
  /** Path to the input file containing NSR IDs */
  filePath: string;
  /** Output directory for generated PDFs */
  outputDirectory: string;
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
export interface GenerateSinglePdfOptions extends CommonPdfOptions {
  /** The NSR ID (e.g., "NSR:StopPlace:39598") */
  nsrId: string;
  /** Output directory for generated PDF */
  outputDirectory: string;
  /**
   * Already-known stop-place name. When supplied, Entur is never queried
   * for this ID - the name is used directly.
   */
  name?: string;
  /** Transport mode(s) for this stop place, used to pick the poster icon. Only used together with `name`. */
  transportMode?: string[];
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
 * Builds a fully-populated PdfGenerationOptions object from the common
 * optional fields, respecting `exactOptionalPropertyTypes`.
 */
function buildPdfOptions(
  outputDirectory: string,
  options: CommonPdfOptions,
): PdfGenerationOptions {
  const pdfOptions: PdfGenerationOptions = { outputDirectory };
  if (options.assetsDirectory) {
    pdfOptions.assetsDirectory = options.assetsDirectory;
  }
  if (options.format) {
    pdfOptions.format = options.format;
  }
  if (options.orientation) {
    pdfOptions.orientation = options.orientation;
  }
  if (options.style) {
    pdfOptions.style = options.style;
  }
  if (options.posterConfig) {
    pdfOptions.posterConfig = options.posterConfig;
  }
  if (options.generateQrUrl) {
    pdfOptions.generateQrUrl = options.generateQrUrl;
  }
  if (options.overwrite !== undefined) {
    pdfOptions.overwrite = options.overwrite;
  }
  if (options.onProgress) {
    pdfOptions.onProgress = options.onProgress;
  }
  if (options.stopPlaceFetcher) {
    pdfOptions.stopPlaceFetcher = options.stopPlaceFetcher;
  }
  if (options.enrichTransportMode !== undefined) {
    pdfOptions.enrichTransportMode = options.enrichTransportMode;
  }
  return pdfOptions;
}

/**
 * Validate NSR ID format
 * @param nsrId - The NSR ID to validate
 * @returns Validation result
 */
function validateNsrId(nsrId: string): ValidationResult {
  if (!nsrId) {
    return {
      isValid: false,
      error: "NSR ID cannot be empty",
    };
  }

  if (!isValidNsrStopPlaceId(nsrId)) {
    return {
      isValid: false,
      error:
        "Invalid NSR ID format. Expected format: NSR:StopPlace:<digits> with no extra whitespace or characters",
    };
  }

  return { isValid: true };
}

/**
 * Process a file containing NSR IDs and generate PDFs for all unique IDs
 * @param options - File processing options
 * @returns Promise that resolves to the processing result
 */
async function processFile(
  options: ProcessFileOptions,
): Promise<ProcessFileResult> {
  const { filePath, outputDirectory } = options;

  try {
    // Read and parse the file
    const content = await readFile(filePath);
    const parseResult = await parseUniqueIds(content);

    // Validate all NSR IDs
    const uniqueIdsArray = Array.from(parseResult.uniqueIds);
    for (const nsrId of uniqueIdsArray) {
      const validation = validateNsrId(nsrId);
      if (!validation.isValid) {
        throw new Error(`Invalid NSR ID "${nsrId}": ${validation.error}`);
      }
    }

    // Generate PDFs for all unique IDs
    const pdfOptions = buildPdfOptions(outputDirectory, options);
    const pdfResult = await generatePdfsForStopPlaces(
      uniqueIdsArray,
      pdfOptions,
    );

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
async function generateSinglePdf(
  options: GenerateSinglePdfOptions,
): Promise<GenerateSinglePdfResult> {
  const { nsrId, outputDirectory, name, transportMode } = options;

  try {
    // Validate the NSR ID format
    const validation = validateNsrId(nsrId);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Generate PDF. When `name` is supplied, skip Entur entirely for this ID.
    const request: StopPlaceRequest = name
      ? { id: nsrId, name, ...(transportMode ? { transportMode } : {}) }
      : nsrId;
    const pdfOptions = buildPdfOptions(outputDirectory, options);
    const pdfResult = await generatePdfsForStopPlaces([request], pdfOptions);

    const success =
      pdfResult.totalGenerated > 0 || pdfResult.skipped.length > 0;
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
 * Generate PDFs for multiple stop places. Each entry is either a bare NSR
 * ID (resolved via Entur) or a {@link StopPlaceInput} object carrying
 * already-known metadata (Entur is never queried for that ID). Mixing the
 * two forms in a single array is supported. If an ID appears more than
 * once, the last entry for that ID wins.
 * @param stopPlaces - Array of NSR IDs and/or known stop-place data
 * @param options - PDF generation options
 * @returns Promise that resolves to the generation result
 */
async function generateMultiplePdfs(
  stopPlaces: StopPlaceRequest[],
  options: PdfGenerationOptions,
): Promise<PdfGenerationResult> {
  // Validate all NSR IDs
  for (const request of stopPlaces) {
    const nsrId = typeof request === "string" ? request : request.id;
    const validation = validateNsrId(nsrId);
    if (!validation.isValid) {
      throw new Error(`Invalid NSR ID "${nsrId}": ${validation.error}`);
    }
  }

  return generatePdfsForStopPlaces(stopPlaces, options);
}

/**
 * Parse and validate IDs from file content without generating PDFs
 * @param content - File content to parse
 * @returns Promise that resolves to the parse result
 */
async function parseIds(content: string): Promise<IdParseResult> {
  return parseUniqueIds(content);
}

/**
 * Parse and validate IDs from a file without generating PDFs
 * @param filePath - Path to the file to parse
 * @returns Promise that resolves to the parse result
 */
async function parseIdsFromFile(filePath: string): Promise<IdParseResult> {
  const content = await readFile(filePath);
  return parseUniqueIds(content);
}

/**
 * Core API for NSR barcode generation
 */
export const NsrBarcodeApi = {
  processFile,
  generateSinglePdf,
  generateMultiplePdfs,
  validateNsrId,
  parseIds,
  parseIdsFromFile,
  loadPosterConfig,
  loadFramPosterConfig,
  validatePosterConfig,
};

// Export types and errors for external use
export {
  DataFetchingBatchProgressEvent,
  DataFetchingProgressEvent,
  extractStopPlaceNumber,
  formatIdCountResult,
  GenerationProgressEvent,
  IdParseError,
  IdParseResult,
  PdfGenerationFailure,
  PdfGenerationItemResult,
  PdfGenerationOptions,
  PdfGenerationResult,
  PdfProgressEvent,
  PdfStyleConfig,
  PosterColors,
  PosterConfig,
  PosterLayoutConfig,
  PosterLogoConfig,
  PosterSection,
  PosterTextGroup,
  StopPlaceId,
  StopPlaceInput,
  StopPlaceQrContext,
  StopPlaceRequest,
};

// Default export
export default NsrBarcodeApi;
