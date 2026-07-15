import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';

test('GET /healthz returns 200 and ok status', async () => {
  const app = createApp();
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(typeof res.body.uptime, 'number');
});

test('unknown route returns a 404 error payload', async () => {
  const app = createApp();
  const res = await request(app).get('/does-not-exist');
  assert.equal(res.status, 404);
  assert.match(res.body.error.message, /Route not found/);
});
