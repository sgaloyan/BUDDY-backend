import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app.js';
import { RefreshToken } from '../../src/models/refresh-token.model.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';

// Acceptance criteria — auth.spec.md §7 "Login — POST /auth/login"

const app = createApp();
const CREDS = { email: 'user@example.com', password: 's3cretpass' };

before(startTestDb);
after(stopTestDb);
beforeEach(async () => {
  await clearDb();
  await request(app).post('/auth/signup').send(CREDS);
});

test('correct email + password -> 200 with accessToken and refreshToken', async () => {
  const res = await request(app).post('/auth/login').send(CREDS);
  assert.equal(res.status, 200);
  assert.ok(res.body.accessToken);
  assert.ok(res.body.refreshToken);
});

test('access token is a JWT with { userId, email } expiring in ~15 min', async () => {
  const res = await request(app).post('/auth/login').send(CREDS);
  const decoded = jwt.verify(res.body.accessToken, process.env.JWT_SECRET);
  assert.ok(decoded.userId);
  assert.equal(decoded.email, 'user@example.com');
  assert.equal(decoded.exp - decoded.iat, 15 * 60);
});

test('a RefreshToken doc is created: revoked=false, expires ~7d, tokenHash is bcrypt', async () => {
  const res = await request(app).post('/auth/login').send(CREDS);
  const [tokenId, secret] = res.body.refreshToken.split('.');

  const record = await RefreshToken.findOne({ tokenId });
  assert.ok(record);
  assert.equal(record.revoked, false);

  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(record.expiresAt.getTime() - (Date.now() + sevenDays)) < 60 * 1000);

  assert.notEqual(record.tokenHash, secret);
  assert.equal(await bcrypt.compare(secret, record.tokenHash), true);
});

test('valid email + wrong password -> 401 generic error', async () => {
  const res = await request(app)
    .post('/auth/login')
    .send({ email: CREDS.email, password: 'wrongpass1' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.message, 'Invalid email or password');
});

test('unknown email -> 401 with identical body/status as wrong password', async () => {
  const res = await request(app)
    .post('/auth/login')
    .send({ email: 'nobody@example.com', password: 's3cretpass' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.message, 'Invalid email or password');
});

test('login email matching is case-insensitive', async () => {
  const res = await request(app)
    .post('/auth/login')
    .send({ email: 'USER@example.COM', password: 's3cretpass' });
  assert.equal(res.status, 200);
  assert.ok(res.body.accessToken);
});

test('missing email or password -> 400', async () => {
  const noEmail = await request(app).post('/auth/login').send({ password: 's3cretpass' });
  assert.equal(noEmail.status, 400);

  const noPassword = await request(app).post('/auth/login').send({ email: CREDS.email });
  assert.equal(noPassword.status, 400);
});
