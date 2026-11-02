import { OAuth2Client } from 'google-auth-library';

const oauthClient = new OAuth2Client();
const MAX_ID_TOKEN_LENGTH = 8192;

export class GoogleAuthError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'GoogleAuthError';
    this.statusCode = statusCode;
  }
}

export async function authenticateGoogleToken(idToken, {
  clientId = process.env.GOOGLE_CLIENT_ID?.trim(),
  verifyIdToken = (options) => oauthClient.verifyIdToken(options),
} = {}) {
  if (!clientId) throw new GoogleAuthError('Login Google não está configurado no servidor.', 503);
  if (typeof idToken !== 'string' || idToken.length === 0 || idToken.length > MAX_ID_TOKEN_LENGTH) {
    throw new GoogleAuthError('Token Google inválido.', 400);
  }

  let payload;
  try {
    const ticket = await verifyIdToken({ idToken, audience: clientId });
    payload = ticket.getPayload();
  } catch (error) {
    const serviceUnavailable = error?.name === 'GaxiosError' || error?.response || error?.code || error?.cause?.code;
    const message = serviceUnavailable
      ? 'O serviço de autenticação Google está temporariamente indisponível.'
      : 'Não foi possível validar sua conta Google. Tente novamente.';
    throw new GoogleAuthError(message, serviceUnavailable ? 503 : 401);
  }

  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new GoogleAuthError('A conta Google não possui um e-mail verificado.', 401);
  }

  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    picture: isHttpsUrl(payload.picture) ? payload.picture : null,
  };
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
