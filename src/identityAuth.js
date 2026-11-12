// Quem pode mexer no inventário e no mercado de uma identidade (`account:<email>` ou `local:<uuid>`, ver protocol.isValidIdentityId):
// - conta Google: o pedido traz `Authorization: Bearer <sessão>` (session.js) e o e-mail dela tem que ser o da identidade;
// - visitante: o uuid sorteado no aparelho é o próprio segredo, então tem que ser longo o bastante para ninguém adivinhar.
import { isValidIdentityId } from './protocol.js';
import { verifySession } from './session.js';

const GUEST_ID = /^local:[A-Za-z0-9-]{16,}$/;

export class AuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

export function authorizeIdentity(req, id, options) {
  if (!isValidIdentityId(id)) throw new AuthError('Identidade inválida.', 400);
  if (id.startsWith('local:')) {
    if (!GUEST_ID.test(id)) throw new AuthError('Identidade de visitante inválida.', 400);
    return;
  }
  const header = req.headers.authorization ?? '';
  const email = header.startsWith('Bearer ') ? verifySession(header.slice(7), options) : null;
  if (email === null) throw new AuthError('Sessão inválida ou vencida. Entre com o Google de novo.');
  if (id !== `account:${email}`) throw new AuthError('Essa sessão não é desta conta.', 403);
}
