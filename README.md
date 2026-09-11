# NSR Barcode Generator

CLI and programmatic API for generating branded PDF posters (with a QR code) for NSR stop places. Embeddable in other apps (server, desktop) or used standalone.

## Install

```bash
pnpm add @mrfylke/nsr-barcode-generator
```

## Quick start

```typescript
import { NsrBarcodeApi } from "@mrfylke/nsr-barcode-generator";

await NsrBarcodeApi.generateSinglePdf({
  nsrId: "NSR:StopPlace:39598",
  outputDirectory: "./output",
});

const result = await NsrBarcodeApi.generateMultiplePdfs(
  ["NSR:StopPlace:39598", "NSR:StopPlace:40308"],
  { outputDirectory: "./output" }
);
console.log(result.generated, result.skipped, result.failed);
```

## API

```typescript
class NsrBarcodeApi {
  static generateSinglePdf(options: GenerateSinglePdfOptions): Promise<GenerateSinglePdfResult>;
  static generateMultiplePdfs(stopPlaces: StopPlaceRequest[], options: PdfGenerationOptions): Promise<PdfGenerationResult>;
  static processFile(options: ProcessFileOptions): Promise<ProcessFileResult>;
  static validateNsrId(nsrId: string): ValidationResult;
  static parseIds(content: string): Promise<IdParseResult>;
  static parseIdsFromFile(filePath: string): Promise<IdParseResult>;
  static loadPosterConfig(filePath: string): Promise<PosterConfig>;
  static loadBuiltInPosterConfig(name: BuiltInPosterConfigName, assetsDirectory?: string): Promise<PosterConfig>;
  static loadPosterConfigSource(source: string, assetsDirectory?: string): Promise<PosterConfig>;
  static validatePosterConfig(value: unknown): PosterConfig;
}
```

### Options

All three generation methods share these options:

```typescript
interface PdfGenerationOptions {
  outputDirectory: string;
  assetsDirectory?: string;                       // copied package assets for bundled executables
  format?: "A4" | "A3" | "Letter";           // default "A4"
  orientation?: "landscape" | "portrait";     // default "landscape"
  posterConfig?: PosterConfig | "fram";       // default "fram"
  overwrite?: boolean;                        // replace existing files (default false = skip)
  onProgress?: (event: PdfProgressEvent) => void;  // see "Result & progress" below

  // Custom QR payload. Called once metadata is resolved; the returned
  // string is used verbatim (no rewriting). Must be an absolute http(s)
  // URL, otherwise that item fails with a per-item error. Defaults to
  // `https://reise.frammr.no/departures/<id>?qr`.
  generateQrUrl?: (stopPlace: StopPlaceQrContext) => string;

  // Overrides how stop-place metadata is looked up for bare IDs.
  // Defaults to the built-in Entur client. Useful for tests.
  stopPlaceFetcher?: (ids: string[]) => Promise<(StopPlaceInfo | null)[]>;

  // See "Supplying stop place data" below.
  enrichTransportMode?: boolean;              // default false
}
```

### Poster configuration

The bundled FRAM poster configuration is used when `posterConfig` is omitted,
so existing API and CLI calls keep producing the same poster. A complete,
versioned configuration can customize all poster text, colors, logo, and QR URL
without changing application code:

```typescript
const posterConfig = await NsrBarcodeApi.loadPosterConfig(
  "./my-authority-poster.json",
);

await NsrBarcodeApi.generateSinglePdf({
  nsrId: "NSR:StopPlace:39598",
  outputDirectory: "./output",
  posterConfig,
});

// Built-in packs can be selected without loading a file:
await NsrBarcodeApi.generateSinglePdf({
  nsrId: "NSR:StopPlace:39598",
  outputDirectory: "./output",
  posterConfig: "fram",
});
```

Copy [`assets/config/fram-poster.json`](assets/config/fram-poster.json) as a
starting point. It references the bundled
[`poster-config.schema.json`](assets/config/poster-config.schema.json) through
its `$schema` property, giving compatible editors code completion and inline
validation. Logo paths in files loaded with `loadPosterConfig` are resolved
relative to the configuration file. Set `logo` to `null` to omit it.

Text is represented as semantic main sections and aside text groups. Explicit
line arrays keep printed wrapping predictable. The following placeholders are
supported in poster text and `qrUrlTemplate`:

- `{{stopName}}` and `{{nsrId}}`
- `{{encodedStopName}}` and `{{encodedNsrId}}` for URL-safe values

`generateQrUrl` takes precedence over `qrUrlTemplate` when both are supplied.

Available built-in packs are exported as `builtInPosterConfigNames`; currently
the only pack is `fram`. Omitting `posterConfig` also selects `fram`.

Branding is configured exclusively through `posterConfig`. The former API
`style` object and CLI flags `--header-color`, `--logo-path`, `--logo-width`,
`--fallback-text`, and `--fallback-subtext` have been removed. Their values map
to `colors.headerFooter` and the corresponding fields under `logo` in the JSON
configuration.

When bundling the API into an executable, copy this package's `assets/`
directory alongside the application and pass its absolute path as
`assetsDirectory`. This avoids build-time `__dirname` rewriting by bundlers
such as Bun while leaving regular Node.js package resolution unchanged.

`generateSinglePdf` additionally takes `nsrId: string`, plus `name?`/`transportMode?` shortcuts (see below). `processFile` takes `filePath: string` instead of a stop-place array.

### Supplying stop place data (skip Entur)

`generateMultiplePdfs` accepts a mix of bare IDs and known data - no separate list to keep in sync:

```typescript
type StopPlaceRequest = string | { id: string; name: string; transportMode?: string[] };

await NsrBarcodeApi.generateMultiplePdfs(
  [
    { id: "NSR:StopPlace:10003", name: "Malmefjorden" },     // Entur skipped
    { id: "NSR:StopPlace:10004", name: "X", transportMode: ["bus"] },
    "NSR:StopPlace:40308",                                    // resolved via Entur
  ],
  { outputDirectory: "./output" }
);
```

Duplicate IDs: last entry wins. If every entry has data, Entur is never called. If a bare ID can't be resolved, that item fails (`result.failed`) rather than producing a poster with a misleading name.

`generateSinglePdf` has the same shortcut as flat fields: `{ nsrId, name?, transportMode? }` - supplying `name` skips Entur.

Missing `transportMode` just falls back to the default bus icon. To fetch the correct icon while keeping your supplied `name`, set `enrichTransportMode: true` - it fetches only the entries missing a transport mode, only reads that field, and never overwrites your `name` (a failed fetch still succeeds with the bus icon).

### Result & progress

```typescript
interface PdfGenerationResult {
  generated: { nsrId: string; outputPath: string }[];
  skipped: { nsrId: string; outputPath: string }[];   // overwrite: false and file existed
  failed: { nsrId: string; error: string }[];
  generatedFiles: string[];  // = generated.map(g => g.outputPath), kept for compatibility
  totalGenerated: number;    // = generated.length
  outputDirectory: string;
}

// Discriminated union on `type`. Fetching events precede generation events.
type PdfProgressEvent =
  | DataFetchingProgressEvent
  | DataFetchingBatchProgressEvent
  | GenerationProgressEvent;

interface DataFetchingProgressEvent {
  type: "data-fetching";
  current: number; total: number; nsrId: string;
  status: "fetched" | "error";
  error?: string;
}

// Fired once per batch of Entur lookups, right before the delay ahead of the next batch.
interface DataFetchingBatchProgressEvent {
  type: "data-fetching-batch";
  batchNumber: number; totalBatches: number; delayMs: number;
}

interface GenerationProgressEvent {
  type: "generation";
  current: number; total: number; nsrId: string;
  outputPath?: string;
  status: "generated" | "skipped" | "error";
  error?: string;
}
```

`onProgress` first fires once per ID needing an Entur lookup (`type: "data-fetching"`), with a `type: "data-fetching-batch"` event between batches while fetches are throttled, then once per requested ID as PDFs are written (`type: "generation"`). One item failing never aborts the batch. Fetching events (including batch events) are only emitted for the built-in Entur client - a custom `stopPlaceFetcher` does not report fetch progress.

### Types

`ProcessFileOptions/Result`, `GenerateSinglePdfOptions/Result`, `PdfGenerationOptions/Result`, `PdfProgressEvent`, `DataFetchingProgressEvent`, `DataFetchingBatchProgressEvent`, `GenerationProgressEvent`, `PosterConfig`, `PosterConfigSource`, `BuiltInPosterConfigName` and the nested configuration types, `StopPlaceQrContext`, `StopPlaceId`/`StopPlaceInput`/`StopPlaceRequest`, `ValidationResult`, `IdParseResult`/`IdParseError` are all exported.

### NSR ID format & filenames

Only `NSR:StopPlace:<digits>` is accepted (no whitespace, no `NSR:Quay:*`, no extra segments).

Output files are named `{NSR_ID}-{slugified-name}.pdf`, e.g. `NSR_StopPlace_39598-malmefjorden.pdf` (Norwegian characters transliterated: `æ→ae`, `ø→o`, `å→aa`).

## CLI

```bash
nsr-barcode file ids.txt -o ./output [-f A4|A3|Letter] [--orientation landscape|portrait] [--overwrite] \
  [--config fram|./my-authority-poster.json]

nsr-barcode id NSR:StopPlace:39598 -o ./output --config fram
nsr-barcode --list-configs                         # list supported built-in configs
nsr-barcode validate NSR:StopPlace:39598          # check ID format only
nsr-barcode parse ids.txt                         # list unique IDs, no PDFs
```

`configs` (also available as `config` and `list-configs`) is an equivalent
command-style way to list the supported built-in configs.

Both `file` and `id` accept `-c, --config <pack-or-file>`. They print one line per
`onProgress` event as it happens - Entur lookups first (`[fetching n/total]
...`), with a `Processed batch n/total. Waiting <ms>ms before next batch...`
line whenever fetches are large enough to be throttled into batches, then PDF
writes (`[generating n/total] ...`) - followed by the final summary.

## Embeddability

Fonts (bundled Poppins) and images resolve relative to the package's own install location, not `process.cwd()` - safe inside a packaged desktop app with a read-only install dir. Nothing is downloaded or cached to disk at runtime; a bundled font that fails to read falls back to Helvetica.

## Development

```bash
pnpm install
pnpm run build   # compile
pnpm run test    # vitest
pnpm run dev ...  # tsx, same args as the CLI
```

```
src/
├── api.ts, cli.ts, index.ts
└── utils/  fileReader, idParser, nsrId, assets, fontLoader, pdfGenerator, enturApi
assets/
├── fonts/   bundled Poppins TTFs
├── images/  transport-mode icons, default logo
└── config/  FRAM poster config and JSON Schema
```

## Migrating to 1.1.0

Backward-compatible minor release:

- New optional options across all generation methods: `generateQrUrl`, `overwrite`, `onProgress`, `stopPlaceFetcher`, `enrichTransportMode`; `generateSinglePdf` also gained `name`/`transportMode`. Omitting them keeps prior behavior, including the prior QR URL.
- `generateMultiplePdfs`'s first parameter is now `StopPlaceRequest[]` instead of `string[]` - a plain `string[]` still works unchanged.
- `PdfGenerationResult` gained `generated`/`skipped`/`failed`; `generatedFiles`/`totalGenerated` are unchanged.
- Package renamed to the scoped `@mrfylke/nsr-barcode-generator`.
- `options.format` now actually controls page size (previously accepted but ignored - pages were always A4).
- Fonts are bundled, no longer downloaded from GitHub at runtime.
- Unresolvable stop-place metadata (no Entur match, no supplied `name`) is now a per-item error instead of silently falling back to the raw ID as the poster title.

## License

MIT
