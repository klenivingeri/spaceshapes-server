import { createServer } from 'node:http';
import { authenticateGoogleToken, GoogleAuthError } from './googleAuth.js';

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(req, res) {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('vary', 'Origin');
}

async function readJsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new GoogleAuthError('Envie os dados de login em JSON.', 415);
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 12_000) throw new GoogleAuthError('Requisição de login muito grande.', 413);
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new GoogleAuthError('Dados de login inválidos.', 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new GoogleAuthError('Dados de login inválidos.', 400);
  }
  return payload;
}

export function createHttpServer({ authenticateGoogle = authenticateGoogleToken } = {}) {
  return createServer(async (req, res) => {
    if (req.url === '/auth/google') {
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
        sendJson(res, 200, { user });
      } catch (error) {
        const statusCode = error instanceof GoogleAuthError ? error.statusCode : 500;
        if (statusCode === 500) console.error('[quadrix-server] falha ao validar login Google:', error);
        sendJson(res, statusCode, {
          error: statusCode === 500 ? 'Não foi possível entrar com o Google.' : error.message,
        });
      }
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
