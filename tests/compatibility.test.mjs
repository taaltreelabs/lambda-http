import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttp, HttpError } from '../dist/esm/index.js';

// Representative wire contracts from the API repo; no business logic imported.
const http = createHttp({
  payloadVersion: '1.0',
  formatError(error) {
    const body = { error: error.message };
    if (error.code !== undefined) body.code = error.code;
    if (error.fields !== undefined) Object.assign(body, { message: error.message, errors: error.fields });
    return body;
  },
});

test('legacy field validation envelope can be preserved', async () => {
  const fields = [{ field: 'meta.language', message: 'meta.language is required' }];
  const result = await http.handle(() => { throw new HttpError(400, { message: 'Validation failed', fields }); })({}, {});
  assert.deepEqual(JSON.parse(result.body), { error: 'Validation failed', message: 'Validation failed', errors: fields });
});

test('domain conflicts stay application-owned', () => {
  const result = http.json({ error: 'Already exists', message: 'Already exists', existingLessonId: 'lesson-1' }, 409);
  assert.equal(result.statusCode, 409);
  assert.equal(JSON.parse(result.body).existingLessonId, 'lesson-1');
});

test('subscription code is independent of auth-message policy', async () => {
  const result = await http.handle(() => { throw new HttpError(403, { message: 'Access denied', code: 'SUBSCRIPTION_EXPIRED' }); })({}, {});
  assert.deepEqual(JSON.parse(result.body), { error: 'Access denied', code: 'SUBSCRIPTION_EXPIRED' });
});

test('existing creation endpoints can keep status 200', () => {
  assert.equal(http.json({ lesson: { id: '1' }, warnings: [] }).statusCode, 200);
});
