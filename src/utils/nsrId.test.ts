import { describe, expect, it } from "vitest";
import { extractStopPlaceNumber, isValidNsrStopPlaceId } from "./nsrId";

describe("nsrId", () => {
  describe("isValidNsrStopPlaceId / extractStopPlaceNumber", () => {
    it("accepts a well-formed NSR:StopPlace ID and extracts the digits", () => {
      expect(isValidNsrStopPlaceId("NSR:StopPlace:10003")).toBe(true);
      expect(extractStopPlaceNumber("NSR:StopPlace:10003")).toBe("10003");
    });

    it("rejects an empty numeric suffix", () => {
      expect(isValidNsrStopPlaceId("NSR:StopPlace:")).toBe(false);
      expect(extractStopPlaceNumber("NSR:StopPlace:")).toBeNull();
    });

    it("rejects a non-numeric suffix", () => {
      expect(isValidNsrStopPlaceId("NSR:StopPlace:abc")).toBe(false);
      expect(isValidNsrStopPlaceId("NSR:StopPlace:10003x")).toBe(false);
      expect(extractStopPlaceNumber("NSR:StopPlace:abc")).toBeNull();
    });

    it("rejects an extra colon / trailing segment", () => {
      expect(isValidNsrStopPlaceId("NSR:StopPlace:10003:extra")).toBe(false);
      expect(extractStopPlaceNumber("NSR:StopPlace:10003:extra")).toBeNull();
    });

    it("rejects leading or trailing whitespace", () => {
      expect(isValidNsrStopPlaceId(" NSR:StopPlace:10003")).toBe(false);
      expect(isValidNsrStopPlaceId("NSR:StopPlace:10003 ")).toBe(false);
      expect(isValidNsrStopPlaceId("NSR:StopPlace:10003\n")).toBe(false);
      expect(extractStopPlaceNumber(" NSR:StopPlace:10003")).toBeNull();
    });

    it("rejects other NSR entity types such as NSR:Quay", () => {
      expect(isValidNsrStopPlaceId("NSR:Quay:10003")).toBe(false);
      expect(extractStopPlaceNumber("NSR:Quay:10003")).toBeNull();
    });

    it("rejects an empty string", () => {
      expect(isValidNsrStopPlaceId("")).toBe(false);
      expect(extractStopPlaceNumber("")).toBeNull();
    });
  });
});
