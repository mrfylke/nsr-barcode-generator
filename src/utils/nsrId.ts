/**
 * Shared parsing/validation for NSR stop place IDs (e.g. "NSR:StopPlace:10003").
 * Used both for input validation and for extracting the numeric segment that
 * downstream consumers (e.g. QR URL builders) may need.
 */

const NSR_STOP_PLACE_PATTERN = /^NSR:StopPlace:([0-9]+)$/;

/**
 * Extracts the numeric segment from a full NSR stop place ID.
 * Returns null if the ID does not match `NSR:StopPlace:<digits>` exactly
 * (no leading/trailing whitespace, no extra colons, no non-numeric suffix).
 */
export function extractStopPlaceNumber(nsrId: string): string | null {
  const match = NSR_STOP_PLACE_PATTERN.exec(nsrId);
  return match?.[1] ?? null;
}

/**
 * Validates that an ID matches `NSR:StopPlace:<digits>` exactly.
 */
export function isValidNsrStopPlaceId(nsrId: string): boolean {
  return NSR_STOP_PLACE_PATTERN.test(nsrId);
}
