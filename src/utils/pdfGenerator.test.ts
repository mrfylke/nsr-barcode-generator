import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StopPlaceInfo } from "./enturApi";

const capturedQrUrls: string[] = [];

vi.mock("qrcode", () => {
  return {
    toDataURL: vi.fn(async (url: string) => {
      capturedQrUrls.push(url);
      // Return a real bundled PNG (as a data URL) so PDFKit can embed a
      // valid image regardless of what URL was requested - we only care
      // about the URL string passed in, not real QR encoding here.
      const pngPath = path.join(
        __dirname,
        "..",
        "..",
        "assets",
        "images",
        "Bus.png",
      );
      const buf = await fs.readFile(pngPath);
      return `data:image/png;base64,${buf.toString("base64")}`;
    }),
  };
});

const { generatePdfsForStopPlaces } = await import("./pdfGenerator");
const { NsrBarcodeApi } = await import("../api");
const { loadFramPosterConfig } = await import("./posterConfig");

function stopPlace(
  id: string,
  overrides: Partial<StopPlaceInfo> = {},
): StopPlaceInfo {
  return { id, name: `Stop ${id}`, ...overrides };
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "nsr-barcode-pdf-"));
}

function readMediaBox(buf: Buffer): [number, number] {
  const str = buf.toString("latin1");
  const match = /\/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]/.exec(
    str,
  );
  if (!match) throw new Error("MediaBox not found in PDF output");
  const [, width, height] = match;
  if (width === undefined || height === undefined) {
    throw new Error("MediaBox not found in PDF output");
  }
  return [parseFloat(width), parseFloat(height)];
}

afterEach(() => {
  capturedQrUrls.length = 0;
  vi.restoreAllMocks();
});

describe("generatePdfsForStopPlaces", () => {
  it("invokes generateQrUrl with exactly { id, name } and uses the returned string verbatim as the QR payload", async () => {
    const outputDirectory = await makeTempDir();
    const generateQrUrl = vi.fn(
      ({ id }: { id: string; name: string }) =>
        `https://qr.frammr.no/holdeplass/${id.replace(/^NSR:StopPlace:/, "")}`,
    );

    const result = await generatePdfsForStopPlaces(["NSR:StopPlace:10003"], {
      outputDirectory,
      generateQrUrl,
      stopPlaceFetcher: async () => [
        stopPlace("NSR:StopPlace:10003", { name: "Malmefjorden" }),
      ],
    });

    expect(generateQrUrl).toHaveBeenCalledTimes(1);
    expect(generateQrUrl).toHaveBeenCalledWith({
      id: "NSR:StopPlace:10003",
      name: "Malmefjorden",
    });

    expect(capturedQrUrls).toEqual(["https://qr.frammr.no/holdeplass/10003"]);
    expect(result.failed).toEqual([]);
    expect(result.generated).toHaveLength(1);
  });

  it("passes multiple resolved QR URLs through without package-side rewriting", async () => {
    const outputDirectory = await makeTempDir();
    const stripPrefix = (id: string) => id.replace(/^NSR:StopPlace:/, "");

    const result = await generatePdfsForStopPlaces(
      ["NSR:StopPlace:10003", "NSR:StopPlace:10004"],
      {
        outputDirectory,
        generateQrUrl: ({ id }) =>
          `https://qr.frammr.no/holdeplass/${stripPrefix(id)}`,
        stopPlaceFetcher: async (ids) => ids.map((id) => stopPlace(id)),
      },
    );

    expect(capturedQrUrls.sort()).toEqual(
      [
        "https://qr.frammr.no/holdeplass/10003",
        "https://qr.frammr.no/holdeplass/10004",
      ].sort(),
    );
    expect(result.generated).toHaveLength(2);
    expect(result.failed).toEqual([]);
  });

  it("falls back to the legacy departures URL when generateQrUrl is omitted", async () => {
    const outputDirectory = await makeTempDir();

    await generatePdfsForStopPlaces(["NSR:StopPlace:10003"], {
      outputDirectory,
      stopPlaceFetcher: async () => [stopPlace("NSR:StopPlace:10003")],
    });

    expect(capturedQrUrls).toEqual([
      "https://reise.frammr.no/departures/NSR%3AStopPlace%3A10003?qr",
    ]);
  });

  it("uses the explicit FRAM config identically to the implicit default", async () => {
    const defaultOutputDirectory = await makeTempDir();
    const configuredOutputDirectory = await makeTempDir();
    const posterConfig = await loadFramPosterConfig();
    const request = {
      id: "NSR:StopPlace:10003",
      name: "Same FRAM Poster",
      transportMode: ["bus"],
    };

    const defaultResult = await generatePdfsForStopPlaces([request], {
      outputDirectory: defaultOutputDirectory,
    });
    const configuredResult = await generatePdfsForStopPlaces([request], {
      outputDirectory: configuredOutputDirectory,
      posterConfig,
    });

    expect(defaultResult.failed).toEqual([]);
    expect(configuredResult.failed).toEqual([]);
    expect(capturedQrUrls).toEqual([
      "https://reise.frammr.no/departures/NSR%3AStopPlace%3A10003?qr",
      "https://reise.frammr.no/departures/NSR%3AStopPlace%3A10003?qr",
    ]);
    const defaultPdf = await fs.readFile(
      defaultResult.generated[0]?.outputPath ?? "",
    );
    const configuredPdf = await fs.readFile(
      configuredResult.generated[0]?.outputPath ?? "",
    );
    expect(readMediaBox(defaultPdf)).toEqual(readMediaBox(configuredPdf));
  });

  it("uses custom poster QR URL templates and supports posters without a logo", async () => {
    const outputDirectory = await makeTempDir();
    const posterConfig = await loadFramPosterConfig();
    posterConfig.logo = null;
    posterConfig.qrUrlTemplate =
      "https://example.no/stops/{{encodedNsrId}}?name={{encodedStopName}}";

    const result = await generatePdfsForStopPlaces(
      [{ id: "NSR:StopPlace:10003", name: "Åsen øst" }],
      { outputDirectory, posterConfig },
    );

    expect(result.failed).toEqual([]);
    expect(capturedQrUrls).toEqual([
      "https://example.no/stops/NSR%3AStopPlace%3A10003?name=%C3%85sen%20%C3%B8st",
    ]);
  });

  it.each([
    ["empty string", () => ""],
    ["relative URL", () => "/holdeplass/10003"],
    ["non-http(s) protocol", () => "ftp://qr.frammr.no/holdeplass/10003"],
    ["non-string return value", () => 12345 as unknown as string],
  ])(
    "reports a per-item error when generateQrUrl returns %s",
    async (_label, generateQrUrl) => {
      const outputDirectory = await makeTempDir();

      const result = await generatePdfsForStopPlaces(["NSR:StopPlace:10003"], {
        outputDirectory,
        generateQrUrl,
        stopPlaceFetcher: async () => [stopPlace("NSR:StopPlace:10003")],
      });

      expect(result.generated).toEqual([]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.nsrId).toBe("NSR:StopPlace:10003");
      expect(result.failed[0]?.error).toMatch(/invalid URL/i);
    },
  );

  it.each([
    ["A4", 595.28, 841.89],
    ["A3", 841.89, 1190.55],
    ["Letter", 612.0, 792.0],
  ] as const)("selects the %s page size", async (format, width, height) => {
    const outputDirectory = await makeTempDir();

    const result = await generatePdfsForStopPlaces(["NSR:StopPlace:10003"], {
      outputDirectory,
      format,
      orientation: "portrait",
      stopPlaceFetcher: async () => [
        stopPlace("NSR:StopPlace:10003", { name: "Format Test" }),
      ],
    });

    expect(result.generated).toHaveLength(1);
    const [generated] = result.generated;
    if (!generated) throw new Error("Expected a generated PDF");
    const buf = await fs.readFile(generated.outputPath);
    const [pdfWidth, pdfHeight] = readMediaBox(buf);
    expect(pdfWidth).toBeCloseTo(width, 1);
    expect(pdfHeight).toBeCloseTo(height, 1);
  });

  it("skips an existing output file when overwrite is false, and replaces it when overwrite is true", async () => {
    const outputDirectory = await makeTempDir();
    const stopPlaceFetcher = async () => [
      stopPlace("NSR:StopPlace:10003", { name: "Overwrite Test" }),
    ];

    const first = await generatePdfsForStopPlaces(["NSR:StopPlace:10003"], {
      outputDirectory,
      stopPlaceFetcher,
    });
    expect(first.generated).toHaveLength(1);
    const [firstGenerated] = first.generated;
    if (!firstGenerated) throw new Error("Expected a generated PDF");
    const outputPath = firstGenerated.outputPath;
    const originalContent = await fs.readFile(outputPath);

    // Overwrite the file with sentinel bytes so we can detect skip vs replace.
    await fs.writeFile(outputPath, Buffer.from("SENTINEL"));

    const skipResult = await generatePdfsForStopPlaces(
      ["NSR:StopPlace:10003"],
      {
        outputDirectory,
        overwrite: false,
        stopPlaceFetcher,
      },
    );
    expect(skipResult.skipped).toEqual([
      { nsrId: "NSR:StopPlace:10003", outputPath },
    ]);
    expect(skipResult.generated).toEqual([]);
    expect((await fs.readFile(outputPath)).toString()).toBe("SENTINEL");

    const overwriteResult = await generatePdfsForStopPlaces(
      ["NSR:StopPlace:10003"],
      {
        outputDirectory,
        overwrite: true,
        stopPlaceFetcher,
      },
    );
    expect(overwriteResult.generated).toEqual([
      { nsrId: "NSR:StopPlace:10003", outputPath },
    ]);
    expect(overwriteResult.skipped).toEqual([]);
    const replacedContent = await fs.readFile(outputPath);
    expect(replacedContent.equals(Buffer.from("SENTINEL"))).toBe(false);
    expect(replacedContent.subarray(0, 5).toString()).toBe("%PDF-");
    expect(originalContent.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("emits one progress event per requested ID and returns correct generated/skipped/failed counts, without aborting the batch on a single failure", async () => {
    const outputDirectory = await makeTempDir();
    const ids = [
      "NSR:StopPlace:10001",
      "NSR:StopPlace:10002",
      "NSR:StopPlace:10003",
    ];

    const stopPlaceFetcher = async (requestedIds: string[]) =>
      requestedIds.map((id) =>
        id === "NSR:StopPlace:10002" ? null : stopPlace(id),
      );

    const events: Array<{ nsrId: string; status: string }> = [];
    const result = await generatePdfsForStopPlaces(ids, {
      outputDirectory,
      stopPlaceFetcher,
      onProgress: (event) => {
        events.push({ nsrId: event.nsrId, status: event.status });
        expect(event.total).toBe(3);
      },
    });

    expect(events).toHaveLength(3);
    expect(events.find((e) => e.nsrId === "NSR:StopPlace:10002")?.status).toBe(
      "error",
    );
    expect(events.filter((e) => e.status === "generated")).toHaveLength(2);

    expect(result.generated).toHaveLength(2);
    expect(result.failed).toEqual([
      {
        nsrId: "NSR:StopPlace:10002",
        error: expect.stringContaining("NSR:StopPlace:10002"),
      },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.totalGenerated).toBe(2);
  });

  it("does not call the metadata fetcher when every request is a fully-specified StopPlaceInput", async () => {
    const outputDirectory = await makeTempDir();
    const stopPlaceFetcher = vi.fn(async (ids: string[]) =>
      ids.map(() => null),
    );

    const result = await generatePdfsForStopPlaces(
      [
        { id: "NSR:StopPlace:10003", name: "Supplied Name A" },
        {
          id: "NSR:StopPlace:10004",
          name: "Supplied Name B",
          transportMode: ["bus"],
        },
      ],
      {
        outputDirectory,
        stopPlaceFetcher,
        generateQrUrl: ({ name }) =>
          `https://qr.frammr.no/holdeplass/${encodeURIComponent(name)}`,
      },
    );

    expect(stopPlaceFetcher).not.toHaveBeenCalled();
    expect(result.failed).toEqual([]);
    expect(result.generated).toHaveLength(2);
    expect(capturedQrUrls.sort()).toEqual(
      [
        "https://qr.frammr.no/holdeplass/Supplied%20Name%20A",
        "https://qr.frammr.no/holdeplass/Supplied%20Name%20B",
      ].sort(),
    );
  });

  it("only fetches metadata for requests that are bare IDs, in a mixed array of IDs and StopPlaceInputs", async () => {
    const outputDirectory = await makeTempDir();
    const stopPlaceFetcher = vi.fn(async (ids: string[]) =>
      ids.map((id) => stopPlace(id, { name: "Fetched Name" })),
    );

    const result = await generatePdfsForStopPlaces(
      [
        { id: "NSR:StopPlace:10003", name: "Supplied Name" },
        "NSR:StopPlace:10004",
      ],
      {
        outputDirectory,
        stopPlaceFetcher,
      },
    );

    expect(stopPlaceFetcher).toHaveBeenCalledTimes(1);
    expect(stopPlaceFetcher).toHaveBeenCalledWith(["NSR:StopPlace:10004"]);
    expect(result.generated).toHaveLength(2);
    expect(result.failed).toEqual([]);
  });

  describe("enrichTransportMode", () => {
    it("does not fetch a StopPlaceInput missing transportMode by default", async () => {
      const outputDirectory = await makeTempDir();
      const stopPlaceFetcher = vi.fn(async (ids: string[]) =>
        ids.map((id) => stopPlace(id, { transportMode: ["ferry"] })),
      );

      const result = await generatePdfsForStopPlaces(
        [{ id: "NSR:StopPlace:10003", name: "Supplied Name" }],
        { outputDirectory, stopPlaceFetcher },
      );

      expect(stopPlaceFetcher).not.toHaveBeenCalled();
      expect(result.failed).toEqual([]);
      expect(result.generated).toHaveLength(1);
    });

    it("fetches transport mode for a StopPlaceInput missing it when enrichTransportMode is true, without overwriting the supplied name", async () => {
      const outputDirectory = await makeTempDir();
      const stopPlaceFetcher = vi.fn(async (ids: string[]) =>
        ids.map((id) =>
          stopPlace(id, {
            name: "Entur Name (should be ignored)",
            transportMode: ["ferry"],
          }),
        ),
      );

      const result = await generatePdfsForStopPlaces(
        [{ id: "NSR:StopPlace:10003", name: "Supplied Name" }],
        {
          outputDirectory,
          stopPlaceFetcher,
          enrichTransportMode: true,
          generateQrUrl: ({ name }) =>
            `https://qr.frammr.no/holdeplass/${encodeURIComponent(name)}`,
        },
      );

      expect(stopPlaceFetcher).toHaveBeenCalledTimes(1);
      expect(stopPlaceFetcher).toHaveBeenCalledWith(["NSR:StopPlace:10003"]);
      expect(result.failed).toEqual([]);
      expect(result.generated).toHaveLength(1);
      // The supplied name wins even though the fetch returned a different one.
      expect(capturedQrUrls).toEqual([
        "https://qr.frammr.no/holdeplass/Supplied%20Name",
      ]);
    });

    it("does not re-fetch a StopPlaceInput that already has transportMode, even when enrichTransportMode is true", async () => {
      const outputDirectory = await makeTempDir();
      const stopPlaceFetcher = vi.fn(async (ids: string[]) =>
        ids.map(() => null),
      );

      const result = await generatePdfsForStopPlaces(
        [
          {
            id: "NSR:StopPlace:10003",
            name: "Supplied Name",
            transportMode: ["bus"],
          },
        ],
        { outputDirectory, stopPlaceFetcher, enrichTransportMode: true },
      );

      expect(stopPlaceFetcher).not.toHaveBeenCalled();
      expect(result.failed).toEqual([]);
      expect(result.generated).toHaveLength(1);
    });

    it("still succeeds using the supplied name when the enrichment fetch fails", async () => {
      const outputDirectory = await makeTempDir();
      const stopPlaceFetcher = vi.fn(async (ids: string[]) =>
        ids.map(() => null),
      );

      const result = await generatePdfsForStopPlaces(
        [{ id: "NSR:StopPlace:10003", name: "Supplied Name" }],
        { outputDirectory, stopPlaceFetcher, enrichTransportMode: true },
      );

      expect(stopPlaceFetcher).toHaveBeenCalledWith(["NSR:StopPlace:10003"]);
      expect(result.failed).toEqual([]);
      expect(result.generated).toHaveLength(1);
    });
  });

  it("uses the last entry when the request array contains duplicate IDs", async () => {
    const outputDirectory = await makeTempDir();
    const stopPlaceFetcher = vi.fn(async (ids: string[]) =>
      ids.map(() => null),
    );

    const result = await generatePdfsForStopPlaces(
      [
        { id: "NSR:StopPlace:10003", name: "First Name" },
        { id: "NSR:StopPlace:10003", name: "Last Name" },
      ],
      {
        outputDirectory,
        stopPlaceFetcher,
        generateQrUrl: ({ name }) =>
          `https://qr.frammr.no/holdeplass/${encodeURIComponent(name)}`,
      },
    );

    expect(stopPlaceFetcher).not.toHaveBeenCalled();
    expect(result.failed).toEqual([]);
    expect(capturedQrUrls).toEqual([
      "https://qr.frammr.no/holdeplass/Last%20Name",
    ]);
  });

  it("NsrBarcodeApi.generateSinglePdf skips Entur when `name` is supplied directly", async () => {
    const outputDirectory = await makeTempDir();
    const stopPlaceFetcher = vi.fn(async (ids: string[]) =>
      ids.map(() => null),
    );

    const result = await NsrBarcodeApi.generateSinglePdf({
      nsrId: "NSR:StopPlace:10003",
      outputDirectory,
      name: "Directly Supplied Name",
      stopPlaceFetcher,
    });

    expect(stopPlaceFetcher).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.pdfResult.failed).toEqual([]);
    expect(result.pdfResult.generated).toHaveLength(1);
  });

  it("resolves bundled fonts and images (no warnings, no network) even when process.cwd() is an unrelated temp directory", async () => {
    const outputDirectory = await makeTempDir();
    const unrelatedCwd = await makeTempDir();
    const originalCwd = process.cwd();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    process.chdir(unrelatedCwd);
    try {
      const result = await generatePdfsForStopPlaces(["NSR:StopPlace:10003"], {
        outputDirectory,
        stopPlaceFetcher: async () => [
          stopPlace("NSR:StopPlace:10003", { name: "Cwd Test" }),
        ],
      });

      expect(result.generated).toHaveLength(1);
      const [generated] = result.generated;
      if (!generated) throw new Error("Expected a generated PDF");
      const stats = await fs.stat(generated.outputPath);
      expect(stats.size).toBeGreaterThan(0);

      const warnMessages = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(
        warnMessages.some((m) =>
          m.includes("Could not load transport mode icon"),
        ),
      ).toBe(false);
      expect(
        warnMessages.some((m) => m.includes("Could not load logo image")),
      ).toBe(false);
      expect(
        warnMessages.some((m) =>
          m.includes("Failed to read bundled Poppins fonts"),
        ),
      ).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
