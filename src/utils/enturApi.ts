import axios, { AxiosResponse } from "axios";

export interface StopPlaceInfo {
  id: string;
  name?: string;
  description?: string;
  transportMode?: string[];
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  municipality?: string;
  county?: string;
}

export interface EnturApiError extends Error {
  code:
    | "API_ERROR"
    | "NOT_FOUND"
    | "NETWORK_ERROR"
    | "INVALID_ID"
    | "RATE_LIMITED";
  statusCode?: number;
  retryAfter?: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

/**
 * Per-item progress event emitted while {@link EnturApiClient.getMultipleStopPlaces}
 * fetches stop place metadata.
 */
export interface StopPlaceFetchProgressEvent {
  current: number;
  total: number;
  nsrId: string;
  status: "fetched" | "error";
  error?: string;
}

/**
 * Entur API client for fetching stop place information
 */
export class EnturApiClient {
  private readonly baseUrl = "https://api.entur.io/stop-places/v1";
  private readonly clientName: string;
  private readonly retryConfig: RetryConfig;

  constructor(
    clientName: string = "nsr-barcode-generator",
    retryConfig: Partial<RetryConfig> = {}
  ) {
    this.clientName = clientName;
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
      backoffMultiplier: 2,
      ...retryConfig,
    };
  }

  /**
   * Sleeps for the specified number of milliseconds
   * @param ms - Milliseconds to sleep
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculates the delay for retry attempts with exponential backoff
   * @param attempt - Current attempt number (0-based)
   * @param retryAfter - Optional retry-after header value in seconds
   * @returns Delay in milliseconds
   */
  private calculateRetryDelay(attempt: number, retryAfter?: number): number {
    if (retryAfter) {
      // Use retry-after header if provided, but cap at maxDelay
      return Math.min(retryAfter * 1000, this.retryConfig.maxDelay);
    }

    // Exponential backoff: baseDelay * (backoffMultiplier ^ attempt)
    const delay =
      this.retryConfig.baseDelay *
      Math.pow(this.retryConfig.backoffMultiplier, attempt);
    return Math.min(delay, this.retryConfig.maxDelay);
  }

  /**
   * Fetches stop place information by ID
   * @param stopPlaceId - The stop place ID (e.g., NSR:StopPlace:132)
   * @returns Promise that resolves to stop place information
   */
  async getStopPlace(stopPlaceId: string): Promise<StopPlaceInfo> {
    // Validate ID format
    if (!stopPlaceId.startsWith("NSR:StopPlace:")) {
      const error = new Error(
        `Invalid stop place ID format: ${stopPlaceId}`
      ) as EnturApiError;
      error.code = "INVALID_ID";
      throw error;
    }

    let lastError: Error = new Error("Unknown error");

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const response: AxiosResponse = await axios.get(
          `${this.baseUrl}/read/stop-places/${encodeURIComponent(stopPlaceId)}`,
          {
            headers: {
              "ET-Client-Name": this.clientName,
              Accept: "application/json",
            },
            timeout: 10000, // 10 second timeout
          }
        );

        return this.parseStopPlaceResponse(response.data, stopPlaceId);
      } catch (error) {
        lastError = error as Error;

        if (axios.isAxiosError(error)) {
          // Handle 404 errors immediately (no retry)
          if (error.response?.status === 404) {
            const apiError = new Error(
              `Stop place not found: ${stopPlaceId}`
            ) as EnturApiError;
            apiError.code = "NOT_FOUND";
            apiError.statusCode = 404;
            throw apiError;
          }

          // Handle 429 rate limiting with retry
          if (error.response?.status === 429) {
            if (attempt < this.retryConfig.maxRetries) {
              // Extract retry-after header if present
              const retryAfterHeader = error.response.headers["retry-after"];
              const retryAfter = retryAfterHeader
                ? parseInt(retryAfterHeader, 10)
                : undefined;

              const delay = this.calculateRetryDelay(attempt, retryAfter);

              console.warn(
                `Rate limited for stop place ${stopPlaceId}. Retrying in ${delay}ms (attempt ${
                  attempt + 1
                }/${this.retryConfig.maxRetries})`
              );

              await this.sleep(delay);
              continue; // Retry the request
            } else {
              // Max retries exceeded for rate limiting
              const rateLimitError = new Error(
                `Rate limit exceeded for stop place ${stopPlaceId} after ${this.retryConfig.maxRetries} retries`
              ) as EnturApiError;
              rateLimitError.code = "RATE_LIMITED";
              rateLimitError.statusCode = 429;
              throw rateLimitError;
            }
          }

          // Handle other HTTP errors
          if (error.response?.status) {
            // For server errors (5xx), we might want to retry
            if (
              error.response.status >= 500 &&
              attempt < this.retryConfig.maxRetries
            ) {
              const delay = this.calculateRetryDelay(attempt);
              console.warn(
                `Server error ${
                  error.response.status
                } for stop place ${stopPlaceId}. Retrying in ${delay}ms (attempt ${
                  attempt + 1
                }/${this.retryConfig.maxRetries})`
              );
              await this.sleep(delay);
              continue; // Retry the request
            }

            // For client errors (4xx except 404 and 429), don't retry
            const apiError = new Error(
              `API error: ${error.response.status} - ${error.response.statusText}`
            ) as EnturApiError;
            apiError.code = "API_ERROR";
            apiError.statusCode = error.response.status;
            throw apiError;
          } else {
            // Network error - retry if we haven't exceeded max attempts
            if (attempt < this.retryConfig.maxRetries) {
              const delay = this.calculateRetryDelay(attempt);
              console.warn(
                `Network error for stop place ${stopPlaceId}. Retrying in ${delay}ms (attempt ${
                  attempt + 1
                }/${this.retryConfig.maxRetries})`
              );
              await this.sleep(delay);
              continue; // Retry the request
            }

            const networkError = new Error(
              `Network error: ${error.message}`
            ) as EnturApiError;
            networkError.code = "NETWORK_ERROR";
            throw networkError;
          }
        }

        // Re-throw if it's already our custom error
        if ((error as EnturApiError).code) {
          throw error;
        }

        // For unknown errors, retry if we haven't exceeded max attempts
        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.calculateRetryDelay(attempt);
          console.warn(
            `Unknown error for stop place ${stopPlaceId}. Retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${this.retryConfig.maxRetries})`
          );
          await this.sleep(delay);
          continue; // Retry the request
        }
      }
    }

    // If we get here, all retries have been exhausted
    const unknownError = new Error(
      `All retries exhausted for stop place ${stopPlaceId}. Last error: ${lastError.message}`
    ) as EnturApiError;
    unknownError.code = "API_ERROR";
    throw unknownError;
  }

  /**
   * Fetches multiple stop places with controlled concurrency to avoid rate limiting
   * @param stopPlaceIds - Array of stop place IDs
   * @param options - Options for batch processing
   * @returns Promise that resolves to array of stop place information
   */
  async getMultipleStopPlaces(
    stopPlaceIds: string[],
    options: {
      batchSize?: number;
      delayBetweenBatches?: number;
      concurrency?: number;
      /** Called once per ID as its metadata fetch completes (success or failure). */
      onProgress?: (event: StopPlaceFetchProgressEvent) => void;
    } = {}
  ): Promise<(StopPlaceInfo | null)[]> {
    const {
      batchSize = 100,
      delayBetweenBatches = 1000,
      concurrency = 5,
      onProgress,
    } = options;

    const results: (StopPlaceInfo | null)[] = [];
    const total = stopPlaceIds.length;
    let completed = 0;

    const onItemDone = onProgress
      ? (id: string, status: "fetched" | "error", error?: string) => {
          completed++;
          onProgress({
            current: completed,
            total,
            nsrId: id,
            status,
            ...(error ? { error } : {}),
          });
        }
      : undefined;

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < stopPlaceIds.length; i += batchSize) {
      const batch = stopPlaceIds.slice(i, i + batchSize);

      // Process batch with limited concurrency
      const batchResults = await this.processBatchWithConcurrency(
        batch,
        concurrency,
        onItemDone
      );
      results.push(...batchResults);

      // Add delay between batches (except for the last batch)
      if (i + batchSize < stopPlaceIds.length) {
        console.log(
          `Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            stopPlaceIds.length / batchSize
          )}. Waiting ${delayBetweenBatches}ms before next batch...`
        );
        await this.sleep(delayBetweenBatches);
      }
    }

    return results;
  }

  /**
   * Processes a batch of stop place IDs with controlled concurrency
   * @param stopPlaceIds - Array of stop place IDs to process
   * @param concurrency - Maximum number of concurrent requests
   * @returns Promise that resolves to array of stop place information
   */
  private async processBatchWithConcurrency(
    stopPlaceIds: string[],
    concurrency: number,
    onItemDone?: (id: string, status: "fetched" | "error", error?: string) => void
  ): Promise<(StopPlaceInfo | null)[]> {
    const results: (StopPlaceInfo | null)[] = new Array(stopPlaceIds.length);

    // Process items in chunks of the concurrency limit
    for (let i = 0; i < stopPlaceIds.length; i += concurrency) {
      const chunk = stopPlaceIds.slice(i, i + concurrency);

      const chunkPromises = chunk.map(async (id, chunkIndex) => {
        const globalIndex = i + chunkIndex;
        try {
          const result = await this.getStopPlace(id);
          results[globalIndex] = result;
          onItemDone?.(id, "fetched");
        } catch (error) {
          console.warn(
            `Failed to fetch stop place ${id}:`,
            (error as Error).message
          );
          results[globalIndex] = null;
          onItemDone?.(id, "error", (error as Error).message);
        }
      });

      // Wait for all requests in this chunk to complete before proceeding
      await Promise.allSettled(chunkPromises);

      // Small delay between chunks to be gentle on the API
      if (i + concurrency < stopPlaceIds.length) {
        await this.sleep(100); // 100ms delay between chunks
      }
    }

    return results;
  }

  /**
   * Parses the API response to extract relevant stop place information
   * @param data - Parsed API response data
   * @param originalId - Original ID for fallback
   * @returns Parsed stop place information
   */
  private parseStopPlaceResponse(data: any, originalId: string): StopPlaceInfo {
    const stopPlace: StopPlaceInfo = {
      id: originalId,
    };

    try {
      if (data) {
        // Extract name
        if (data.name?.value) {
          stopPlace.name = data.name.value;
        } else if (typeof data.name === "string") {
          stopPlace.name = data.name;
        }

        // Extract description
        if (data.description?.value) {
          stopPlace.description = data.description.value;
        } else if (typeof data.description === "string") {
          stopPlace.description = data.description;
        }

        // Extract transport modes
        if (data.transportMode) {
          stopPlace.transportMode = Array.isArray(data.transportMode)
            ? data.transportMode
            : [data.transportMode];
        }

        // Extract coordinates from centroid
        if (
          data.centroid?.location?.longitude &&
          data.centroid?.location?.latitude
        ) {
          stopPlace.coordinates = {
            latitude: data.centroid.location.latitude,
            longitude: data.centroid.location.longitude,
          };
        }

        // Extract municipality from topographicPlaceRef
        if (data.topographicPlaceRef?.ref) {
          // The ref contains an ID like "KVE:TopographicPlace:1579"
          // We'll store the reference for now
          stopPlace.municipality = `Ref: ${data.topographicPlaceRef.ref}`;
        }
      }
    } catch (error) {
      console.warn(`Error parsing stop place data for ${originalId}:`, error);
    }

    return stopPlace;
  }
}

/**
 * Creates an Entur API client with conservative rate limiting settings
 * Useful for bulk operations to avoid hitting rate limits
 * @param clientName - Optional client name
 * @returns EnturApiClient with conservative settings
 */
export function createConservativeEnturClient(
  clientName?: string
): EnturApiClient {
  return new EnturApiClient(clientName, {
    maxRetries: 5,
    baseDelay: 2000, // 2 seconds
    maxDelay: 60000, // 1 minute
    backoffMultiplier: 2,
  });
}

/**
 * Default Entur API client instance
 */
export const enturApi = new EnturApiClient();
