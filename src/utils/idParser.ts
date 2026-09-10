/**
 * Parses unique IDs from file content and validates them
 */

export interface IdParseResult {
  uniqueIds: Set<string>;
  totalCount: number;
  duplicateCount: number;
  emptyLineCount: number;
}

export interface IdParseError extends Error {
  code: "EMPTY_FILE" | "NO_VALID_IDS" | "INVALID_FORMAT";
}

/**
 * Parses unique IDs from file content
 * @param content - The file content to parse
 * @returns Promise that resolves to the parse result
 * @throws IdParseError if file is invalid
 */
export async function parseUniqueIds(content: string): Promise<IdParseResult> {
  if (!content || content.trim().length === 0) {
    const error = new Error(
      "File is empty or contains no content",
    ) as IdParseError;
    error.code = "EMPTY_FILE";
    throw error;
  }

  const lines = content.split(/\r?\n/);
  const uniqueIds = new Set<string>();
  let totalCount = 0;
  let duplicateCount = 0;
  let emptyLineCount = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (trimmedLine === "") {
      emptyLineCount++;
      continue;
    }

    // Validate ID format (basic validation - non-empty, no whitespace)
    if (trimmedLine.includes(" ") || trimmedLine.includes("\t")) {
      const error = new Error(
        `Invalid ID format: IDs cannot contain whitespace. Found: "${trimmedLine}"`,
      ) as IdParseError;
      error.code = "INVALID_FORMAT";
      throw error;
    }

    totalCount++;

    if (uniqueIds.has(trimmedLine)) {
      duplicateCount++;
    } else {
      uniqueIds.add(trimmedLine);
    }
  }

  if (uniqueIds.size === 0) {
    const error = new Error("No valid IDs found in file") as IdParseError;
    error.code = "NO_VALID_IDS";
    throw error;
  }

  return {
    uniqueIds,
    totalCount,
    duplicateCount,
    emptyLineCount,
  };
}

/**
 * Formats the ID count result for display
 * @param result - The parse result
 * @returns Formatted string for console output
 */
export function formatIdCountResult(result: IdParseResult): string {
  const { uniqueIds, totalCount, duplicateCount, emptyLineCount } = result;

  let output = `Number of unique IDs: ${uniqueIds.size}`;

  if (duplicateCount > 0) {
    output += `\nTotal IDs processed: ${totalCount}`;
    output += `\nDuplicate IDs found: ${duplicateCount}`;
  }

  if (emptyLineCount > 0) {
    output += `\nEmpty lines skipped: ${emptyLineCount}`;
  }

  return output;
}
