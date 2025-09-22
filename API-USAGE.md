# API Usage Examples

The NSR Barcode Generator now provides both CLI and programmatic API access.

## Programmatic Usage

### Installation

```bash
npm install nsr-barcode-generator
# or
pnpm add nsr-barcode-generator
```

### Basic Usage

```javascript
const { NsrBarcodeApi } = require("nsr-barcode-generator");

// Generate a single PDF
async function generateSinglePdf() {
  const result = await NsrBarcodeApi.generateSinglePdf({
    nsrId: "NSR:StopPlace:39598",
    outputDirectory: "./output",
    format: "A4", // optional, defaults to A4
  });

  console.log(result.summary);
  console.log("Success:", result.success);
}

// Generate multiple PDFs
async function generateMultiplePdfs() {
  const result = await NsrBarcodeApi.generateMultiplePdfs(
    ["NSR:StopPlace:39598", "NSR:StopPlace:40308"],
    { outputDirectory: "./output" }
  );

  console.log("Generated:", result.totalGenerated, "PDFs");
  console.log("Files:", result.generatedFiles);
}

// Process a file
async function processFile() {
  const result = await NsrBarcodeApi.processFile({
    filePath: "./ids.txt",
    outputDirectory: "./output",
    format: "A4",
  });

  console.log(result.summary);
  console.log("Parse result:", result.parseResult);
  console.log("PDF result:", result.pdfResult);
}

// Validate NSR ID
function validateId() {
  const validation = NsrBarcodeApi.validateNsrId("NSR:StopPlace:39598");
  console.log("Valid:", validation.isValid);
  if (!validation.isValid) {
    console.log("Error:", validation.error);
  }
}

// Parse file content without generating PDFs
async function parseOnly() {
  const result = await NsrBarcodeApi.parseIdsFromFile("./ids.txt");
  console.log("Unique IDs:", result.uniqueIds.size);
  console.log("Total processed:", result.totalCount);
  console.log("Duplicates:", result.duplicateCount);
}
```

### TypeScript Usage

```typescript
import {
  NsrBarcodeApi,
  ProcessFileOptions,
  GenerateSinglePdfOptions,
} from "nsr-barcode-generator";

const options: GenerateSinglePdfOptions = {
  nsrId: "NSR:StopPlace:39598",
  outputDirectory: "./output",
  format: "A4",
};

const result = await NsrBarcodeApi.generateSinglePdf(options);
```

### Error Handling

```javascript
try {
  const result = await NsrBarcodeApi.generateSinglePdf({
    nsrId: "invalid-id",
    outputDirectory: "./output",
  });
} catch (error) {
  if (error.code === "INVALID_FORMAT") {
    console.error("Invalid NSR ID format:", error.message);
  } else {
    console.error("Unexpected error:", error.message);
  }
}
```

## CLI Usage

The CLI interface remains unchanged and works as before:

```bash
# Generate PDFs from file
nsr-barcode file ids.txt -o ./output -f A4

# Generate single PDF
nsr-barcode id NSR:StopPlace:39598 -o ./output

# Validate ID format
nsr-barcode validate NSR:StopPlace:39598

# Parse file without generating PDFs
nsr-barcode parse ids.txt
```

## API Reference

### Classes

#### `NsrBarcodeApi`

Static class providing all API functionality.

**Methods:**

- `processFile(options: ProcessFileOptions): Promise<ProcessFileResult>`
- `generateSinglePdf(options: GenerateSinglePdfOptions): Promise<GenerateSinglePdfResult>`
- `generateMultiplePdfs(nsrIds: string[], options: PdfGenerationOptions): Promise<PdfGenerationResult>`
- `validateNsrId(nsrId: string): ValidationResult`
- `parseIds(content: string): Promise<IdParseResult>`
- `parseIdsFromFile(filePath: string): Promise<IdParseResult>`

### Types

All TypeScript types are exported and available for use:

- `ProcessFileOptions`
- `ProcessFileResult`
- `GenerateSinglePdfOptions`
- `GenerateSinglePdfResult`
- `PdfGenerationOptions`
- `PdfGenerationResult`
- `ValidationResult`
- `IdParseResult`
- `IdParseError`
