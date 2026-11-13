import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpServer } from '../src/httpServer.js';
import { authorizeIdentity } from '../src/identityAuth.js';
import { sanitizeInventory } from '../src/inventory.js';
import { createSession, verifySession } from '../src/session.js';

const SECRET = 'segredo-de-teste';
const GUEST = 'local:0123456789abcdef0123';
const OTHER_GUEST = 'local:fedcba9876543210fedc';
const user = { id: '1', email: 'Ana@Example.com', name: 'Ana', picture: null };

async function withServer(run) {
  const server = createHttpServer({ authenticateGoogle: async () => user });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const call = async (path, { method = 'GET', body, token } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, json: await response.json() };
  };
  try {
    await run(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('sessão: assina, expira e recusa adulteração', () => {
  const token = createSession('Ana@Example.com', { secret: SECRET, now: 1000 });
  assert.equal(verifySession(token, { secret: SECRET, now: 2000 }), 'ana@example.com');
  assert.equal(verifySession(token, { secret: 'outro', now: 2000 }), null);
  assert.equal(verifySession(token, { secret: SECRET, now: 1000 + 31 * 24 * 3600 * 1000 }), null);
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'vitima@example.com', x: 9e15 })).toString('base64url');
  assert.equal(verifySession(`${forged}.${signature}`, { secret: SECRET }), null);
  assert.equal(verifySession(payload, { secret: SECRET }), null);
  assert.equal(verifySession(undefined, { secret: SECRET }), null);
});

test('autorização: visitante com uuid longo; conta só com a sessão dela', () => {
  const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
  const options = { secret: SECRET };
  authorizeIdentity(req(), GUEST, options);
  assert.throws(() => authorizeIdentity(req(), 'local:aaa', options), /visitante inválida/);
  assert.throws(() => authorizeIdentity(req(), 'qualquer', options), /Identidade inválida/);
  const token = createSession('ana@example.com', { secret: SECRET });
  authorizeIdentity(req(token), 'account:ana@example.com', options);
  assert.throws(() => authorizeIdentity(req(), 'account:ana@example.com', options), /Sessão inválida/);
  assert.throws(() => authorizeIdentity(req(token), 'account:outra@example.com', options), /não é desta conta/);
});

test('inventário: só campos conhecidos, do tipo certo e de tamanho razoável', () => {
  const ok = { partItems: { 'a|b': 2 }, monsters: {}, fragmentSlots: [null], ownedShips: { x: true } };
  assert.deepEqual(sanitizeInventory(ok), ok);
  assert.throws(() => sanitizeInventory({ ...ok, coins: 5 }), /desconhecido/);
  assert.throws(() => sanitizeInventory({ ...ok, partItems: [] }), /inválido/);
  assert.throws(() => sanitizeInventory({ partItems: {} }), /inválido/);
  assert.throws(() => sanitizeInventory({ ...ok, monsters: { x: 'y'.repeat(300_000) } }), /grande demais/);
  assert.throws(() => sanitizeInventory(null), /inválido/);
});

test('HTTP: login devolve sessão e o inventário vai e volta por identidade', async () => {
  await withServer(async (call) => {
    const login = await call('/auth/google', { method: 'POST', body: { idToken: 'x' } });
    assert.equal(login.status, 200);
    const token = login.json.session;
    const account = 'account:ana@example.com';
    const items = { partItems: {}, monsters: {}, fragmentSlots: [null, null, null, null], ownedShips: { 'falcao-vermelho': true } };

    assert.equal((await call(`/inventory?id=${account}`)).status, 401);
    assert.equal((await call(`/inventory?id=${account}`, { token })).json.items, null);
    assert.equal((await call('/inventory', { method: 'POST', token, body: { id: account, items } })).status, 200);
    const loaded = (await call(`/inventory?id=${account}`, { token })).json;
    assert.deepEqual(loaded.items, items);
    assert.deepEqual(loaded.credits, { partItems: {}, monsters: {} });

    assert.equal((await call(`/inventory?id=account:outra@example.com`, { token })).status, 403);
    assert.equal((await call('/inventory', { method: 'POST', token, body: { id: account, items: { coins: 1 } } })).status, 400);
  });
});

test('HTTP: visitantes têm inventários separados e o mercado exige identidade válida', async () => {
  await withServer(async (call) => {
    const blank = { partItems: {}, monsters: {}, fragmentSlots: [null, null, null, null], ownedShips: { 'falcao-vermelho': true } };
    await call('/inventory', { method: 'POST', body: { id: GUEST, items: blank } });
    assert.deepEqual((await call(`/inventory?id=${GUEST}`)).json.items, blank);
    assert.equal((await call(`/inventory?id=${OTHER_GUEST}`)).json.items, null);

    assert.equal((await call('/market/pending?id=local:aaa')).status, 400);
    const listed = await call('/market/list', { method: 'POST', body: { id: GUEST, name: 'Ana', kind: 'sample', key: 'x|common|1', coins: 5, ore: 0 } });
    assert.equal(listed.status, 200);
    const board = await call('/market');
    assert.equal(board.json.listings.length, 1);
    // A versão barata acompanha a lista completa e muda quando o mercado muda.
    assert.equal((await call('/market/version')).json.version, board.json.version);
    assert.equal((await call('/market/buy', { method: 'POST', body: { id: OTHER_GUEST, listingId: listed.json.listing.id } })).status, 200);
    assert.notEqual((await call('/market/version')).json.version, board.json.version);
    assert.deepEqual((await call(`/market/pending?id=${GUEST}`)).json.pending, { coins: 5, ore: 0 });
  });
});

test('rotas de run: exigem a identidade e só entregam o que o servidor sorteou', async () => {
  await withServer(async (call) => {
    assert.equal((await call('/run/start', { method: 'POST', body: { id: 'local:curto', mapId: 'pampa' } })).status, 400);
    const started = await call('/run/start', { method: 'POST', body: { id: GUEST, mapId: 'pampa' } });
    assert.equal(started.status, 200);
    const { runId } = started.json;
    assert.equal((await call('/run/drop', { method: 'POST', body: { id: OTHER_GUEST, runId, source: 'block' } })).status, 404);
    const forged = await call('/run/deposit', { method: 'POST', body: { id: GUEST, runId, itemIds: ['inventado'] } });
    assert.deepEqual(forged.json.items, []);
    assert.equal((await call('/run/start')).status, 405);
  });
});
