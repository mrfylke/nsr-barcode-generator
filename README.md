# NSR Barcode Generator

A CLI tool and programmatic API to generate PDF files for unique NSR IDs with customizable styling options.

## Installation

```bash
npm install nsr-barcode-generator
# or
pnpm add nsr-barcode-generator
```

## Programmatic Usage

### Basic Usage

```javascript
const { NsrBarcodeApi } = require("nsr-barcode-generator");

// Generate a single PDF with default styling
async function generateSinglePdf() {
  const result = await NsrBarcodeApi.generateSinglePdf({
    nsrId: "NSR:StopPlace:39598",
    outputDirectory: "./output",
    format: "A4", // optional, defaults to A4
  });

  console.log(result.summary);
  console.log("Success:", result.success);
}

// Generate a single PDF with custom styling
async function generateCustomStyledPdf() {
  const result = await NsrBarcodeApi.generateSinglePdf({
    nsrId: "NSR:StopPlace:39598",
    outputDirectory: "./output",
    style: {
      headerFooterColor: "#2E8B57", // Custom green color
      logoPath: "./my-logo.png", // Custom logo path
      logoWidth: 120, // Custom logo width
      fallbackLogoText: "MY ORG", // Fallback if logo fails
      fallbackLogoSubtext: "Transportation Authority",
    },
  });

  console.log(result.summary);
}

// Generate multiple PDFs
async function generateMultiplePdfs() {
  const result = await NsrBarcodeApi.generateMultiplePdfs(
    ["NSR:StopPlace:39598", "NSR:StopPlace:40308"],
    {
      outputDirectory: "./output",
      style: {
        headerFooterColor: "#FF6B35", // Orange theme
      },
    }
  );

  console.log("Generated:", result.totalGenerated, "PDFs");
  console.log("Files:", result.generatedFiles);
}

// Process a file with custom styling
async function processFile() {
  const result = await NsrBarcodeApi.processFile({
    filePath: "./ids.txt",
    outputDirectory: "./output",
    format: "A4",
    style: {
      headerFooterColor: "#8B4513", // Brown theme
      logoPath: "./custom-logo.png",
    },
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

### Style Configuration Options

The `style` configuration object supports the following options:

```typescript
interface PdfStyleConfig {
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
```

**Default values:**

- `headerFooterColor`: `#1A4D75` (FRAM blue)
- `logoPath`: `./images/fram_mor_fylkeskommune_dark.png`
- `logoWidth`: `105`
- `fallbackLogoText`: `FRAM`
- `fallbackLogoSubtext`: `Møre og Romsdal fylkeskommune`

### TypeScript Usage

```typescript
import {
  NsrBarcodeApi,
  ProcessFileOptions,
  GenerateSinglePdfOptions,
  PdfStyleConfig,
} from "nsr-barcode-generator";

const styleConfig: PdfStyleConfig = {
  headerFooterColor: "#2E8B57",
  logoPath: "./my-logo.png",
  logoWidth: 120,
  fallbackLogoText: "MY ORG",
};

const options: GenerateSinglePdfOptions = {
  nsrId: "NSR:StopPlace:39598",
  outputDirectory: "./output",
  format: "A4",
  style: styleConfig,
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

The CLI interface supports all the same styling options:

```bash
# Generate PDFs from file with custom styling
nsr-barcode file ids.txt -o ./output -f A4 \
  --header-color "#2E8B57" \
  --logo-path "./my-logo.png" \
  --logo-width 120 \
  --fallback-text "MY ORG" \
  --fallback-subtext "Transportation Authority"

# Generate single PDF with custom styling
nsr-barcode id NSR:StopPlace:39598 -o ./output \
  --header-color "#FF6B35" \
  --fallback-text "CUSTOM"

# Validate ID format
nsr-barcode validate NSR:StopPlace:39598

# Parse file without generating PDFs
nsr-barcode parse ids.txt
```

### CLI Options

#### Basic Options

- `-o, --output <directory>`: Output directory for generated PDFs (required)
- `-f, --format <format>`: PDF format (A4, A3, Letter) - defaults to A4
- `-h, --help`: Display help for command
- `-V, --version`: Output the version number

#### Style Options

- `--header-color <color>`: Header and footer background color (hex format, e.g., #1A4D75)
- `--logo-path <path>`: Path to logo image file for lower right corner
- `--logo-width <width>`: Logo width in pixels
- `--fallback-text <text>`: Fallback text if logo cannot be loaded
- `--fallback-subtext <text>`: Additional fallback text (subtitle)

### CLI Commands

```bash
# Show all available commands
nsr-barcode --help

# File processing command
nsr-barcode file <file> [options]

# Single ID command
nsr-barcode id <nsrId> [options]

# Validation command
nsr-barcode validate <nsrId>

# Parse command (no PDF generation)
nsr-barcode parse <file>
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
- `PdfStyleConfig`
- `ValidationResult`
- `IdParseResult`
- `IdParseError`

### Styling Examples

#### Corporate Branding

```javascript
const corporateStyle = {
  headerFooterColor: "#003366", // Navy blue
  logoPath: "./assets/company-logo.png",
  logoWidth: 140,
  fallbackLogoText: "ACME TRANSIT",
  fallbackLogoSubtext: "Public Transportation Services",
};
```

#### Colorful Theme

```javascript
const colorfulStyle = {
  headerFooterColor: "#FF6B35", // Bright orange
  logoPath: "./assets/colorful-logo.png",
  fallbackLogoText: "CITY BUS",
  fallbackLogoSubtext: "Urban Transit Network",
};
```

#### Minimal Style

```javascript
const minimalStyle = {
  headerFooterColor: "#333333", // Dark gray
  fallbackLogoText: "TRANSIT",
  fallbackLogoSubtext: "", // No subtitle
};
```

## Development

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- TypeScript 5.x

### Setup

```bash
# Install dependencies
pnpm install

# Build the project
pnpm run build
```

### Development Scripts

- `pnpm run build` - Compile TypeScript to JavaScript
- `pnpm run dev` - Run in development mode with tsx
- `pnpm run watch` - Watch for changes and rebuild
- `pnpm run clean` - Clean the dist directory
- `pnpm start` - Run the built application

### Development Usage

```bash
# Run in development mode
pnpm run dev file ./example.txt -o ./output

# Example with custom styling
pnpm run dev id NSR:StopPlace:39598 -o ./output --header-color "#FF6B35"
```

### Production Usage

```bash
# Build and run
pnpm run build
pnpm start file ./example.txt -o ./output

# Or use the binary directly after building
./dist/index.js file ./example.txt -o ./output
```

## Architecture

The project follows a clean architecture pattern with clear separation of concerns:

### Structure

```
src/
├── index.ts           # Main entry point (exports API + runs CLI)
├── cli.ts             # CLI interface and command handling
├── api.ts             # Core API layer with business logic
└── utils/
    ├── fileReader.ts  # File reading utilities
    ├── idParser.ts    # ID parsing and validation
    ├── pdfGenerator.ts # PDF generation with styling
    └── enturApi.ts    # Entur API integration
```

### Design Principles

- **Separation of Concerns**: CLI and API layers are completely separate
- **Clean API**: Programmatic access independent of CLI
- **Type Safety**: Full TypeScript support with exported types
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Customization**: Flexible styling options for different use cases
- **Backward Compatibility**: All existing functionality preserved

### Key Features

- **Dual Interface**: Both CLI tool and programmatic API
- **Custom Styling**: Configurable colors, logos, and branding
- **Format Support**: A4, A3, and Letter PDF formats
- **Smart Filenames**: Output files include slugified stop place names for easy identification
- **Validation**: NSR ID format validation
- **Batch Processing**: Handle multiple IDs efficiently
- **Error Recovery**: Graceful handling of missing logos and invalid data
- **Development Tools**: Hot reload, watch mode, and TypeScript support

## Output Files

### Filename Format

Generated PDF files use a smart naming convention that includes both the NSR ID and the slugified stop place name:

**Format**: `{NSR_ID}-{slugified-stop-place-name}.pdf`

**Examples**:

- `NSR_StopPlace_39598-malmefjorden.pdf` (Malmefjorden)
- `NSR_StopPlace_58735-molde-ferjekai.pdf` (Molde ferjekai)
- `NSR_StopPlace_58062-aalesund-kystrutekai.pdf` (Ålesund kystrutekai)
- `NSR_StopPlace_40308-alexandraparken.pdf` (Alexandraparken)

### Slugification Rules

Stop place names are converted to URL-friendly slugs using these rules:

- **Lowercase conversion**: All characters converted to lowercase
- **Norwegian characters**: `æ→ae`, `ø→o`, `å→aa`
- **Accented characters**: `á→a`, `é→e`, `ñ→n`, etc.
- **Spaces and special characters**: Replaced with hyphens (`-`)
- **Length limit**: Truncated to 50 characters maximum
- **Clean format**: Leading/trailing hyphens removed

### Fallback Behavior

If a stop place name is unavailable or cannot be retrieved:

- Falls back to NSR ID only: `NSR_StopPlace_39598.pdf`
- PDF generation continues normally
- No errors thrown due to missing names

## Error Handling

The tool provides comprehensive error handling for common scenarios:

### File Operations

- File not found
- Permission denied
- Directory instead of file
- Empty or invalid file content

### ID Validation

- Invalid NSR ID format
- Missing or malformed IDs
- Duplicate ID handling

### PDF Generation

- Missing logo files (graceful fallback)
- Invalid style configuration
- File system permissions
- Network issues (Entur API)

### API Integration

- Entur API connectivity issues
- Missing stop place information
- Rate limiting and timeout handling

## License

MIT
