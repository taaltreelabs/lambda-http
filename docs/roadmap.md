# Initial scope and release gates

## Implemented in this repository

- Buffered JSON builders and explicit v1/v2 cookie adapters.
- Strict JSON/base64 parsing with stable public error codes.
- Explicit public errors, optional handler wrapper, configurable error formatting, and logging callback isolation.
- Zero runtime dependencies; ESM/CommonJS builds and declarations.
- Unit tests, AWS handler type compatibility, representative legacy API fixtures, and packed import checks.

## Before npm publication

1. Review the API and default error envelope.
2. Open a separate migration change in taaltreelabs/apis for content upload URL creation and TBLT lesson creation. Keep domain auth/error mapping local. Preserve success statuses, conflict details, headers, and validation shapes.
3. Add endpoint-level regression cases before migrating; explicitly document malformed JSON changing from 500 to 400 where appropriate.
4. Run the actual API repo's targeted tests and normal required checks. The compatibility fixtures in this repo do not replace these checks.
5. Verify v1/v2 adapters against deployed AWS endpoints, particularly repeated cookies and configured CORS. No AWS resources are created by this package's CI.
6. Configure npm trusted publishing for this repository, then publish an explicitly approved release with provenance. No automatic publishing is configured yet.

## Deferred

Routing, auth, subscription policies, SDK clients, schema validation engines, SSE, binary bodies, ALB, automatic HEAD handling, and a general middleware ecosystem.

## Behavioral commitments

Missing required body: 400. Malformed JSON/base64/UTF-8: 400. Parsed values remain unknown until the caller validates them. Only explicit HttpError details are public. Unknown exceptions and JSON serialization failures become generic 500s. Broken logging cannot replace a response. Bodyless 204 responses omit content headers. Cookies retain separate values in each integration's representation.
