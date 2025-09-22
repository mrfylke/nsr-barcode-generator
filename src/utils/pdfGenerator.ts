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
      // Create a new PDF document in landscape mode
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
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

      // Define colors matching the FRAM design
      const framBlue = "#2E5B8A";
      const white = "#FFFFFF";
      const lightGray = "#F5F5F5";
      const darkGray = "#333333";

      // Header section (blue background)
      const headerHeight = 120;
      doc.rect(0, 0, pageWidth, headerHeight).fill(framBlue);

      // Add bus icon (simple circle with bus emoji)
      const iconX = 80;
      const iconY = 60;
      const iconSize = 50;

      doc
        .lineWidth(3)
        .circle(iconX, iconY, iconSize / 2)
        .stroke(white);

      // Add bus icon text
      doc
        .fillColor(white)
        .fontSize(20)
        .font("Helvetica-Bold")
        .text("🚌", iconX - 10, iconY - 10);

      // Add stop name in header
      const stopName = stopPlaceInfo?.name || id;
      doc
        .fillColor(white)
        .fontSize(36)
        .font("Helvetica-Bold")
        .text(stopName, 150, 40, {
          width: pageWidth - 200,
          align: "left",
        });

      // Main content area
      const contentY = headerHeight + 40;

      // QR Code section (left side)
      const qrX = 80;
      const qrY = contentY;
      const qrSize = 120;

      // Generate QR code
      const url = `https://entur.no/kart/stoppested?id=${encodeURIComponent(
        id
      )}`;
      const qrCodeDataURL = await QRCode.toDataURL(url, {
        width: 200,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });

      const base64Data = qrCodeDataURL.split(",")[1];
      if (base64Data) {
        const qrCodeBuffer = Buffer.from(base64Data, "base64");
        doc.image(qrCodeBuffer, qrX, qrY, { width: qrSize, height: qrSize });
      }

      // Text content (center and right)
      const textStartX = qrX + qrSize + 50;
      const rightColumnX = pageWidth - 320;

      // Norwegian section
      doc
        .fillColor(darkGray)
        .fontSize(24)
        .font("Helvetica-Bold")
        .text("Når kjem bussen?", textStartX, contentY);

      doc
        .fillColor(darkGray)
        .fontSize(14)
        .font("Helvetica")
        .text("Opne mobilkameraet ditt og hald", textStartX, contentY + 40)
        .text("kameralinsa over QR-koden. Lenka", textStartX, contentY + 60)
        .text(
          "fører deg til Entur, og viser busslinjer og",
          textStartX,
          contentY + 80
        )
        .text(
          "avgangar frå haldeplassen du står på.",
          textStartX,
          contentY + 100
        );

      // English section
      doc
        .fillColor(darkGray)
        .fontSize(24)
        .font("Helvetica-Bold")
        .text("When will the bus", textStartX, contentY + 140)
        .text("arrive?", textStartX, contentY + 165);

      doc
        .fillColor(darkGray)
        .fontSize(14)
        .font("Helvetica")
        .text("Open your mobile camera and hold", textStartX, contentY + 200)
        .text(
          "camera lens over the QR code. The link",
          textStartX,
          contentY + 220
        )
        .text(
          "takes you to Entur, and shows bus lines",
          textStartX,
          contentY + 240
        )
        .text(
          "and departures from the stop you are at.",
          textStartX,
          contentY + 260
        );

      // Add vertical line separating center and right columns
      const separatorX = rightColumnX - 12;
      doc
        .lineWidth(0.25)
        .moveTo(separatorX, contentY)
        .lineTo(separatorX, contentY + 280)
        .stroke("#000000");

      // Right column - Additional info (aligned with "Opne mobilkameraet ditt ...")
      const rightColumnStartY = contentY + 40;

      doc
        .fillColor(darkGray)
        .fontSize(16)
        .font("Helvetica-Bold")
        .text("Informasjon om bussavgangar", rightColumnX, rightColumnStartY)
        .text("finn du også på:", rightColumnX, rightColumnStartY + 20);

      doc
        .fillColor(darkGray)
        .fontSize(16)
        .font("Helvetica")
        .text(
          "Information about bus departures",
          rightColumnX,
          rightColumnStartY + 40
        )
        .text("can also be found at:", rightColumnX, rightColumnStartY + 60);

      doc
        .fillColor(darkGray)
        .fontSize(14)
        .font("Helvetica")
        .text("• App / app: ", rightColumnX, rightColumnStartY + 100);

      doc
        .font("Helvetica-Bold")
        .text("FRAM / Entur", rightColumnX + 80, rightColumnStartY + 100);

      doc
        .font("Helvetica")
        .text("• Nettside / website: ", rightColumnX, rightColumnStartY + 125);

      doc
        .font("Helvetica-Bold")
        .text("frammr.no", rightColumnX + 130, rightColumnStartY + 125);

      // Footer with FRAM logo area
      const footerY = pageHeight - 80;
      doc.rect(0, footerY, pageWidth, 80).fill(framBlue);

      // FRAM logo text (simplified)
      doc
        .fillColor(white)
        .fontSize(24)
        .font("Helvetica-Bold")
        .text("FRAM", pageWidth - 150, footerY + 25);

      doc
        .fillColor(white)
        .fontSize(10)
        .font("Helvetica")
        .text("Møre og Romsdal fylkeskommune", pageWidth - 220, footerY + 55);

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
