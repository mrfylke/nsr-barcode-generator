import PDFDocument from "pdfkit";
import { promises as fs } from "fs";
import { resolve, join } from "path";
import { createWriteStream } from "fs";
import * as QRCode from "qrcode";
import { enturApi, StopPlaceInfo } from "./enturApi";

export interface PdfGenerationOptions {
  outputDirectory: string;
  format?: "A4" | "A3" | "Letter";
}

export interface PdfGenerationResult {
  generatedFiles: string[];
  totalGenerated: number;
  outputDirectory: string;
}

/**
 * Generates individual PDF files for each unique ID
 * @param ids - Array of unique IDs to generate PDFs for
 * @param options - PDF generation options
 * @returns Promise that resolves to the generation result
 */
export async function generatePdfsForIds(
  ids: string[],
  options: PdfGenerationOptions
): Promise<PdfGenerationResult> {
  const { outputDirectory } = options;

  // Ensure output directory exists
  await ensureDirectoryExists(outputDirectory);

  const generatedFiles: string[] = [];

  // Fetch stop place information for all IDs in parallel
  console.log("Fetching stop place information from Entur API...");
  const stopPlaceInfos = await enturApi.getMultipleStopPlaces(ids);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const stopPlaceInfo = stopPlaceInfos[i];

    if (!id) continue; // Skip if ID is undefined

    try {
      // Generate safe filename from ID
      const filename = generateSafeFilename(id);
      const outputPath = join(outputDirectory, `${filename}.pdf`);

      // Generate PDF with stop place information
      await generateSinglePdf(id, outputPath, stopPlaceInfo);
      generatedFiles.push(outputPath);

      const infoText = stopPlaceInfo?.name ? ` (${stopPlaceInfo.name})` : "";
      console.log(`Generated PDF: ${filename}.pdf${infoText}`);
    } catch (error) {
      console.error(`Failed to generate PDF for ID "${id}":`, error);
      // Continue with other IDs even if one fails
    }
  }

  return {
    generatedFiles,
    totalGenerated: generatedFiles.length,
    outputDirectory: resolve(outputDirectory),
  };
}

/**
 * Generates a single PDF with centered ID and stop place information
 * @param id - The ID to display
 * @param outputPath - Output file path
 * @param stopPlaceInfo - Optional stop place information from Entur API
 */
async function generateSinglePdf(
  id: string,
  outputPath: string,
  stopPlaceInfo?: StopPlaceInfo | null
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      // Create a new PDF document
      const doc = new PDFDocument({
        size: "A4",
        margins: {
          top: 50,
          bottom: 50,
          left: 50,
          right: 50,
        },
      });

      // Create write stream
      const stream = createWriteStream(outputPath);
      doc.pipe(stream);

      // Get page dimensions
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;

      // Calculate center position
      const centerX = pageWidth / 2;
      const centerY = pageHeight / 2;

      // Calculate box height based on available information
      const hasStopInfo = stopPlaceInfo && stopPlaceInfo.name;
      const boxWidth = 400;
      const boxHeight = hasStopInfo ? 280 : 200;
      const boxX = centerX - boxWidth / 2;
      const boxY = centerY - boxHeight / 2;

      doc
        .rect(boxX, boxY, boxWidth, boxHeight)
        .stroke("#333333")
        .fillColor("#f9f9f9")
        .rect(boxX + 2, boxY + 2, boxWidth - 4, boxHeight - 4)
        .fill();

      let currentY = boxY + 20;

      // Add the ID text centered at the top
      doc
        .fillColor("#333333")
        .fontSize(22)
        .font("Helvetica-Bold")
        .text(id, boxX, currentY, {
          width: boxWidth,
          align: "center",
        });

      currentY += 35;

      // Add stop place name if available
      if (stopPlaceInfo?.name) {
        doc
          .fillColor("#2c5aa0")
          .fontSize(18)
          .font("Helvetica-Bold")
          .text(stopPlaceInfo.name, boxX, currentY, {
            width: boxWidth,
            align: "center",
          });

        currentY += 25;
      }

      // Add location information if available
      if (stopPlaceInfo?.municipality || stopPlaceInfo?.county) {
        const locationText = [stopPlaceInfo.municipality, stopPlaceInfo.county]
          .filter(Boolean)
          .join(", ");

        doc
          .fillColor("#666666")
          .fontSize(12)
          .font("Helvetica")
          .text(locationText, boxX, currentY, {
            width: boxWidth,
            align: "center",
          });

        currentY += 20;
      }

      // Add transport modes if available
      if (
        stopPlaceInfo?.transportMode &&
        stopPlaceInfo.transportMode.length > 0
      ) {
        const modesText = `Transport: ${stopPlaceInfo.transportMode.join(
          ", "
        )}`;
        doc
          .fillColor("#666666")
          .fontSize(10)
          .font("Helvetica")
          .text(modesText, boxX, currentY, {
            width: boxWidth,
            align: "center",
          });

        currentY += 15;
      }

      // Generate QR code for the Entur map URL
      const url = `https://entur.no/kart/stoppested?id=${encodeURIComponent(
        id
      )}`;
      const qrCodeDataURL = await QRCode.toDataURL(url, {
        width: 100,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });

      // Convert data URL to buffer and add to PDF
      const base64Data = qrCodeDataURL.split(",")[1];
      if (base64Data) {
        const qrCodeBuffer = Buffer.from(base64Data, "base64");
        const qrSize = 80;
        const qrX = centerX - qrSize / 2;
        const qrY = currentY + 10;

        doc.image(qrCodeBuffer, qrX, qrY, { width: qrSize, height: qrSize });
      }

      // Finalize the PDF
      doc.end();

      stream.on("finish", () => {
        resolve();
      });

      stream.on("error", (error) => {
        reject(new Error(`Failed to write PDF: ${error.message}`));
      });
    } catch (error) {
      reject(
        new Error(
          `PDF generation failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        )
      );
    }
  });
}

/**
 * Generates a safe filename from an ID
 * @param id - The ID to convert to filename
 * @returns Safe filename string
 */
function generateSafeFilename(id: string): string {
  // Replace unsafe characters with underscores
  return id.replace(/[^a-zA-Z0-9\-_]/g, "_");
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
