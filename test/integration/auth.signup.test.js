import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/user.model.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';

// Acceptance criteria — auth.spec.md §7 "Signup — POST /auth/signup"

const app = createApp();

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

test('valid email + password -> 201 with { id, email } and no tokens', async () => {
  const res = await request(app)
    .post('/auth/signup')
    .send({ email: 'user@example.com', password: 's3cretpass' });

  assert.equal(res.status, 201);
  assert.equal(res.body.email, 'user@example.com');
  assert.ok(res.body.id);
  assert.equal(res.body.accessToken, undefined);
  assert.equal(res.body.refreshToken, undefined);
});

test('password is stored hashed (bcrypt), never plaintext', async () => {
  await request(app)
    .post('/auth/signup')
    .send({ email: 'hash@example.com', password: 's3cretpass' });

  const user = await User.findOne({ email: 'hash@example.com' });
  assert.ok(user);
  assert.notEqual(user.passwordHash, 's3cretpass');
  assert.equal(await bcrypt.compare('s3cretpass', user.passwordHash), true);
});

test('email is persisted normalized (trim + lowercase)', async () => {
  const res = await request(app)
    .post('/auth/signup')
    .send({ email: '  Foo@X.com  ', password: 's3cretpass' });

  assert.equal(res.status, 201);
  assert.equal(res.body.email, 'foo@x.com');
  const user = await User.findOne({ email: 'foo@x.com' });
  assert.ok(user);
});

test('duplicate email (same after normalization) -> 409', async () => {
  await request(app).post('/auth/signup').send({ email: 'dup@x.com', password: 's3cretpass' });
  const res = await request(app)
    .post('/auth/signup')
    .send({ email: 'DUP@X.com', password: 's3cretpass' });

  assert.equal(res.status, 409);
  assert.equal(res.body.error.message, 'Email already registered');
});

test('password shorter than 8 chars -> 400', async () => {
  const res = await request(app)
    .post('/auth/signup')
    .send({ email: 'short@x.com', password: 'a1b2c3' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.message, 'Validation failed');
});

test('password with letters but no digit -> 400', async () => {
  const res = await request(app)
    .post('/auth/signup')
    .send({ email: 'nodigit@x.com', password: 'abcdefgh' });
  assert.equal(res.status, 400);
});

test('password with digits but no letter -> 400', async () => {
  const res = await request(app)
    .post('/auth/signup')
    .send({ email: 'noletter@x.com', password: '12345678' });
  assert.equal(res.status, 400);
});

test('missing or malformed email -> 400', async () => {
  const missing = await request(app).post('/auth/signup').send({ password: 's3cretpass' });
  assert.equal(missing.status, 400);

  const malformed = await request(app)
    .post('/auth/signup')
    .send({ email: 'not-an-email', password: 's3cretpass' });
  assert.equal(malformed.status, 400);
});

test('password longer than 72 chars -> 400', async () => {
  const res = await request(app)
    .post('/auth/signup')
    // 73 chars, contains a letter and a digit so only the max rule can fail it.
    .send({ email: 'longpw@x.com', password: 'a1' + 'x'.repeat(71) });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.message, 'Validation failed');
});

test('two concurrent signups for the same email -> one 201, one 409, never 500', async () => {
  const creds = { email: 'race@x.com', password: 's3cretpass' };
  const [a, b] = await Promise.all([
    request(app).post('/auth/signup').send(creds),
    request(app).post('/auth/signup').send(creds),
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409]);

  const count = await User.countDocuments({ email: 'race@x.com' });
  assert.equal(count, 1);
});

test('malformed / unparseable JSON body -> 400 (not 500)', async () => {
  const res = await request(app)
    .post('/auth/signup')
    .set('Content-Type', 'application/json')
    .send('{ "email": "x@y.com", '); // truncated JSON

  assert.equal(res.status, 400);
});
