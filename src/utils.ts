import { createHmac, randomBytes } from "node:crypto";

/**
 * Input params shape:
 * - values can be scalar or arrays
 * - null/undefined are filtered out before encoding/signing
 */
export type Params = Record<
  string,
  string | number | boolean | null | undefined | Array<string | number | boolean>
>;

/**
 * Convert values to strings, preserving arrays.
 * @param v - Input value to stringify.
 * @returns String or array of strings.
 */
export function ensureString(v: any): string | string[] {
  if (Array.isArray(v)) return v.map((i) => String(i));
  return String(v);
}

/**
 * Filter null/undefined and stringify scalars/arrays.
 * @param obj - Input params object.
 * @returns Sanitized params or undefined when empty.
 */
export function filterAndStringify(obj?: Params | null): Record<string, string | string[]> | undefined {
  if (!obj) return undefined;

  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    out[k] = ensureString(v) as any;
  }
  return out;
}

/**
 * Flatten params into canonical key/value pairs.
 * @param params - Input params.
 * @returns Sorted pairs suitable for signing and encoding.
 */
export function flattenParams(params?: Record<string, any> | null): Array<[string, string]> {
  const p = params ?? {};
  const out: Array<[string, string]> = [];

  const keys = Object.keys(p).sort();
  for (const key of keys) {
    let values = p[key];

    if (!Array.isArray(values)) values = [values];

    const sortedValues = values.map((x: any) => String(x)).sort();
    for (const value of sortedValues) {
      out.push([key, value]);
    }
  }

  return out;
}

/**
 * Build the canonical string from flattened pairs.
 * @param pairs - Ordered key/value pairs.
 * @returns Canonical string for signing.
 */
export function canonicalParamsStrFromPairs(pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => `${k}=${v}`).join("\n");
}

/**
 * URL-encode flattened pairs as application/x-www-form-urlencoded.
 * @param pairs - Ordered key/value pairs.
 * @returns Encoded form body.
 */
export function formUrlEncodeFromPairs(pairs: Array<[string, string]>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of pairs) usp.append(k, v);
  return usp.toString();
}

/**
 * Compute an HMAC-SHA256 signature (hex digest).
 * @param secret - Signing secret.
 * @param msgUtf8 - Bytes or string to sign.
 * @returns Hex-encoded signature.
 */
export function computeSignature(secret: string, msgUtf8: Uint8Array | string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(msgUtf8)
    .digest("hex");
}

/**
 * Generate a URL-safe nonce.
 * @param nbytes - Number of random bytes.
 * @returns Base64url-encoded nonce string.
 */
export function nonceUrlSafe(nbytes: number): string {
  const b64 = randomBytes(nbytes).toString("base64");
  return b64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Build a canonical string directly from params.
 * @param params - Input params.
 * @returns Canonical string for signing.
 */
export function canonicalParamsStr(params?: Record<string, any> | null): string {
  return canonicalParamsStrFromPairs(flattenParams(params));
}
