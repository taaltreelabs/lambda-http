# @taaltreelabs/lambda-http

Small TypeScript HTTP utilities for existing AWS Lambda handlers. Build JSON responses, parse request bodies, and turn explicitly public errors into consistent HTTP responses. Zero runtime dependencies.

**Status:** initial implementation, not yet published to npm. Requires Node.js 22 or newer. The API can change before 1.0. Buffered responses only.

```ts
import { createHttp, HttpError } from '@taaltreelabs/lambda-http';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

const http = createHttp({
  payloadVersion: '1.0',
  onError(error, { requestId }) {
    console.error({ requestId, error });
  },
});

export const handler = http.handle((event: APIGatewayProxyEvent, _context: Context) => {
  const input = http.parseJson(event);
  if (typeof input !== 'object' || input === null || !('name' in input)
      || typeof input.name !== 'string') {
    throw new HttpError(400, {
      message: 'Check the highlighted fields',
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'name', message: 'name must be a string' }],
    });
  }
  return http.created({ name: input.name });
});
```

## API

- `createHttp({ payloadVersion, headers?, onError?, formatError? })`: choose `'1.0'` for REST API proxy integration or `'2.0'` for HTTP API payload v2 / Function URLs. HTTP APIs configured for payload v1 use `'1.0'`. This setting does not configure AWS infrastructure.
- `http.json(data, statusCode = 200, options?)`: serializes JSON; rejects values such as top-level `undefined`, BigInt, and cycles that JSON cannot serialize. Uses standard JSON behavior for nested undefined values, dates, and `toJSON` methods.
- `http.created(data, options?)`: JSON with status 201. Set a Location header explicitly when applicable.
- `http.noContent(options?)`: 204, empty body, without content-type/content-length/transfer-encoding headers.
- `http.parseJson(event, { required = true }?)` (also a standalone export): returns `unknown`. Missing/empty optional bodies yield `undefined`. Whitespace-only bodies are invalid JSON. Valid JSON primitives and arrays are accepted; validate them separately.
- `http.handle(fn)`: passes event and Lambda context to your synchronous or async handler. Requires an explicit HTTP response. Catches handler and serialization exceptions. It does not route, authenticate, or validate business data.
- `new HttpError(statusCode, { message, code?, fields? })`: explicitly public error; accepts integer statuses 400–599. All supplied details must be safe for clients, including 5xx messages. Ordinary errors—even objects with `statusCode`—become generic 500 responses.

Response options are `{ headers?: Record<string, string>, cookies?: string[] }`. Each cookie is a complete Set-Cookie value. v1 puts cookies in `multiValueHeaders['Set-Cookie']`; v2 uses `cookies`. Use this option instead of Set-Cookie headers. Header names are normalized to lowercase and per-response values override configured defaults. Responses are independent objects.

No CORS headers are added automatically. Configure CORS in your infrastructure or supply your own response headers. Do not configure contradictory policies in both places. No automatic HEAD handling, binary responses, redirects, ALB adaptation, response streaming, or callback-style handlers are included in v0.1.

## Error contract

Default public error body:

```json
{"error":"Check the highlighted fields","code":"VALIDATION_FAILED","errors":[{"field":"name","message":"name must be a string"}]}
```

`code` and `errors` are omitted when absent. Unexpected exceptions produce:

```json
{"error":"Internal server error","code":"INTERNAL_ERROR"}
```

`onError(error, { requestId? })` receives unexpected exceptions; it does not receive normal public errors. An exception or rejected promise from the callback is contained. Callbacks must finish promptly: this package does not enforce a logging deadline. Logs remain application-owned and may contain sensitive error details.

`formatError(error)` customizes the body for legacy clients. It sees either a public `HttpError` or a sanitized internal error. Formatter exceptions or serialization failures fall back to the generic 500 body and are reported to `onError`.

JSON parsing errors have status 400 with codes `BODY_REQUIRED`, `INVALID_BASE64`, `INVALID_UTF8`, or `INVALID_JSON`. Base64 input must use canonical RFC 4648 encoding with required padding and no whitespace; decoded bytes must be valid UTF-8. This is intentionally stricter than `Buffer.from`. No independent body-size limit is enforced.

## Existing APIs

Keep application-specific authentication and conflict mapping in your application. Example legacy validation envelope:

```ts
const http = createHttp({
  payloadVersion: '1.0',
  formatError(error) {
    return {
      error: error.message,
      ...(error.code === undefined ? {} : { code: error.code }),
      ...(error.fields === undefined ? {} : {
        message: error.message,
        errors: error.fields,
      }),
    };
  },
});
```

Use `http.json(data)` to preserve an endpoint's existing 200 status instead of automatically switching to `created()`. Construct known domain conflicts with `http.json(body, 409)`. Do not expose arbitrary exception messages when translating domain errors.

## Choosing a tool

Use this package when you want response helpers and optional exception handling inside your current Lambda structure. [Middy](https://middy.js.org/) provides a middleware ecosystem; [AWS Powertools](https://docs.aws.amazon.com/powertools/typescript/latest/features/event-handler/http/) provides a broader router and validation toolkit. This package is not a replacement for those frameworks.

## Development

```sh
npm ci
npm run check
```

Checks cover source/consumer types, unit behavior, legacy response fixtures, and real ESM/CommonJS imports from an extracted npm tarball. The tarball has no runtime dependencies. Integration fixtures are not deployed endpoint tests. See [the roadmap](docs/roadmap.md) for adoption and release gates.

MIT © 2026 TaalTree Labs
