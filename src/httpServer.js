import { createServer } from 'node:http';
import { authenticateGoogleToken, GoogleAuthError } from './googleAuth.js';
import { authorizeIdentity } from './identityAuth.js';
import { MAX_INVENTORY_CHARS, MemoryInventoryStore, sanitizeInventory } from './inventory.js';
import { MarketBoard, MarketError } from './market.js';
import { createSession } from './session.js';

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(req, res) {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('vary', 'Origin');
}

async function readJsonBody(req, limit = 12_000) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new GoogleAuthError('Envie os dados em JSON.', 415);
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new GoogleAuthError('Requisição muito grande.', 413);
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new GoogleAuthError('Dados inválidos.', 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new GoogleAuthError('Dados inválidos.', 400);
  }
  return payload;
}

// Moldura das rotas de dados do jogador (mercado e inventário): CORS, resposta de erro uniforme e falha inesperada só no log.
async function handleApi(req, res, label, handler) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    sendJson(res, 200, await handler());
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode === 500) console.error(`[quadrix-server] falha em ${label}:`, error);
    sendJson(res, statusCode, { error: statusCode === 500 ? `Erro em ${label}.` : error.message });
  }
}

// Mercado global. Leitura: GET /market?id=<identidade> (anúncios de todos + saldo a coletar da identidade). Escrita: POST
// /market/{list,cancel,buy,claim} com `{ id, ... }`. Todo pedido prova a identidade (ver identityAuth.js).
function handleMarket(req, res, market, url) {
  return handleApi(req, res, 'mercado', async () => {
    if (url.pathname === '/market' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      authorizeIdentity(req, id);
      return { listings: await market.listings(), pending: await market.pending(id) };
    }
    if (req.method !== 'POST') throw new MarketError('Método não permitido.', 405);
    const body = await readJsonBody(req);
    authorizeIdentity(req, body.id);
    if (url.pathname === '/market/list') return { listing: await market.create(body.id, body.name, body) };
    if (url.pathname === '/market/cancel') return { listing: await market.cancel(body.id, body.listingId) };
    if (url.pathname === '/market/buy') return { listing: await market.buy(body.id, body.listingId) };
    if (url.pathname === '/market/claim') return { earned: await market.claim(body.id) };
    throw new MarketError('Rota não encontrada.', 404);
  });
}

// Inventário do jogador. Leitura: GET /inventory?id=<identidade> → `{ items }` (null se a identidade ainda não salvou nada).
// Escrita: POST /inventory `{ id, items }` substitui o inventário inteiro.
function handleInventory(req, res, inventory, url) {
  return handleApi(req, res, 'inventário', async () => {
    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      authorizeIdentity(req, id);
      return { items: await inventory.get(id) };
    }
    if (req.method !== 'POST') throw new MarketError('Método não permitido.', 405);
    const body = await readJsonBody(req, MAX_INVENTORY_CHARS + 1_000);
    authorizeIdentity(req, body.id);
    await inventory.put(body.id, sanitizeInventory(body.items));
    return { ok: true };
  });
}

async function handleGoogleAuth(req, res, authenticateGoogle) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Método não permitido.' });
    return;
  }
  try {
    const { idToken } = await readJsonBody(req);
    const user = await authenticateGoogle(idToken);
    sendJson(res, 200, { user, session: createSession(user.email) });
  } catch (error) {
    const statusCode = error instanceof GoogleAuthError ? error.statusCode : 500;
    if (statusCode === 500) console.error('[quadrix-server] falha ao validar login Google:', error);
    sendJson(res, statusCode, {
      error: statusCode === 500 ? 'Não foi possível entrar com o Google.' : error.message,
    });
  }
}

export function createHttpServer({
  authenticateGoogle = authenticateGoogleToken,
  market = new MarketBoard(),
  inventory = new MemoryInventoryStore(),
} = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/market' || url.pathname.startsWith('/market/')) {
      await handleMarket(req, res, market, url);
      return;
    }
    if (url.pathname === '/inventory') {
      await handleInventory(req, res, inventory, url);
      return;
    }
    if (req.url === '/auth/google') {
      await handleGoogleAuth(req, res, authenticateGoogle);
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end();
  });
}
