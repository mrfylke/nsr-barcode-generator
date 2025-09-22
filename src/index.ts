#!/usr/bin/env node

/**
 * Main entry point - exports both CLI and API functionality
 * When run directly, it executes the CLI
 * When imported, it provides access to the API
 */

// Re-export the API for programmatic access
export * from "./api";
export { default as NsrBarcodeApi } from "./api";

// When run directly (not imported), execute the CLI
if (require.main === module) {
  require("./cli");
}
