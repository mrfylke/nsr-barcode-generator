import { describe, expect, it } from "vitest";
import { NsrBarcodeApi } from "./api";

describe("NsrBarcodeApi.validateNsrId", () => {
  it("accepts a well-formed NSR:StopPlace ID", () => {
    expect(NsrBarcodeApi.validateNsrId("NSR:StopPlace:10003").isValid).toBe(
      true,
    );
  });

  it.each([
    ["empty string", ""],
    ["empty numeric suffix", "NSR:StopPlace:"],
    ["non-numeric suffix", "NSR:StopPlace:abc"],
    ["extra colon", "NSR:StopPlace:10003:extra"],
    ["leading whitespace", " NSR:StopPlace:10003"],
    ["trailing whitespace", "NSR:StopPlace:10003 "],
    ["NSR:Quay instead of StopPlace", "NSR:Quay:10003"],
  ])("rejects %s (%s)", (_label, id) => {
    const result = NsrBarcodeApi.validateNsrId(id);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
