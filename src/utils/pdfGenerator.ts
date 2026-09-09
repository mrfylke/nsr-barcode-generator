import PDFDocument from "pdfkit";
import { promises as fs } from "fs";
import { resolve, join } from "path";
import { createWriteStream } from "fs";
import * as QRCode from "qrcode";
import { enturApi, StopPlaceInfo } from "./enturApi";
import { fontLoader, FontFamily } from "./fontLoader";

export interface PdfStyleConfig {
  /** Color for header and footer background (hex color) */
  headerFooterColor?: string;
  /** Path to logo image file for lower right corner */
  logoPath?: string;
  /** Logo width in pixels (height will be calculated to maintain aspect ratio) */
  logoWidth?: number;
  /** Fallback text to display if logo cannot be loaded */
  fallbackLogoText?: string;
  /** Additional fallback text (subtitle) */
  fallbackLogoSubtext?: string;
}

export interface PdfGenerationOptions {
  outputDirectory: string;
  format?: "A4" | "A3" | "Letter";
  /** PDF orientation (defaults to landscape) */
  orientation?: "landscape" | "portrait";
  /** Style configuration for PDF appearance */
  style?: PdfStyleConfig;
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
      // Generate safe filename from ID and stop place name
      const filename = generateSafeFilename(id, stopPlaceInfo?.name);
      const outputPath = join(outputDirectory, `${filename}.pdf`);

      // Generate PDF with stop place information
      await generateSinglePdf(id, outputPath, stopPlaceInfo, options);
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
 * @param options - PDF generation options including style configuration
 */
async function generateSinglePdf(
  id: string,
  outputPath: string,
  stopPlaceInfo?: StopPlaceInfo | null,
  options?: PdfGenerationOptions
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      // Load Poppins fonts
      console.log("Loading Poppins fonts...");
      const fonts = await fontLoader.loadPoppins();

      // Get orientation (default to landscape for backward compatibility)
      const orientation = options?.orientation || "landscape";

      // Create a new PDF document with specified orientation
      const doc = new PDFDocument({
        size: "A4",
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
        console.log("Poppins fonts registered successfully");
      } catch (fontError) {
        console.warn(
          "Failed to register Poppins fonts, using fallback:",
          fontError
        );
      }

      // Create write stream
      const stream = createWriteStream(outputPath);
      doc.pipe(stream);

      // Get page dimensions
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;

      // Get style configuration with defaults
      const styleConfig = options?.style || {};
      const headerFooterColor = styleConfig.headerFooterColor || "#1A4D75"; // Default FRAM blue
      const logoPath =
        styleConfig.logoPath ||
        join(process.cwd(), "images", "fram_mor_fylkeskommune_dark.png");
      const logoWidth = styleConfig.logoWidth || 105;
      const fallbackLogoText = styleConfig.fallbackLogoText || "FRAM";
      const fallbackLogoSubtext =
        styleConfig.fallbackLogoSubtext || "Møre og Romsdal fylkeskommune";

      // Define colors
      const white = "#FFFFFF";
      const lightGray = "#F5F5F5";
      const darkGray = "#333333";

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
          borderRadius
        )
        .stroke("#000000");

      // Header section (blue background) - clipped to border box
      const headerHeight = 80;
      doc
        .save()
        .roundedRect(
          borderMargin,
          borderMargin,
          boxWidth,
          boxHeight,
          borderRadius
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
        const transportModes = stopPlaceInfo?.transportMode || [];
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

        const iconPath = join(process.cwd(), "images", iconFileName);
        const iconBuffer = await fs.readFile(iconPath);

        // Add white circular background
        doc
          .lineWidth(3)
          .circle(iconX, iconY, iconSize / 2)
          .stroke(white)
          .circle(iconX, iconY, iconSize / 2)
          .stroke(white);

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
          .stroke(white);

        // Add fallback icon text
        doc
          .fillColor(white)
          .fontSize(20)
          .font(poppinsBold)
          .text("x", iconX - 10, iconY - 10);
      }

      // Add stop name in header
      const stopName = stopPlaceInfo?.name || id;
      doc
        .fillColor(white)
        .fontSize(36)
        .font(poppinsBold)
        .text(stopName, 130, 35, {
          width: pageWidth - 200,
          align: "left",
        });

      // Main content area - centered vertically (adjust for orientation)
      const footerHeight = 80;
      const availableHeight = pageHeight - headerHeight - footerHeight;
      const contentHeight = orientation === "portrait" ? 400 : 310; // More vertical space needed for portrait
      const contentY = headerHeight + (availableHeight - contentHeight) / 2;

      // Generate QR code first (used in both layouts)
      const url = `https://reise.frammr.no/departures/${encodeURIComponent(
        id
      )}?qr`;
      const qrCodeDataURL = await QRCode.toDataURL(url, {
        width: 200,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });

      const base64Data = qrCodeDataURL.split(",")[1];
      let qrCodeBuffer: Buffer | null = null;
      if (base64Data) {
        qrCodeBuffer = Buffer.from(base64Data, "base64");
      }

      if (orientation === "portrait") {
        // Portrait layout: QR code in left column, right column text from landscape
        const qrSize = 120;
        const topMargin = headerHeight + 20; // Right under header with small margin
        const qrX = iconX - iconSize / 2; // Same X position as landscape QR code
        const qrY = topMargin; // Move to top under header

        // Add QR code on the left
        if (qrCodeBuffer) {
          doc.image(qrCodeBuffer, qrX, qrY, { width: qrSize, height: qrSize });
        }

        // Right column text - exactly the same as landscape right column
        const rightColumnX = pageWidth - 350; // Increased width by 30 points
        const rightColumnStartY = topMargin; // Same Y position as QR code, under header

        // Norwegian section (from landscape middle column)
        doc
          .fillColor(darkGray)
          .fontSize(24)
          .font(poppinsBold)
          .text("Når kjem bussen?", rightColumnX, rightColumnStartY);

        doc
          .fillColor(darkGray)
          .fontSize(14)
          .font(poppinsRegular)
          .text(
            "Opne mobilkameraet ditt og hald",
            rightColumnX,
            rightColumnStartY + 40
          )
          .text(
            "kameralinsa over QR-koden. Lenka",
            rightColumnX,
            rightColumnStartY + 60
          )
          .text(
            "fører deg til reiseplanleggaren, og viser",
            rightColumnX,
            rightColumnStartY + 80
          )
          .text(
            "busslinjer og avgangar frå haldeplassen",
            rightColumnX,
            rightColumnStartY + 100
          )
          .text("du står på.", rightColumnX, rightColumnStartY + 120);

        // English section (moved to be right after Norwegian section)
        const englishStartY = rightColumnStartY + 160;
        doc
          .fillColor(darkGray)
          .fontSize(24)
          .font(poppinsBold)
          .text("When will the bus", rightColumnX, englishStartY)
          .text("arrive?", rightColumnX, englishStartY + 25);

        doc
          .fillColor(darkGray)
          .fontSize(14)
          .font(poppinsRegular)
          .text(
            "Open your mobile camera and hold",
            rightColumnX,
            englishStartY + 60
          )
          .text(
            "camera lens over the QR code. The link",
            rightColumnX,
            englishStartY + 80
          )
          .text(
            "takes you to the travel planner, and",
            rightColumnX,
            englishStartY + 100
          )
          .text(
            "shows bus lines and departures from the",
            rightColumnX,
            englishStartY + 120
          )
          .text("stop you are at.", rightColumnX, englishStartY + 140);

        // Info section (moved to be at the end)
        const infoStartY = englishStartY + 180;
        doc
          .fillColor(darkGray)
          .fontSize(14)
          .font(poppinsBold)
          .text("Informasjon om bussavgangar", rightColumnX, infoStartY)
          .text("finn du också:", rightColumnX, infoStartY + 20);

        doc
          .fillColor(darkGray)
          .fontSize(14)
          .font(poppinsRegular)
          .text(
            "Information about bus departures",
            rightColumnX,
            infoStartY + 40
          )
          .text("can also be found:", rightColumnX, infoStartY + 60);

        doc
          .fillColor(darkGray)
          .fontSize(14)
          .font(poppinsRegular)
          .text("• I appane / in the apps:", rightColumnX, infoStartY + 100);

        doc
          .font(poppinsBold)
          .text("FRAM / Entur", rightColumnX + 10, infoStartY + 120);

        doc
          .font(poppinsRegular)
          .text(
            "• På nettsidene / on the websites:",
            rightColumnX,
            infoStartY + 155
          );

        doc
          .font(poppinsBold)
          .text("frammr.no / entur.no", rightColumnX + 10, infoStartY + 175);
      } else {
        const qrSize = 120;
        const qrX = iconX - iconSize / 2; // Align QR code left edge with left edge of circular icon
        const qrY = contentY;

        // Add QR code
        if (qrCodeBuffer) {
          doc.image(qrCodeBuffer, qrX, qrY, { width: qrSize, height: qrSize });
        }

        // Text content (center and right)
        const textStartX = qrX + qrSize + 20; // Text starts after the QR code with some padding
        const rightColumnX = pageWidth - 320; // Right column remains in the same position

        // Norwegian section
        doc
          .fillColor(darkGray)
          .fontSize(24)
          .font(poppinsBold)
          .text("Når kjem bussen?", textStartX, contentY);

        doc
          .fillColor(darkGray)
          .fontSize(14)
          .font(poppinsRegular)
          .text("Opne mobilkameraet ditt og hald", textStartX, contentY + 40)
          .text("kameralinsa over QR-koden. Lenka", textStartX, contentY + 60)
          .text(
            "fører deg til reiseplanleggaren, og viser",
            textStartX,
            contentY + 80
          )
          .text(
            "busslinjer og avgangar frå haldeplassen",
            textStartX,
            contentY + 100
          )
          .text("du står på.", textStartX, contentY + 120);

        // English section
        doc
          .fillColor(darkGray)
          .fontSize(24)
          .font(poppinsBold)
          .text("When will the bus", textStartX, contentY + 160)
          .text("arrive?", textStartX, contentY + 185);

        doc
          .fillColor(darkGray)
          .fontSize(14)
          .font(poppinsRegular)
          .text("Open your mobile camera and hold", textStartX, contentY + 220)
          .text(
            "camera lens over the QR code. The link",
            textStartX,
            contentY + 240
          )
          .text(
            "takes you to the travel planner, and",
            textStartX,
            contentY + 260
          )
          .text(
            "shows bus lines and departures from the",
            textStartX,
            contentY + 280
          )
          .text("stop you are at.", textStartX, contentY + 300);

        // Add vertical line separating center and right columns
        const separatorX = rightColumnX - 22;
        doc
          .lineWidth(0.25)
          .moveTo(separatorX, contentY)
          .lineTo(separatorX, contentY + 320)
          .stroke("#000000");

        // Right column - Additional info (aligned with "Opne mobilkameraet ditt ...")
        const rightColumnStartY = contentY + 40;

        doc
          .fillColor(darkGray)
          .fontSize(14)
          .font(poppinsBold)
          .text("Informasjon om bussavgangar", rightColumnX, rightColumnStartY)
          .text("finn du også:", rightColumnX, rightColumnStartY + 20);

        doc
          .fillColor(darkGray)
          .fontSize(14)
          .font(poppinsRegular)
          .text(
            "Information about bus departures",
            rightColumnX,
            rightColumnStartY + 40
          )
          .text("can also be found:", rightColumnX, rightColumnStartY + 60);

        doc
          .fillColor(darkGray)
          .fontSize(14)
          .font(poppinsRegular)
          .text(
            "• I appane / in the apps:",
            rightColumnX,
            rightColumnStartY + 100
          );

        doc
          .font(poppinsBold)
          .text("FRAM / Entur", rightColumnX + 10, rightColumnStartY + 120);

        doc
          .font(poppinsRegular)
          .text(
            "• På nettsidene / on the websites:",
            rightColumnX,
            rightColumnStartY + 155
          );

        doc
          .font(poppinsBold)
          .text(
            "frammr.no / entur.no",
            rightColumnX + 10,
            rightColumnStartY + 175
          );
      }

      // Footer with FRAM logo area - clipped to border box
      const footerY = pageHeight - footerHeight;
      doc
        .save()
        .roundedRect(
          borderMargin,
          borderMargin,
          boxWidth,
          boxHeight,
          borderRadius
        )
        .clip()
        .rect(borderMargin, footerY, boxWidth, footerHeight)
        .fill(headerFooterColor)
        .restore();

      // Add logo in lower right corner
      try {
        const logoBuffer = await fs.readFile(logoPath);

        // Position logo in lower right corner of footer with some margin
        const logoHeight = Math.round(logoWidth * 0.27); // Maintain aspect ratio (approximately 3.75:1)
        const logoX = pageWidth - borderMargin - logoWidth - 20; // 20px margin from right edge
        const logoY = footerY + footerHeight - logoHeight - 35; // 35px margin from bottom

        doc.image(logoBuffer, logoX, logoY, {
          width: logoWidth,
          height: logoHeight,
        });
      } catch (error) {
        console.warn("Could not load logo image:", error);
        // Fallback to text logo if image fails to load
        doc
          .fillColor(white)
          .fontSize(24)
          .font(poppinsBold)
          .text(fallbackLogoText, pageWidth - 150, footerY + 25);

        if (fallbackLogoSubtext) {
          doc
            .fillColor(white)
            .fontSize(10)
            .font(poppinsRegular)
            .text(fallbackLogoSubtext, pageWidth - 220, footerY + 55);
        }
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
  if (stopPlaceName && stopPlaceName.trim()) {
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
