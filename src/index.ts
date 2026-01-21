import {
  canonicalParamsStrFromPairs,
  computeSignature,
  filterAndStringify,
  flattenParams,
  formUrlEncodeFromPairs,
  nonceUrlSafe,
  type Params,
} from "./utils.js";
import { APIException } from "./exceptions.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ClientOptions {
  apiBaseUrl?: string; // default https://api.carehq.co.uk
  timeoutMs?: number; // optional
  fetchImpl?: typeof fetch; // allow injection for tests/environments
}

export interface RateLimitInfo {
  limit: number | null;
  reset: number | null;
  remaining: number | null;
}

export interface BuiltRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  stringToSign: string;
  canonicalStr: string;
}

export interface RequestOptions {
  params?: Params;
  data?: Params;
}

export class APIClient {
  private accountId: string;
  private apiKey: string;
  private apiSecret: string;
  private apiBaseUrl: string;

  private timeoutMs?: number;
  private fetchImpl: typeof fetch;

  private _rateLimit: number | null = null;
  private _rateLimitReset: number | null = null;
  private _rateLimitRemaining: number | null = null;

  /**
   * Create a CareHQ API client.
   * @param accountId - CareHQ account identifier.
   * @param apiKey - API key tied to the account.
   * @param apiSecret - API secret used for request signing.
   * @param opts - Optional client configuration.
   */
  constructor(accountId: string, apiKey: string, apiSecret: string, opts: ClientOptions = {}) {
    this.accountId = accountId;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;

    this.apiBaseUrl = (opts.apiBaseUrl ?? "https://api.carehq.co.uk").replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Last observed rate limit value, if available.
   */
  get rateLimit(): number | null {
    return this._rateLimit;
  }
  /**
   * Epoch seconds when the current rate limit resets, if available.
   */
  get rateLimitReset(): number | null {
    return this._rateLimitReset;
  }
  /**
   * Remaining requests in the current rate limit window, if available.
   */
  get rateLimitRemaining(): number | null {
    return this._rateLimitRemaining;
  }
  /**
   * Snapshot of the most recent rate limit headers.
   */
  get rateLimitInfo(): RateLimitInfo {
    return { limit: this._rateLimit, reset: this._rateLimitReset, remaining: this._rateLimitRemaining };
  }

  /**
   * Build a signed request without sending it.
   * @param method - HTTP method.
   * @param path - API path without the /v1 prefix.
   * @param params - Query parameters for GET requests.
   * @param data - Form body parameters for non-GET requests.
   * @returns Request metadata including headers, body, and signature inputs.
   */
  buildRequest(method: HttpMethod, path: string, params?: Params, data?: Params): BuiltRequest {
    const cleanPath = String(path).replace(/^\/+|\/+$/g, "");
    const url = new URL(`${this.apiBaseUrl}/v1/${cleanPath}`);
    console.log(url)

    const methodUpper = method.toUpperCase() as HttpMethod;

    const paramsFiltered = filterAndStringify(params);
    const dataFiltered = filterAndStringify(data);

    const canonicalPairs =
      methodUpper === "GET"
        ? flattenParams(paramsFiltered ?? {})
        : flattenParams(dataFiltered ?? {});

    // GET -> query params; non-GET -> form body
    if (methodUpper === "GET" && canonicalPairs.length > 0) {
      for (const [k, v] of canonicalPairs) {
        url.searchParams.append(k, v);
      }
    }

    const timestampStr = String(Math.floor(Date.now() / 1000));
    const nonce = nonceUrlSafe(16);

    const canonicalStr = canonicalParamsStrFromPairs(canonicalPairs);

    const stringToSign = [timestampStr, nonce, methodUpper, `/v1/${cleanPath}`, canonicalStr].join("\n");

    const signature = computeSignature(this.apiSecret, Buffer.from(stringToSign, "utf8"));

    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-CareHQ-AccountId": this.accountId,
      "X-CareHQ-APIKey": this.apiKey,
      "X-CareHQ-Nonce": nonce,
      "X-CareHQ-Signature": signature,
      "X-CareHQ-Signature-Version": "2.0",
      "X-CareHQ-Timestamp": timestampStr,
    };

    let body: string | undefined;
    if (methodUpper !== "GET") {
      body = formUrlEncodeFromPairs(canonicalPairs);
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    return {
      url: url.toString(),
      method: methodUpper,
      headers,
      body,
      stringToSign,
      canonicalStr,
    };
  }

  /**
   * Send a signed API request and return the parsed response.
   * @param method - HTTP method.
   * @param path - API path without the /v1 prefix.
   * @param options - Query params and/or form body data.
   * @returns Parsed response payload.
   */
  async request<T = any>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const request = this.buildRequest(method, path, options.params, options.data);

    const controller = this.timeoutMs ? new AbortController() : undefined;
    const timeout = this.timeoutMs
      ? setTimeout(() => controller!.abort(new Error("Request timed out")), this.timeoutMs)
      : undefined;

    let response: Response;
    try {
      response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller?.signal,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    // rate limit headers
    const rateLimit = response.headers.get("X-CareHQ-RateLimit-Limit");
    if (rateLimit !== null) {
      const rateLimitReset = response.headers.get("X-CareHQ-RateLimit-Reset");
      const rateLimitRemaining = response.headers.get("X-CareHQ-RateLimit-Remaining");

      this._rateLimit = safeInt(rateLimit);
      this._rateLimitReset = safeFloat(rateLimitReset);
      this._rateLimitRemaining = safeInt(rateLimitRemaining);
    }

    // success
    if (response.status === 204) {
      return undefined as T;
    }
    if (response.status === 200) {
      return (await response.json()) as T;
    }

    // error
    let errorJson: any = {};
    try {
      errorJson = await response.json();
    } catch {
      errorJson = {};
    }

    const ErrorCls = APIException.getClassByStatusCode(response.status);
    const hint = errorJson?.hint ?? `${response.status} calling ${request.method} ${request.url}`;
    throw new ErrorCls(response.status, hint, errorJson?.arg_errors);
  }
}

/**
 * Parse an integer header value safely.
 * @param v - Raw header value.
 * @returns Parsed integer or null.
 */
function safeInt(v: string | null): number | null {
  if (v == null) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a float header value safely.
 * @param v - Raw header value.
 * @returns Parsed float or null.
 */
function safeFloat(v: string | null): number | null {
  if (v == null) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export * as exceptions from "./exceptions.js";
export type { Params } from "./utils.js";
