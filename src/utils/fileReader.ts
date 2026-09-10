import { promises as fs } from "node:fs";
import { resolve } from "node:path";

/**
 * Reads the contents of a file and returns it as a string
 * @param filePath - Path to the file to read
 * @returns Promise that resolves to the file contents
 * @throws Error if file cannot be read
 */
export async function readFile(filePath: string): Promise<string> {
  try {
    const absolutePath = resolve(filePath);
    const content = await fs.readFile(absolutePath, "utf-8");
    return content;
  } catch (error) {
    if (error instanceof Error) {
      // Provide more user-friendly error messages
      if ("code" in error) {
        switch (error.code) {
          case "ENOENT":
            throw new Error(`File not found: ${filePath}`);
          case "EACCES":
            throw new Error(`Permission denied: ${filePath}`);
          case "EISDIR":
            throw new Error(`Path is a directory, not a file: ${filePath}`);
          default:
            throw new Error(`Failed to read file: ${error.message}`);
        }
      }
    }
    throw new Error(`Failed to read file: ${filePath}`);
  }
}
