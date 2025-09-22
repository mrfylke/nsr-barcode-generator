import PDFDocument from "pdfkit";
import { promises as fs } from "fs";
import { resolve, join } from "path";
import { createWriteStream } from "fs";

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

  for (const id of ids) {
    try {
      // Generate safe filename from ID
      const filename = generateSafeFilename(id);
      const outputPath = join(outputDirectory, `${filename}.pdf`);

      // Generate PDF
      await generateSinglePdf(id, outputPath);
      generatedFiles.push(outputPath);

      console.log(`Generated PDF: ${filename}.pdf`);
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
 * Generates a single PDF with centered ID
 * @param id - The ID to display
 * @param outputPath - Output file path
 */
async function generateSinglePdf(
  id: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
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

      // Draw a border rectangle (made taller to accommodate URL)
      const boxWidth = 350;
      const boxHeight = 120;
      const boxX = centerX - boxWidth / 2;
      const boxY = centerY - boxHeight / 2;

      doc
        .rect(boxX, boxY, boxWidth, boxHeight)
        .stroke("#333333")
        .fillColor("#f9f9f9")
        .rect(boxX + 2, boxY + 2, boxWidth - 4, boxHeight - 4)
        .fill();

      // Add the ID text centered
      doc
        .fillColor("#333333")
        .fontSize(24)
        .font("Helvetica-Bold")
        .text(id, boxX, boxY + 20, {
          width: boxWidth,
          align: "center",
        });

      // Add the URL below the ID
      const url = `http://example.com/${encodeURIComponent(id)}`;
      doc
        .fillColor("#666666")
        .fontSize(14)
        .font("Helvetica")
        .text(url, boxX, boxY + 60, {
          width: boxWidth,
          align: "center",
        });

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
