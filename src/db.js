// Conexão com o MongoDB (Atlas). A URI vem de MONGODB_URI (segredo: só no ambiente do servidor, nunca no jogo nem no git) e o banco
// de MONGODB_DB (padrão `quadrix`). Sem URI devolve null e o servidor roda em memória (dev e testes; ver server.js).
import { MongoClient } from 'mongodb';

export async function connectDb({ uri = process.env.MONGODB_URI?.trim(), name = process.env.MONGODB_DB?.trim() || 'quadrix' } = {}) {
  if (!uri) return null;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const db = client.db(name);
  await db.collection('listings').createIndex({ sellerId: 1 });
  // Runs e drops pendentes expiram sozinhos (3 dias); a run vale 12 h (ver runs.js), então nada útil se perde antes.
  const threeDays = 3 * 24 * 60 * 60;
  await db.collection('runs').createIndex({ createdAt: 1 }, { expireAfterSeconds: threeDays });
  await db.collection('drops').createIndex({ createdAt: 1 }, { expireAfterSeconds: threeDays });
  await db.collection('drops').createIndex({ runId: 1 });
  await db.collection('ranking').createIndex({ power: -1, createdAt: 1 });
  return db;
}
