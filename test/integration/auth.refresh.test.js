import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app.js';
import { RefreshToken } from '../../src/models/refresh-token.model.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';

// Acceptance criteria — auth.spec.md §7 "Refresh — POST /auth/refresh"

const app = createApp();
const CREDS = { email: 'user@example.com', password: 's3cretpass' };

let refreshToken;

before(startTestDb);
after(stopTestDb);
beforeEach(async () => {
  await clearDb();
  await request(app).post('/auth/signup').send(CREDS);
  const res = await request(app).post('/auth/login').send(CREDS);
  refreshToken = res.body.refreshToken;
});

test('valid, non-revoked, unexpired token -> 200 with a new access token', async () => {
  const res = await request(app).post('/auth/refresh').send({ refreshToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.accessToken);

  const decoded = jwt.verify(res.body.accessToken, process.env.JWT_SECRET);
  assert.equal(decoded.email, 'user@example.com');
  assert.ok(decoded.exp > Math.floor(Date.now() / 1000));
});

test('refresh token is NOT rotated (reusable while valid)', async () => {
  const first = await request(app).post('/auth/refresh').send({ refreshToken });
  assert.equal(first.status, 200);
  const second = await request(app).post('/auth/refresh').send({ refreshToken });
  assert.equal(second.status, 200);
});

test('revoked token -> 401', async () => {
  const [tokenId] = refreshToken.split('.');
  await RefreshToken.updateOne({ tokenId }, { $set: { revoked: true } });

  const res = await request(app).post('/auth/refresh').send({ refreshToken });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.message, 'Invalid refresh token');
});

test('expired token -> 401', async () => {
  const [tokenId] = refreshToken.split('.');
  await RefreshToken.updateOne({ tokenId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

  const res = await request(app).post('/auth/refresh').send({ refreshToken });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.message, 'Invalid refresh token');
});

test('unknown tokenId -> 401', async () => {
  const [, secret] = refreshToken.split('.');
  const res = await request(app)
    .post('/auth/refresh')
    .send({ refreshToken: `nonexistent.${secret}` });
  assert.equal(res.status, 401);
});

test('correct tokenId but wrong secret -> 401', async () => {
  const [tokenId] = refreshToken.split('.');
  const res = await request(app)
    .post('/auth/refresh')
    .send({ refreshToken: `${tokenId}.wrongsecret` });
  assert.equal(res.status, 401);
});

test('malformed token (no ".") -> 401', async () => {
  const res = await request(app).post('/auth/refresh').send({ refreshToken: 'nodothere' });
  assert.equal(res.status, 401);
});

test('missing refreshToken field -> 400', async () => {
  const res = await request(app).post('/auth/refresh').send({});
  assert.equal(res.status, 400);
});
