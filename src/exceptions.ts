export type ArgErrors = Record<string, string[] | string>;

/**
 * Base error type for CareHQ API failures.
 */
export class APIException extends Error {
  public statusCode: number;
  public hint?: string;
  public argErrors?: ArgErrors;

  /**
   * Create an API exception.
   * @param statusCode - HTTP status code.
   * @param hint - Optional human-readable hint.
   * @param argErrors - Optional field-level errors.
   */
  constructor(statusCode: number, hint?: string, argErrors?: ArgErrors) {
    super(hint || `CareHQ API error (${statusCode})`);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.hint = hint;
    this.argErrors = argErrors;
  }

  /**
   * Map an HTTP status code to a specific exception type.
   * @param statusCode - HTTP status code.
   * @returns Exception class for the status code.
   */
  static getClassByStatusCode(statusCode: number): typeof APIException {
    if (statusCode === 400) return BadRequest;
    if (statusCode === 401) return Unauthorized;
    if (statusCode === 403) return Forbidden;
    if (statusCode === 404) return NotFound;
    if (statusCode === 422) return UnprocessableEntity;
    if (statusCode === 429) return RateLimited;
    if (statusCode >= 500) return ServerError;
    return APIException;
  }
}

export class BadRequest extends APIException {}
export class Unauthorized extends APIException {}
export class Forbidden extends APIException {}
export class NotFound extends APIException {}
export class UnprocessableEntity extends APIException {}
export class RateLimited extends APIException {}
export class ServerError extends APIException {}
