import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateGoogleToken, GoogleAuthError } from '../src/googleAuth.js';
import { createHttpServer } from '../src/httpServer.js';
import { verifySession } from '../src/session.js';

test('requires a configured web OAuth client ID', async () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    await assert.rejects(authenticateGoogleToken('valid-token'), (error) => {
      assert.ok(error instanceof GoogleAuthError);
      assert.equal(error.statusCode, 503);
      return true;
    });
  } finally {
    if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousClientId;
  }
});

test('rejects empty and oversized Google tokens', async () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'web-client-id';
  try {
    await assert.rejects(authenticateGoogleToken(''), { statusCode: 400 });
    await assert.rejects(authenticateGoogleToken('x'.repeat(8193)), { statusCode: 400 });
  } finally {
    if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousClientId;
  }
});

test('verifies tokens against the configured audience and requires a verified email', async () => {
  let verifiedAudience;
  const profile = await authenticateGoogleToken('verified-token', {
    clientId: 'web-client-id',
    verifyIdToken: async ({ idToken, audience }) => {
      assert.equal(idToken, 'verified-token');
      verifiedAudience = audience;
      return {
        getPayload: () => ({
          sub: 'google-subject',
          email: 'pilot@example.com',
          email_verified: true,
          name: 'Pilot',
          picture: 'https://example.com/avatar.png',
        }),
      };
    },
  });
  assert.equal(verifiedAudience, 'web-client-id');
  assert.deepEqual(profile, {
    id: 'google-subject',
    email: 'pilot@example.com',
    name: 'Pilot',
    picture: 'https://example.com/avatar.png',
  });

  await assert.rejects(authenticateGoogleToken('unverified-token', {
    clientId: 'web-client-id',
    verifyIdToken: async () => ({ getPayload: () => ({ sub: 'user', email: 'pilot@example.com', email_verified: false }) }),
  }), { statusCode: 401 });
});

test('POST /auth/google validates the token and returns the verified profile', async (context) => {
  const server = createHttpServer({
    authenticateGoogle: async (idToken) => {
      assert.equal(idToken, 'verified-token');
      return { id: 'google-subject', email: 'pilot@example.com', name: 'Pilot', picture: null };
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://spaceshapes.example' },
    body: JSON.stringify({ idToken: 'verified-token' }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://spaceshapes.example');
  const { user, session } = await response.json();
  assert.deepEqual(user, { id: 'google-subject', email: 'pilot@example.com', name: 'Pilot', picture: null });
  assert.equal(verifySession(session), 'pilot@example.com');
});

test('POST /auth/google rejects malformed request bodies', async (context) => {
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /inválidos/);

  const nullResponse = await fetch(`http://127.0.0.1:${port}/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'null',
  });
  assert.equal(nullResponse.status, 400);
});
