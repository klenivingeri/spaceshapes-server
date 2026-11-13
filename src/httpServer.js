import { createServer } from 'node:http';
import { authenticateGoogleToken, GoogleAuthError } from './googleAuth.js';
import { authorizeIdentity } from './identityAuth.js';
import { MAX_INVENTORY_CHARS, MemoryInventoryStore, adoptInventory, creditInventory, readInventory, replaceInventory } from './inventory.js';
import { MarketBoard, MarketError } from './market.js';
import { RankingBoard, RankingError } from './ranking.js';
import { RunError, RunLedger } from './runs.js';
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

async function creditListing(inventory, id, listing) {
  await creditInventory(inventory, id, [listing]);
  return listing;
}

// Mercado global. Leituras: GET /market/version → `{ version }` (sem banco; muda a cada alteração do mercado); GET /market →
// `{ version, listings }` (os anúncios, iguais para todos: sem identidade); GET /market/pending?id=<identidade> → `{ pending }` (o saldo
// a coletar, só do dono). O cliente só lê o que não é barato quando a versão mudou. Escrita: POST
// /market/{list,cancel,buy,claim} com `{ id, ... }`. Todo pedido prova a identidade (ver identityAuth.js).
// Comprar e cancelar devolvem o item ao inventário: o servidor credita o anúncio (inventory.js, creditInventory) e o cliente aplica.
function handleMarket(req, res, { market, inventory }, url) {
  return handleApi(req, res, 'mercado', async () => {
    if (url.pathname === '/market/version' && req.method === 'GET') return { version: market.version() };
    if (url.pathname === '/market' && req.method === 'GET') {
      // A versão é lida antes dos dados: se algo mudar no meio, o cliente fica com um número velho e busca de novo (nunca perde mudança).
      const version = market.version();
      return { version, listings: await market.listings() };
    }
    if (url.pathname === '/market/pending' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      authorizeIdentity(req, id);
      return { pending: await market.pending(id) };
    }
    if (req.method !== 'POST') throw new MarketError('Método não permitido.', 405);
    const body = await readJsonBody(req);
    authorizeIdentity(req, body.id);
    if (url.pathname === '/market/list') return { listing: await market.create(body.id, body.name, body) };
    if (url.pathname === '/market/cancel') return { listing: await creditListing(inventory, body.id, await market.cancel(body.id, body.listingId)) };
    if (url.pathname === '/market/buy') return { listing: await creditListing(inventory, body.id, await market.buy(body.id, body.listingId)) };
    if (url.pathname === '/market/claim') return { earned: await market.claim(body.id) };
    throw new MarketError('Rota não encontrada.', 404);
  });
}

// Inventário do jogador. Leitura: GET /inventory?id=<identidade> → `{ items, credits }` (items é null se a identidade ainda não salvou
// nada; credits são os itens que o servidor concedeu e o cliente ainda não aplicou). Escrita: POST /inventory `{ id, items }` troca o
// inventário inteiro, mas o servidor recusa (422) o que surgiu sem origem ou sem gasto (ver inventoryRules.js). POST /inventory/adopt
// `{ id: conta, from: visitante }` leva o inventário do visitante para a conta que ainda não tem um.
function handleInventory(req, res, inventory, url) {
  return handleApi(req, res, 'inventário', async () => {
    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      authorizeIdentity(req, id);
      return readInventory(inventory, id);
    }
    if (req.method !== 'POST') throw new MarketError('Método não permitido.', 405);
    const body = await readJsonBody(req, MAX_INVENTORY_CHARS + 1_000);
    authorizeIdentity(req, body.id);
    if (url.pathname === '/inventory/adopt') {
      // `from` é o visitante do aparelho (o uuid longo é o segredo dele) e `id` a conta que o recebe, que prova a sessão.
      authorizeIdentity(req, body.from);
      await adoptInventory(inventory, body.from, body.id);
      return { ok: true };
    }
    await replaceInventory(inventory, body.id, body.items);
    return { ok: true };
  });
}

// Runs e drops (o servidor sorteia, o jogador deposita na base). Escrita: POST /run/start `{ id, mapId }` → `{ runId }`; POST /run/drop
// `{ id, runId, source, skin?, focus? }` → `{ items }` (pendentes); POST /run/deposit `{ id, runId, itemIds }` → `{ items }` (os que valeram).
function handleRuns(req, res, { runs, inventory }) {
  return handleApi(req, res, 'run', async () => {
    if (req.method !== 'POST') throw new RunError('Método não permitido.', 405);
    const body = await readJsonBody(req);
    authorizeIdentity(req, body.id);
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/run/start') return runs.start(body.id, body.mapId);
    if (path === '/run/drop') return runs.drop(body.id, body.runId, body);
    if (path === '/run/deposit') {
      const deposited = await runs.deposit(body.id, body.runId, body.itemIds);
      await creditInventory(inventory, body.id, deposited.items);
      return deposited;
    }
    throw new RunError('Rota não encontrada.', 404);
  });
}

// Ranking de poder. GET /ranking → `{ top, generatedAt, nextRefreshAt }` (os 10 primeiros, iguais para todos, sem identidade);
// GET /ranking/me?id= → `{ you }` (a posição do jogador no mesmo retrato); POST /ranking/score `{ id, name, power }` informa o poder.
function handleRanking(req, res, ranking, url) {
  return handleApi(req, res, 'ranking', async () => {
    if (url.pathname === '/ranking' && req.method === 'GET') return ranking.top();
    if (url.pathname === '/ranking/me' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      authorizeIdentity(req, id);
      return ranking.position(id);
    }
    if (url.pathname === '/ranking/score' && req.method === 'POST') {
      const body = await readJsonBody(req);
      authorizeIdentity(req, body.id);
      await ranking.submit(body.id, body.name, body.power);
      return { ok: true };
    }
    throw new RankingError('Rota não encontrada.', 404);
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
  runs = new RunLedger(),
  ranking = new RankingBoard(),
} = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/market' || url.pathname.startsWith('/market/')) {
      await handleMarket(req, res, { market, inventory }, url);
      return;
    }
    if (url.pathname === '/ranking' || url.pathname.startsWith('/ranking/')) {
      await handleRanking(req, res, ranking, url);
      return;
    }
    if (url.pathname.startsWith('/run/')) {
      await handleRuns(req, res, { runs, inventory });
      return;
    }
    if (url.pathname === '/inventory' || url.pathname === '/inventory/adopt') {
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
