import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';

export type PayloadVersion = '1.0' | '2.0';
export interface FieldError { field: string; message: string }
export interface PublicError {
  message: string;
  code?: string;
  fields?: readonly FieldError[];
}

/** Only errors explicitly constructed as HttpError have public messages. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string | undefined;
  readonly fields: readonly FieldError[] | undefined;
  constructor(statusCode: number, details: PublicError) {
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      throw new RangeError('HttpError statusCode must be an integer between 400 and 599');
    }
    super(details.message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = details.code;
    this.fields = details.fields?.map((field) => ({ ...field }));
  }
}

/** Structural subset compatible with AWS HTTP events; no AWS runtime dependency. */
export interface HttpEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { requestId?: string };
}
export interface ResponseOptions {
  headers?: Readonly<Record<string, string>>;
  /** Each entry is a complete Set-Cookie value. Never comma-joined. */
  cookies?: readonly string[];
}
export interface V1Response {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: false;
  multiValueHeaders?: Record<string, string[]>;
}
export interface V2Response {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: false;
  cookies?: string[];
}
export type HttpResponse<V extends PayloadVersion> = V extends '1.0' ? V1Response : V2Response;
export interface ErrorContext { requestId?: string }
export interface HttpOptions<V extends PayloadVersion> {
  payloadVersion: V;
  headers?: Readonly<Record<string, string>>;
  /** Called for unexpected exceptions only. Failures in this hook are contained. */
  onError?: (error: unknown, context: ErrorContext) => void | Promise<void>;
  /** Receives public errors or a sanitized internal error, never raw exceptions. */
  formatError?: (error: HttpError) => unknown;
}
export interface ParseJsonOptions { required?: boolean }

/** Parses JSON, without claiming to validate its shape. Empty optional bodies yield undefined. */
export function parseJson(event: HttpEvent, options: ParseJsonOptions = {}): unknown {
  let body = event.body;
  if (event.isBase64Encoded && body) {
    // Buffer.from alone silently accepts malformed input. Require canonical padded RFC 4648 base64.
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body)) {
      throw new HttpError(400, { code: 'INVALID_BASE64', message: 'Request body must be valid base64' });
    }
    const bytes = Buffer.from(body, 'base64');
    if (bytes.toString('base64') !== body) {
      throw new HttpError(400, { code: 'INVALID_BASE64', message: 'Request body must be valid base64' });
    }
    try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new HttpError(400, { code: 'INVALID_UTF8', message: 'Request body must be valid UTF-8' }); }
  }
  if (body == null || body === '') {
    if (options.required === false) return undefined;
    throw new HttpError(400, { code: 'BODY_REQUIRED', message: 'Request body is required' });
  }
  try { return JSON.parse(body) as unknown; }
  catch { throw new HttpError(400, { code: 'INVALID_JSON', message: 'Request body must be valid JSON' }); }
}

function mergeHeaders(...sources: (Readonly<Record<string, string>> | undefined)[]): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const source of sources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n\0]/.test(value)) {
        throw new TypeError('Invalid HTTP header');
      }
      if (name.toLowerCase() === 'set-cookie') throw new TypeError('Use the cookies option for Set-Cookie');
      result[name.toLowerCase()] = value;
    }
  }
  return { ...result };
}

function defaultErrorBody(error: HttpError): unknown {
  return {
    error: error.message,
    ...(error.code !== undefined ? { code: error.code } : {}),
    ...(error.fields !== undefined ? { errors: error.fields } : {}),
  };
}

export function createHttp<V extends PayloadVersion>(options: HttpOptions<V>) {
  if (options.payloadVersion !== '1.0' && options.payloadVersion !== '2.0') {
    throw new TypeError('payloadVersion must be 1.0 or 2.0');
  }
  const version = options.payloadVersion;
  const defaults = mergeHeaders(options.headers);
  const formatError = options.formatError ?? defaultErrorBody;
  const onError = options.onError;

  function response(statusCode: number, body: string, responseOptions: ResponseOptions = {}): HttpResponse<V> {
    const cookies = [...(responseOptions.cookies ?? [])];
    if (cookies.some((cookie) => /[\r\n\0]/.test(cookie))) throw new TypeError('Invalid cookie');
    const headers = mergeHeaders(defaults, responseOptions.headers);
    // These statuses cannot carry response content.
    if (statusCode === 204 || statusCode === 205 || statusCode === 304) {
      body = '';
      delete headers['content-type'];
      delete headers['content-length'];
      delete headers['transfer-encoding'];
    }
    return {
      statusCode, headers, body, isBase64Encoded: false,
      ...(cookies.length ? version === '1.0'
        ? { multiValueHeaders: { 'Set-Cookie': cookies } }
        : { cookies } : {}),
    } as HttpResponse<V>;
  }

  function json(data: unknown, statusCode = 200, responseOptions: ResponseOptions = {}): HttpResponse<V> {
    if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode > 599) {
      throw new RangeError('Response statusCode must be an integer between 200 and 599');
    }
    if ([204, 205, 304].includes(statusCode)) throw new TypeError('Use noContent() for a bodyless response');
    const body = JSON.stringify(data);
    if (body === undefined) throw new TypeError('Response value is not JSON serializable');
    return response(statusCode, body, {
      ...responseOptions,
      headers: mergeHeaders({ 'content-type': 'application/json; charset=utf-8' }, defaults, responseOptions.headers),
    });
  }

  async function report(error: unknown, event: HttpEvent): Promise<void> {
    try {
      await onError?.(error, event.requestContext?.requestId === undefined
        ? {} : { requestId: event.requestContext.requestId });
    } catch { /* Logging failure must not replace the response. */ }
  }

  function handle<E extends HttpEvent, C = unknown>(
    handler: (event: E, context: C) => HttpResponse<V> | Promise<HttpResponse<V>>,
  ): (event: E, context: C) => Promise<HttpResponse<V>> {
    return async (event, context) => {
      try {
        const result = await handler(event, context);
        if (!result || typeof result.body !== 'string' || !Number.isInteger(result.statusCode)
          || result.statusCode < 200 || result.statusCode > 599) {
          throw new TypeError('Handler must return an explicit HTTP response');
        }
        return result;
      } catch (error) {
        if (!(error instanceof HttpError)) await report(error, event);
        const publicError = error instanceof HttpError ? error
          : new HttpError(500, { message: 'Internal server error', code: 'INTERNAL_ERROR' });
        try { return json(formatError(publicError), publicError.statusCode); }
        catch (formatFailure) {
          await report(formatFailure, event);
          // Independent of the formatter, with the same configured headers.
          return json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
        }
      }
    };
  }

  return {
    json,
    created: (data: unknown, responseOptions?: ResponseOptions) => json(data, 201, responseOptions),
    noContent: (responseOptions?: ResponseOptions) => response(204, '', responseOptions),
    parseJson,
    handle,
  };
}
