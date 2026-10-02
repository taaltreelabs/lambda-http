import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttp, HttpError, parseJson } from '../dist/esm/index.js';

for (const payloadVersion of ['1.0', '2.0']) {
  const http = createHttp({ payloadVersion });
  test(`${payloadVersion}: JSON, created, and bodyless responses`, () => {
    const response = http.json({ hello: '世界' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { hello: '世界' });
    assert.equal(response.isBase64Encoded, false);
    assert.equal(http.created(null).statusCode, 201);
    const empty = http.noContent({ headers: { 'Content-Type': 'text/plain', 'Content-Length': '3' } });
    assert.equal(empty.body, '');
    assert.equal(empty.statusCode, 204);
    assert.equal(empty.headers['content-type'], undefined);
    assert.equal(empty.headers['content-length'], undefined);
  });
  test(`${payloadVersion}: cookies remain separate, including Expires commas`, () => {
    const cookies = ['a=1; Expires=Wed, 21 Oct 2030 07:28:00 GMT', 'b=2; HttpOnly'];
    const response = http.json({}, 200, { cookies });
    assert.deepEqual(payloadVersion === '1.0' ? response.multiValueHeaders['Set-Cookie'] : response.cookies, cookies);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(payloadVersion === '1.0' ? response.cookies : response.multiValueHeaders, undefined);
  });
}

test('merges headers case-insensitively and isolates returned objects', () => {
  const headers = { 'X-Example': 'default' };
  const http = createHttp({ payloadVersion: '1.0', headers });
  headers['X-Example'] = 'mutated';
  const a = http.json({}, 200, { headers: { 'x-example': 'override' } });
  assert.equal(a.headers['x-example'], 'override');
  assert.equal(Object.keys(a.headers).filter(k => k.toLowerCase() === 'x-example').length, 1);
  a.headers['x-example'] = 'changed';
  assert.equal(http.json({}).headers['x-example'], 'default');
  assert.equal(http.json({}).headers['access-control-allow-origin'], undefined);
});

test('rejects invalid headers and ambiguous Set-Cookie headers', () => {
  assert.throws(() => createHttp({ payloadVersion: '1.0', headers: { a: 'x\r\ny' } }));
  const http = createHttp({ payloadVersion: '2.0' });
  assert.throws(() => http.json({}, 200, { headers: { 'Set-Cookie': 'a=1' } }));
  assert.throws(() => http.json({}, 200, { cookies: ['a=1\nInjected: true'] }));
});

test('preserves valid JSON primitives and structures', () => {
  for (const value of [null, false, 0, 'hello', [], { a: 1 }]) {
    assert.deepEqual(parseJson({ body: JSON.stringify(value) }), value);
  }
});

test('required versus optional bodies', () => {
  for (const body of [undefined, null, '']) {
    assert.throws(() => parseJson({ body }), { statusCode: 400, code: 'BODY_REQUIRED' });
    assert.equal(parseJson({ body }, { required: false }), undefined);
  }
  assert.throws(() => parseJson({ body: '   ' }, { required: false }), { code: 'INVALID_JSON' });
});

test('malformed JSON has a stable public error', () => {
  assert.throws(() => parseJson({ body: '{oops' }), { statusCode: 400, code: 'INVALID_JSON' });
});

test('strict base64 and UTF-8 decoding', () => {
  const body = JSON.stringify({ hello: 'こんにちは 👋' });
  assert.deepEqual(parseJson({ body: Buffer.from(body).toString('base64'), isBase64Encoded: true }), JSON.parse(body));
  for (const invalid of ['!!!', 'e30', 'e30=\n', 'e31=', '====']) {
    assert.throws(() => parseJson({ body: invalid, isBase64Encoded: true }), { code: 'INVALID_BASE64' });
  }
  assert.throws(() => parseJson({ body: Buffer.from([0xff]).toString('base64'), isBase64Encoded: true }), { code: 'INVALID_UTF8' });
});

test('errors require valid status codes', () => {
  for (const code of [200, 399, 600, 400.5, NaN]) assert.throws(() => new HttpError(code, { message: 'x' }), RangeError);
});

test('forwards events and context to synchronous and asynchronous handlers', async () => {
  const http = createHttp({ payloadVersion: '1.0' });
  const event = { body: '{}' }, context = { awsRequestId: 'request' };
  const response = await http.handle((e, c) => {
    assert.equal(e, event); assert.equal(c, context); return http.json({ ok: true });
  })(event, context);
  assert.equal(response.statusCode, 200);
  assert.equal((await http.handle(async () => http.noContent())(event, context)).statusCode, 204);
});

test('public errors expose only declared fields', async () => {
  const http = createHttp({ payloadVersion: '1.0' });
  const err = new HttpError(422, { message: 'Invalid input', code: 'INVALID', fields: [{ field: 'items[0].name', message: 'Required' }] });
  err.privateDetail = 'secret';
  const response = await http.handle(() => { throw err; })({}, {});
  assert.equal(response.statusCode, 422);
  assert.deepEqual(JSON.parse(response.body), { error: 'Invalid input', code: 'INVALID', errors: [{ field: 'items[0].name', message: 'Required' }] });
});

test('unknown exceptions and statusCode-shaped objects stay private', async () => {
  for (const err of [new Error('secret database hostname'), { statusCode: 400, message: 'secret' }, 'secret', null]) {
    const seen = [];
    const http = createHttp({ payloadVersion: '2.0', onError: (e, c) => seen.push([e, c]) });
    const response = await http.handle(() => { throw err; })({ requestContext: { requestId: 'r1' } }, {});
    assert.equal(response.statusCode, 500);
    assert.deepEqual(JSON.parse(response.body), { error: 'Internal server error', code: 'INTERNAL_ERROR' });
    assert.deepEqual(seen, [[err, { requestId: 'r1' }]]);
  }
});

test('logging failure cannot break error handling', async () => {
  const http = createHttp({ payloadVersion: '1.0', onError: async () => { throw new Error('logger failed'); } });
  assert.equal((await http.handle(() => { throw new Error('original'); })({}, {})).statusCode, 500);
});

test('formatter sees sanitized unexpected errors and safely falls back if broken', async () => {
  let seen;
  const http = createHttp({ payloadVersion: '1.0', headers: { 'X-App': 'test' }, formatError: error => { seen = error; return 1n; } });
  const response = await http.handle(() => { throw new Error('secret'); })({}, {});
  assert.equal(seen.message, 'Internal server error');
  assert.equal(response.statusCode, 500);
  assert.equal(response.headers['x-app'], 'test');
  assert.equal(JSON.parse(response.body).code, 'INTERNAL_ERROR');
});

test('serialization failures and missing handler returns become generic 500s', async () => {
  const http = createHttp({ payloadVersion: '1.0' });
  const circular = {}; circular.self = circular;
  for (const value of [undefined, () => {}, Symbol('x'), 1n, circular]) {
    const response = await http.handle(() => http.json(value))({}, {});
    assert.equal(response.statusCode, 500);
    assert.equal(JSON.parse(response.body).code, 'INTERNAL_ERROR');
  }
  assert.equal((await http.handle(() => undefined)({}, {})).statusCode, 500);
});

test('rejects invalid JSON status codes and bodyless status misuse', () => {
  const http = createHttp({ payloadVersion: '1.0' });
  for (const status of [100, 199, 600, NaN, 200.5, 204, 205, 304]) assert.throws(() => http.json({}, status));
});

test('configured JSON content type is honored and response headers can override it', () => {
  const http = createHttp({ payloadVersion: '1.0', headers: { 'Content-Type': 'application/problem+json' } });
  assert.equal(http.json({}).headers['content-type'], 'application/problem+json');
  assert.equal(http.json({}, 200, { headers: { 'CONTENT-TYPE': 'application/json' } }).headers['content-type'], 'application/json');
});

test('throwing custom formatters fall back to safe 500s', async () => {
  const http = createHttp({ payloadVersion: '2.0', formatError() { throw new Error('formatter details'); } });
  const result = await http.handle(() => { throw new HttpError(400, { message: 'Bad input' }); })({}, {});
  assert.equal(result.statusCode, 500);
  assert.equal(JSON.parse(result.body).error, 'Internal server error');
});
