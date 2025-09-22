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
  code: "API_ERROR" | "NOT_FOUND" | "NETWORK_ERROR" | "INVALID_ID";
  statusCode?: number;
}

/**
 * Entur API client for fetching stop place information
 */
export class EnturApiClient {
  private readonly baseUrl = "https://api.entur.io/stop-places/v1";
  private readonly clientName: string;

  constructor(clientName: string = "nsr-barcode-generator") {
    this.clientName = clientName;
  }

  /**
   * Fetches stop place information by ID
   * @param stopPlaceId - The stop place ID (e.g., NSR:StopPlace:132)
   * @returns Promise that resolves to stop place information
   */
  async getStopPlace(stopPlaceId: string): Promise<StopPlaceInfo> {
    try {
      // Validate ID format
      if (!stopPlaceId.startsWith("NSR:StopPlace:")) {
        const error = new Error(
          `Invalid stop place ID format: ${stopPlaceId}`
        ) as EnturApiError;
        error.code = "INVALID_ID";
        throw error;
      }

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
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          const apiError = new Error(
            `Stop place not found: ${stopPlaceId}`
          ) as EnturApiError;
          apiError.code = "NOT_FOUND";
          apiError.statusCode = 404;
          throw apiError;
        } else if (error.response?.status) {
          const apiError = new Error(
            `API error: ${error.response.status} - ${error.response.statusText}`
          ) as EnturApiError;
          apiError.code = "API_ERROR";
          apiError.statusCode = error.response.status;
          throw apiError;
        } else {
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

      // Unknown error
      const unknownError = new Error(
        `Unknown error fetching stop place: ${error}`
      ) as EnturApiError;
      unknownError.code = "API_ERROR";
      throw unknownError;
    }
  }

  /**
   * Fetches multiple stop places in parallel
   * @param stopPlaceIds - Array of stop place IDs
   * @returns Promise that resolves to array of stop place information
   */
  async getMultipleStopPlaces(
    stopPlaceIds: string[]
  ): Promise<(StopPlaceInfo | null)[]> {
    const promises = stopPlaceIds.map(async (id) => {
      try {
        return await this.getStopPlace(id);
      } catch (error) {
        console.warn(
          `Failed to fetch stop place ${id}:`,
          (error as Error).message
        );
        return null; // Return null for failed requests
      }
    });

    return Promise.all(promises);
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
 * Default Entur API client instance
 */
export const enturApi = new EnturApiClient();
