import { createWriteStream, promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import PDFDocument from "pdfkit";
import * as QRCode from "qrcode";
import { resolveAssetPath } from "./assets";
import {
  enturApi,
  type StopPlaceBatchProgressEvent,
  type StopPlaceFetchProgressEvent,
  type StopPlaceInfo,
} from "./enturApi";
import { fontLoader } from "./fontLoader";
import {
  type PosterConfig,
  type PosterConfigSource,
  renderPosterTemplate,
  resolvePosterConfig,
} from "./posterConfig";

/**
 * Context passed to a `generateQrUrl` callback once Entur metadata has been
 * resolved for a stop place.
 */
export interface StopPlaceQrContext {
  /** Full ID, for example "NSR:StopPlace:10003". */
  id: string;
  /** Resolved stop-place name from Entur. */
  name: string;
}

/**
 * Per-item progress event emitted while stop place metadata is being fetched
 * from Entur (or a custom `stopPlaceFetcher`), ahead of PDF generation.
 */
export interface DataFetchingProgressEvent {
  type: "data-fetching";
  current: number;
  total: number;
  nsrId: string;
  status: "fetched" | "error";
  error?: string;
}

/**
 * Emitted once per batch while stop place metadata is being fetched from
 * Entur, after a batch finishes and before the wait ahead of the next one.
 */
export interface DataFetchingBatchProgressEvent {
  type: "data-fetching-batch";
  batchNumber: number;
  totalBatches: number;
  delayMs: number;
}

/**
 * Per-item progress event emitted as each requested PDF is generated.
 */
export interface GenerationProgressEvent {
  type: "generation";
  current: number;
  total: number;
  nsrId: string;
  outputPath?: string;
  status: "generated" | "skipped" | "error";
  error?: string;
}

/**
 * Progress event emitted during batch PDF generation, distinguished by
 * `type` - `"data-fetching"` while stop place metadata is being resolved
 * from Entur, `"data-fetching-batch"` between fetch batches, `"generation"`
 * while PDFs are being written.
 */
export type PdfProgressEvent =
  | DataFetchingProgressEvent
  | DataFetchingBatchProgressEvent
  | GenerationProgressEvent;

/**
 * Full NSR ID string, e.g. "NSR:StopPlace:10003". Aliased purely for
 * readability at call sites that accept either a bare ID or a
 * {@link StopPlaceInput}.
 */
export type StopPlaceId = string;

/**
 * Stop-place metadata the caller already knows, supplied directly instead of
 * being looked up from Entur.
 */
export interface StopPlaceInput {
  /** Full NSR ID, for example "NSR:StopPlace:10003". */
  id: StopPlaceId;
  /** Resolved stop-place name to use for this ID. */
  name: string;
  /** Transport mode(s) for this stop place, used to pick the poster icon. */
  transportMode?: string[];
}

/**
 * A single item to generate a poster for: either a bare NSR ID (its
 * metadata is resolved via Entur) or a fully-specified {@link StopPlaceInput}
 * (Entur is never queried for it). There is deliberately no separate
 * "list of IDs" plus "list of overrides" - a request and its metadata are
 * the same piece of information, so they travel together in one array.
 */
export type StopPlaceRequest = StopPlaceId | StopPlaceInput;

export interface PdfGenerationOptions {
  outputDirectory: string;
  /**
   * Absolute path to a copied package `assets` directory. Use this when a
   * bundler rewrites `__dirname` while producing a standalone executable.
   */
  assetsDirectory?: string;
  format?: "A4" | "A3" | "Letter";
  /** PDF orientation (defaults to landscape) */
  orientation?: "landscape" | "portrait";
  /**
   * Builds the complete QR code URL for a stop place, called after stop
   * place metadata has been resolved (either from Entur or supplied
   * directly via a {@link StopPlaceInput}). The returned string is used
   * verbatim as the QR payload (no prefixing, encoding, or rewriting). Must
   * resolve to a non-empty, absolute http(s) URL; otherwise that item is
   * reported as a generation error. When omitted, falls back to the
   * package's built-in departures URL for backward compatibility.
   */
  generateQrUrl?: (stopPlace: StopPlaceQrContext) => string;
  /**
   * Complete poster definition or the name of a built-in poster pack. When
   * omitted, the bundled `fram` pack is used.
   */
  posterConfig?: PosterConfigSource;
  /** Replace an existing output file instead of skipping it (defaults to false) */
  overwrite?: boolean;
  /**
   * Called once per requested NSR ID as batch processing progresses -
   * first with `type: "data-fetching"` events while stop place metadata is
   * resolved from Entur, then with `type: "generation"` events as each PDF
   * is written. Note: fetching events are only emitted for the built-in
   * Entur fetcher; a custom `stopPlaceFetcher` does not report fetch
   * progress.
   */
  onProgress?: (event: PdfProgressEvent) => void;
  /**
   * Overrides how stop place metadata is fetched for requests that are bare
   * IDs (not a {@link StopPlaceInput}). Defaults to the built-in Entur
   * client. Useful for tests (avoids live network calls).
   */
  stopPlaceFetcher?: (ids: string[]) => Promise<(StopPlaceInfo | null)[]>;
  /**
   * When true, a {@link StopPlaceInput} that omits `transportMode` still
   * triggers an Entur (or `stopPlaceFetcher`) lookup for that ID, used
   * purely to fill in the poster icon's transport mode - the supplied
   * `name` is always kept as-is and never overwritten by the fetch.
   * `StopPlaceInput`s that already specify `transportMode` are never
   * fetched. If the enrichment lookup fails or returns no transport mode,
   * generation still proceeds (falls back to the default bus icon) rather
   * than failing the item - the name was already known, so a poster can
   * always be produced. Defaults to false (bus icon fallback, no fetch).
   */
  enrichTransportMode?: boolean;
}

export interface PdfGenerationItemResult {
  nsrId: string;
  outputPath: string;
}

export interface PdfGenerationFailure {
  nsrId: string;
  error: string;
  /** Attempted output path, when generation progressed far enough to determine it. */
  outputPath?: string;
}

export interface PdfGenerationResult {
  /** Paths of files generated in this run (excludes skipped files) */
  generatedFiles: string[];
  /** Count of files generated in this run (excludes skipped files) */
  totalGenerated: number;
  outputDirectory: string;
  /** IDs successfully generated in this run */
  generated: PdfGenerationItemResult[];
  /** IDs skipped because an output file already existed and overwrite was false */
  skipped: PdfGenerationItemResult[];
  /** IDs that failed to generate, with an error message */
  failed: PdfGenerationFailure[];
}

/**
 * Generates individual PDF files for each requested stop place. Each
 * request is either a bare NSR ID (resolved via Entur) or a
 * {@link StopPlaceInput} carrying already-known metadata (Entur is never
 * queried for that ID). If a request is duplicated by ID, the last one wins.
 * @param requests - Array of stop place requests to generate PDFs for
 * @param options - PDF generation options
 * @returns Promise that resolves to the generation result
 */
export async function generatePdfsForStopPlaces(
  requests: StopPlaceRequest[],
  options: PdfGenerationOptions,
): Promise<PdfGenerationResult> {
  const { outputDirectory, overwrite = false, onProgress } = options;

  // Ensure output directory exists
  await ensureDirectoryExists(outputDirectory);

  const generated: PdfGenerationItemResult[] = [];
  const skipped: PdfGenerationItemResult[] = [];
  const failed: PdfGenerationFailure[] = [];

  const posterConfig = await resolvePosterConfig(
    options.posterConfig,
    options.assetsDirectory,
  );

  const ids: string[] = requests.map((request) =>
    typeof request === "string" ? request : request.id,
  );

  const overridesById = new Map<string, StopPlaceInput>();
  for (const request of requests) {
    if (typeof request !== "string") {
      overridesById.set(request.id, request); // last one wins on duplicate IDs
    }
  }
  // Bare IDs always need a lookup. StopPlaceInputs only need one if the
  // caller opted into transport-mode enrichment and didn't already supply it.
  const idsNeedingFetch = ids.filter((id) => {
    const override = overridesById.get(id);
    if (!override) return true;
    return Boolean(options.enrichTransportMode) && !override.transportMode;
  });

  let fetchedInfos: (StopPlaceInfo | null)[] = [];
  if (idsNeedingFetch.length > 0) {
    const fetchStopPlaces =
      options.stopPlaceFetcher ??
      ((idsToFetch: string[]) =>
        enturApi.getMultipleStopPlaces(idsToFetch, {
          ...(onProgress
            ? {
                onProgress: (event: StopPlaceFetchProgressEvent) =>
                  onProgress({
                    type: "data-fetching",
                    current: event.current,
                    total: event.total,
                    nsrId: event.nsrId,
                    status: event.status,
                    ...(event.error ? { error: event.error } : {}),
                  }),
                onBatchComplete: (event: StopPlaceBatchProgressEvent) =>
                  onProgress({
                    type: "data-fetching-batch",
                    batchNumber: event.batchNumber,
                    totalBatches: event.totalBatches,
                    delayMs: event.delayMs,
                  }),
              }
            : {}),
        }));
    fetchedInfos = await fetchStopPlaces(idsNeedingFetch);
  }
  const fetchedById = new Map<string, StopPlaceInfo | null>(
    idsNeedingFetch.map((id, index) => [id, fetchedInfos[index] ?? null]),
  );

  const stopPlaceInfos: (StopPlaceInfo | null)[] = ids.map((id) => {
    const override = overridesById.get(id);
    if (override) {
      // The supplied name is authoritative and never overwritten by a fetch.
      const info: StopPlaceInfo = { id, name: override.name };
      const transportMode =
        override.transportMode ?? fetchedById.get(id)?.transportMode;
      if (transportMode) {
        info.transportMode = transportMode;
      }
      return info;
    }
    return fetchedById.get(id) ?? null;
  });

  const total = ids.length;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue; // Skip if ID is undefined
    const current = i + 1;
    let outputPath: string | undefined;

    try {
      const stopPlaceInfo = stopPlaceInfos[i] ?? null;

      if (!stopPlaceInfo) {
        throw new Error(`Failed to resolve stop place metadata for "${id}"`);
      }

      // Generate safe filename from ID and stop place name
      const filename = generateSafeFilename(id, stopPlaceInfo.name);
      outputPath = join(outputDirectory, `${filename}.pdf`);

      if (!overwrite && (await pathExists(outputPath))) {
        skipped.push({ nsrId: id, outputPath });
        onProgress?.({
          type: "generation",
          current,
          total,
          nsrId: id,
          outputPath,
          status: "skipped",
        });
        continue;
      }

      // Generate PDF with stop place information
      await generateSinglePdf(
        id,
        outputPath,
        stopPlaceInfo,
        options,
        posterConfig,
      );
      generated.push({ nsrId: id, outputPath });
      onProgress?.({
        type: "generation",
        current,
        total,
        nsrId: id,
        outputPath,
        status: "generated",
      });
    } catch (error) {
      const message = formatUnknownError(error);
      failed.push({
        nsrId: id,
        error: message,
        ...(outputPath ? { outputPath } : {}),
      });
      onProgress?.({
        type: "generation",
        current,
        total,
        nsrId: id,
        ...(outputPath ? { outputPath } : {}),
        status: "error",
        error: message,
      });
    }
  }

  return {
    generatedFiles: generated.map((item) => item.outputPath),
    totalGenerated: generated.length,
    outputDirectory: resolve(outputDirectory),
    generated,
    skipped,
    failed,
  };
}

const errorDetailKeys = ["code", "errno", "syscall", "path"] as const;

function safelyReadProperty(value: object, key: PropertyKey): unknown {
  try {
    return Reflect.get(value, key);
  } catch (error) {
    return `[Unreadable: ${formatUnknownError(error)}]`;
  }
}

function safelySerialize(value: unknown): string | undefined {
  const seen = new WeakSet<object>();

  const sanitize = (current: unknown, depth: number): unknown => {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return current;
    }
    if (typeof current === "number") {
      return Number.isFinite(current) ? current : String(current);
    }
    if (typeof current === "bigint" || typeof current === "symbol") {
      return String(current);
    }
    if (typeof current === "undefined") return "[undefined]";
    if (typeof current === "function") {
      return `[Function${current.name ? `: ${current.name}` : ""}]`;
    }
    if (depth >= 5) return "[Max depth]";
    if (seen.has(current)) return "[Circular]";
    seen.add(current);

    if (Array.isArray(current)) {
      return current.slice(0, 50).map((item) => sanitize(item, depth + 1));
    }

    let keys: PropertyKey[];
    try {
      keys = Reflect.ownKeys(current).slice(0, 50);
    } catch (error) {
      return `[Unreadable object: ${formatUnknownError(error)}]`;
    }

    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const printableKey = typeof key === "symbol" ? String(key) : key;
      result[printableKey] = sanitize(
        safelyReadProperty(current, key),
        depth + 1,
      );
    }
    return result;
  };

  try {
    const serialized = JSON.stringify(sanitize(value, 0));
    return serialized && serialized !== "{}" ? serialized : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Formats values thrown by libraries and runtimes without assuming they are
 * same-realm Error instances. This function must itself never throw.
 */
function formatUnknownError(
  error: unknown,
  seenCauses: WeakSet<object> = new WeakSet<object>(),
): string {
  try {
    if (typeof error === "string") return error || "Unknown error";
    if (
      typeof error === "number" ||
      typeof error === "bigint" ||
      typeof error === "boolean" ||
      typeof error === "symbol"
    ) {
      return String(error);
    }
    if (
      (typeof error !== "object" || error === null) &&
      typeof error !== "function"
    ) {
      return "Unknown error";
    }
    if (seenCauses.has(error)) return "[Circular]";
    seenCauses.add(error);

    const message = safelyReadProperty(error, "message");
    const name = safelyReadProperty(error, "name");
    const messageText =
      typeof message === "string" && message.length > 0 ? message : undefined;
    const nameText =
      typeof name === "string" && name.length > 0 ? name : undefined;

    let summary: string | undefined;
    if (messageText && nameText) {
      summary = `${nameText}: ${messageText}`;
    } else {
      summary = messageText ?? nameText;
    }

    const details: string[] = [];
    for (const key of errorDetailKeys) {
      const detail = safelyReadProperty(error, key);
      if (detail !== undefined && detail !== null && detail !== "") {
        const serialized =
          typeof detail === "string" ? detail : safelySerialize(detail);
        details.push(`${key}: ${serialized ?? String(detail)}`);
      }
    }

    const cause = safelyReadProperty(error, "cause");
    if (cause !== undefined && cause !== null && cause !== error) {
      details.push(`cause: ${formatUnknownError(cause, seenCauses)}`);
    } else if (cause === error) {
      details.push("cause: [Circular]");
    }

    if (summary) {
      return details.length > 0
        ? `${summary} (${details.join(", ")})`
        : summary;
    }

    if (details.length > 0) return details.join(", ");
    return safelySerialize(error) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}

/**
 * Validates that a value is a non-empty, syntactically valid absolute
 * http(s) URL.
 */
function isValidAbsoluteHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Generates a single PDF with centered ID and stop place information
 * @param id - The ID to display
 * @param outputPath - Output file path
 * @param stopPlaceInfo - Stop place information from Entur API
 * @param options - PDF generation options including poster configuration
 */
async function generateSinglePdf(
  id: string,
  outputPath: string,
  stopPlaceInfo: StopPlaceInfo,
  options?: PdfGenerationOptions,
  posterConfig?: PosterConfig,
): Promise<void> {
  type PdfGenerationStage =
    | "loading fonts/assets"
    | "creating the PDF document"
    | "rendering the header/content"
    | "building the QR URL"
    | "generating the QR code"
    | "finalizing the document"
    | "writing the PDF to disk";

  let stage: PdfGenerationStage = "writing the PDF to disk";
  let stream: ReturnType<typeof createWriteStream> | undefined;
  let streamCompletion: Promise<void> | undefined;
  let streamFailure: unknown;
  let hasStreamFailure = false;

  try {
    // Observe the output from the instant it exists. Open/write failures can
    // arrive before rendering completes on Windows and in runtimes like Bun.
    stream = createWriteStream(outputPath);
    streamCompletion = new Promise<void>((resolve, reject) => {
      stream?.once("finish", resolve);
      stream?.once("error", (error: unknown) => {
        hasStreamFailure = true;
        streamFailure = error;
        reject(error);
      });
    });
    // Rendering contains awaited operations, so mark the rejection handled
    // immediately and consume it at the end (or prioritize it in the catch).
    void streamCompletion.catch(() => undefined);

    stage = "loading fonts/assets";
    // Load Poppins fonts
    const fonts = await fontLoader.loadPoppins(options?.assetsDirectory);
    if (hasStreamFailure) throw streamFailure;

    // Get orientation (default to landscape for backward compatibility)
    const orientation = options?.orientation || "landscape";
    const format = options?.format || "A4";

    stage = "creating the PDF document";
    // Create a new PDF document with specified format/orientation
    const doc = new PDFDocument({
      font: fonts.regular,
      size: format,
      layout: orientation,
      margins: {
        top: 50,
        bottom: 50,
        left: 50,
        right: 50,
      },
    });

    // Register Poppins fonts with PDFKit
    let poppinsRegular = "Helvetica"; // Fallback
    let poppinsBold = "Helvetica-Bold"; // Fallback

    try {
      if (fonts.regular !== "Helvetica") {
        doc.registerFont("Poppins-Regular", fonts.regular);
        poppinsRegular = "Poppins-Regular";
      }
      if (fonts.bold !== "Helvetica-Bold") {
        doc.registerFont("Poppins-Bold", fonts.bold);
        poppinsBold = "Poppins-Bold";
      }
    } catch (fontError) {
      console.warn(
        "Failed to register Poppins fonts, using fallback:",
        fontError,
      );
    }

    doc.pipe(stream);

    stage = "rendering the header/content";
    // Get page dimensions
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    // The public entry point always resolves this once for the whole batch.
    const config =
      posterConfig ??
      (await resolvePosterConfig(undefined, options?.assetsDirectory));
    if (hasStreamFailure) throw streamFailure;

    const headerFooterColor = config.colors.headerFooter;
    const headerTextColor = config.colors.headerText;
    const bodyTextColor = config.colors.bodyText;
    const borderColor = config.colors.border;
    const logo = config.logo;

    // Add rounded border box around entire content
    const borderRadius = 15;
    const borderMargin = 20;
    const boxWidth = pageWidth - borderMargin * 2;
    const boxHeight = pageHeight - borderMargin * 2;

    doc
      .lineWidth(0.25)
      .roundedRect(
        borderMargin,
        borderMargin,
        boxWidth,
        boxHeight,
        borderRadius,
      )
      .stroke(borderColor);

    // Header section (blue background) - clipped to border box
    const headerHeight = 80;
    doc
      .save()
      .roundedRect(
        borderMargin,
        borderMargin,
        boxWidth,
        boxHeight,
        borderRadius,
      )
      .clip()
      .rect(borderMargin, borderMargin, boxWidth, headerHeight)
      .fill(headerFooterColor)
      .restore();

    // Add transport mode specific icon
    const iconX = 80;
    const iconY = 60;
    const iconSize = 50;

    try {
      // Determine icon based on transport mode
      const transportModes = stopPlaceInfo.transportMode || [];
      let iconFileName = "Bus.png"; // Default to bus

      // Check each transport mode (can be string or array of strings)
      const modes = Array.isArray(transportModes)
        ? transportModes
        : [transportModes];
      const modeString = modes.join(" ").toLowerCase();

      if (modeString.includes("water") || modeString.includes("boat")) {
        iconFileName = "Boat.png";
      } else if (modeString.includes("ferry")) {
        iconFileName = "Ferry.png";
      } else if (modeString.includes("bus")) {
        iconFileName = "Bus.png";
      }

      const iconPath = resolveAssetPath(
        options?.assetsDirectory,
        "images",
        iconFileName,
      );
      const iconBuffer = await fs.readFile(iconPath);

      // Add white circular background
      doc
        .lineWidth(3)
        .circle(iconX, iconY, iconSize / 2)
        .stroke(headerTextColor)
        .circle(iconX, iconY, iconSize / 2)
        .stroke(headerTextColor);

      // Add the transport mode icon
      const iconImageSize = iconSize * 0.6; // Make icon slightly smaller than circle
      const iconImageX = iconX - iconImageSize / 2;
      const iconImageY = iconY - iconImageSize / 2;

      doc.image(iconBuffer, iconImageX, iconImageY, {
        width: iconImageSize,
        height: iconImageSize,
      });
    } catch (error) {
      console.warn("Could not load transport mode icon:", error);
      // Fallback to simple circle with text
      doc
        .lineWidth(3)
        .circle(iconX, iconY, iconSize / 2)
        .stroke(headerTextColor);

      // Add fallback icon text
      doc
        .fillColor(headerTextColor)
        .fontSize(20)
        .font(poppinsBold)
        .text("x", iconX - 10, iconY - 10);
    }

    // Add stop name in header
    const stopName = stopPlaceInfo.name || id;
    const posterContext = { id, name: stopName };
    doc
      .fillColor(headerTextColor)
      .fontSize(36)
      .font(poppinsBold)
      .text(
        renderPosterTemplate(config.layout.header.title, posterContext),
        130,
        35,
        {
          width: pageWidth - 200,
          align: "left",
        },
      );

    // Main content area - centered vertically (adjust for orientation)
    const footerHeight = 80;
    const availableHeight = pageHeight - headerHeight - footerHeight;
    const contentHeight = orientation === "portrait" ? 400 : 310; // More vertical space needed for portrait
    const contentY = headerHeight + (availableHeight - contentHeight) / 2;

    stage = "building the QR URL";
    // Determine the QR code payload
    let qrUrl: string;
    if (options?.generateQrUrl) {
      const qrContext: StopPlaceQrContext = {
        id,
        name: stopPlaceInfo.name ?? id,
      };
      const candidate = options.generateQrUrl(qrContext);
      if (!isValidAbsoluteHttpUrl(candidate)) {
        throw new Error(
          `generateQrUrl returned an invalid URL for "${id}": ${JSON.stringify(
            candidate,
          )}. Expected a non-empty absolute http(s) URL.`,
        );
      }
      qrUrl = candidate;
    } else {
      qrUrl = renderPosterTemplate(config.qrUrlTemplate, posterContext);
      if (!isValidAbsoluteHttpUrl(qrUrl)) {
        throw new Error(
          `qrUrlTemplate produced an invalid URL for "${id}": ${JSON.stringify(
            qrUrl,
          )}. Expected a non-empty absolute http(s) URL.`,
        );
      }
    }

    stage = "generating the QR code";
    const qrCodeDataURL = await QRCode.toDataURL(qrUrl, {
      width: 200,
      margin: 1,
      color: {
        dark: config.colors.qrDark,
        light: config.colors.qrLight,
      },
    });
    if (hasStreamFailure) throw streamFailure;

    stage = "rendering the header/content";
    const base64Data = qrCodeDataURL.split(",")[1];
    let qrCodeBuffer: Buffer | null = null;
    if (base64Data) {
      qrCodeBuffer = Buffer.from(base64Data, "base64");
    }

    const renderMainSections = (x: number, startY: number): number => {
      let y = startY;
      config.layout.main.sections.forEach((section) => {
        y += section.marginTop ?? 0;
        doc.fillColor(bodyTextColor).fontSize(24).font(poppinsBold);
        for (const line of section.headingLines) {
          doc.text(renderPosterTemplate(line, posterContext), x, y);
          y += 25;
        }
        y += section.bodyMarginTop ?? 15;
        doc.fillColor(bodyTextColor).fontSize(14).font(poppinsRegular);
        for (const line of section.bodyLines) {
          doc.text(renderPosterTemplate(line, posterContext), x, y);
          y += 20;
        }
      });
      return y;
    };

    const renderAsideGroups = (
      x: number,
      startY: number,
      usePortraitLines: boolean,
    ): number => {
      let y = startY;
      for (const group of config.layout.aside.groups) {
        y += group.marginTop ?? 0;
        doc
          .fillColor(bodyTextColor)
          .fontSize(14)
          .font(group.weight === "bold" ? poppinsBold : poppinsRegular);
        const lines =
          usePortraitLines && group.portraitLines
            ? group.portraitLines
            : group.lines;
        for (const line of lines) {
          doc.text(
            renderPosterTemplate(line, posterContext),
            x + (group.indent ?? 0),
            y,
          );
          y += 20;
        }
      }
      return y;
    };

    const qrSize = 120;
    const qrX = iconX - iconSize / 2;

    if (orientation === "portrait") {
      const topMargin = headerHeight + 20;
      if (qrCodeBuffer) {
        doc.image(qrCodeBuffer, qrX, topMargin, {
          width: qrSize,
          height: qrSize,
        });
      }

      const rightColumnX = pageWidth - 350;
      const mainEndY = renderMainSections(rightColumnX, topMargin);
      renderAsideGroups(
        rightColumnX,
        mainEndY + config.layout.aside.portraitMarginTop,
        true,
      );
    } else {
      if (qrCodeBuffer) {
        doc.image(qrCodeBuffer, qrX, contentY, {
          width: qrSize,
          height: qrSize,
        });
      }

      const textStartX = qrX + qrSize + 20;
      const rightColumnX = pageWidth - 320;
      renderMainSections(textStartX, contentY);

      const separatorX = rightColumnX - 22;
      doc
        .lineWidth(0.25)
        .moveTo(separatorX, contentY)
        .lineTo(separatorX, contentY + 320)
        .stroke(borderColor);

      renderAsideGroups(
        rightColumnX,
        contentY + config.layout.aside.landscapeTop,
        false,
      );
    }

    // Footer and optional organization logo area - clipped to border box
    const footerY = pageHeight - footerHeight;
    doc
      .save()
      .roundedRect(
        borderMargin,
        borderMargin,
        boxWidth,
        boxHeight,
        borderRadius,
      )
      .clip()
      .rect(borderMargin, footerY, boxWidth, footerHeight)
      .fill(headerFooterColor)
      .restore();

    if (logo) {
      try {
        const logoBuffer = await fs.readFile(logo.path);
        const logoX = pageWidth - borderMargin - logo.maxWidth - 20;
        const logoY = footerY + footerHeight - logo.maxHeight - 35;

        if (logo.preserveAspectRatio === false) {
          doc.image(logoBuffer, logoX, logoY, {
            width: logo.maxWidth,
            height: logo.maxHeight,
          });
        } else {
          doc.image(logoBuffer, logoX, logoY, {
            fit: [logo.maxWidth, logo.maxHeight],
            align: "right",
            valign: "center",
          });
        }
      } catch (error) {
        console.warn("Could not load logo image:", error);
        doc
          .fillColor(headerTextColor)
          .fontSize(24)
          .font(poppinsBold)
          .text(logo.fallbackText, pageWidth - 150, footerY + 25);

        if (logo.fallbackSubtext) {
          doc
            .fillColor(headerTextColor)
            .fontSize(10)
            .font(poppinsRegular)
            .text(logo.fallbackSubtext, pageWidth - 220, footerY + 55);
        }
      }
    }

    stage = "finalizing the document";
    // Finalize the PDF
    doc.end();

    stage = "writing the PDF to disk";
    await streamCompletion;
  } catch (error) {
    const originalError = hasStreamFailure ? streamFailure : error;
    const failureStage = hasStreamFailure ? "writing the PDF to disk" : stage;

    if (stream) {
      await closeOutputStreamSafely(stream);
    }
    try {
      await fs.rm(outputPath, { force: true });
    } catch {
      // Cleanup is best-effort and must never replace the generation error.
    }

    throw new Error(
      `PDF generation failed while ${failureStage}: ${formatUnknownError(
        originalError,
      )} (output: ${outputPath})`,
    );
  }
}

async function closeOutputStreamSafely(
  stream: ReturnType<typeof createWriteStream>,
): Promise<void> {
  if (stream.closed) return;

  await new Promise<void>((resolveClose) => {
    stream.once("close", resolveClose);
    try {
      stream.destroy();
    } catch {
      resolveClose();
    }
  });
}

/**
 * Slugifies a string to be safe for filenames
 * @param text - The text to slugify
 * @returns Slugified string safe for filenames
 */
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      // Replace Norwegian characters
      .replace(/[æÆ]/g, "ae")
      .replace(/[øØ]/g, "o")
      .replace(/[åÅ]/g, "aa")
      // Replace other accented characters
      .replace(/[àáâãäå]/g, "a")
      .replace(/[èéêë]/g, "e")
      .replace(/[ìíîï]/g, "i")
      .replace(/[òóôõö]/g, "o")
      .replace(/[ùúûü]/g, "u")
      .replace(/[ñ]/g, "n")
      .replace(/[ç]/g, "c")
      // Replace spaces and special characters with hyphens
      .replace(/[\s\W-]+/g, "-")
      // Remove leading/trailing hyphens
      .replace(/^-+|-+$/g, "")
      // Limit length to reasonable filename size
      .substring(0, 50)
  );
}

/**
 * Generates a safe filename from an ID and optional stop place name
 * @param id - The NSR ID to convert to filename
 * @param stopPlaceName - Optional stop place name to include in filename
 * @returns Safe filename string
 */
function generateSafeFilename(id: string, stopPlaceName?: string): string {
  // Always start with the ID (made safe for filenames)
  const safeId = id.replace(/[^a-zA-Z0-9\-_]/g, "_");

  // If we have a stop place name, add it as a suffix
  if (stopPlaceName?.trim()) {
    const slugifiedName = slugify(stopPlaceName);
    if (slugifiedName) {
      return `${safeId}-${slugifiedName}`;
    }
  }

  // Fallback to just the ID if no name or slugification failed
  return safeId;
}

/**
 * Ensures a directory exists, creating it if necessary
 * @param dirPath - Directory path to ensure
 */
async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    // Directory doesn't exist, create it
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Checks whether a path exists on disk.
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
