// Sessão do jogador com conta Google: depois de validar o token do Google (googleAuth.js) o servidor entrega este token próprio,
// assinado (HMAC-SHA256) com `SESSION_SECRET`, que o jogo manda em cada pedido que mexe no inventário ou no mercado. Guarda só o
// e-mail e a validade, e dura bem mais que o token do Google (1 h), para o jogador não precisar entrar de novo a cada sessão.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let fallbackSecret = null;

// Sem SESSION_SECRET no ambiente (dev, testes) vale um segredo sorteado por processo: as sessões morrem ao reiniciar o servidor.
export function sessionSecret() {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) return configured;
  fallbackSecret ??= randomBytes(32).toString('hex');
  return fallbackSecret;
}

const sign = (payload, secret) => createHmac('sha256', secret).update(payload).digest('base64url');

export function createSession(email, { secret = sessionSecret(), now = Date.now() } = {}) {
  const payload = Buffer.from(JSON.stringify({ e: email.trim().toLowerCase(), x: now + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

// O e-mail da sessão, ou null se o token é inválido, adulterado ou venceu.
export function verifySession(token, { secret = sessionSecret(), now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof e === 'string' && Number.isFinite(x) && x > now ? e : null;
  } catch {
    return null;
  }
}
