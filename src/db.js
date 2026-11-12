// Conexão com o MongoDB (Atlas). A URI vem de MONGODB_URI (segredo: só no ambiente do servidor, nunca no jogo nem no git) e o banco
// de MONGODB_DB (padrão `quadrix`). Sem URI devolve null e o servidor roda em memória (dev e testes; ver server.js).
import { MongoClient } from 'mongodb';

export async function connectDb({ uri = process.env.MONGODB_URI?.trim(), name = process.env.MONGODB_DB?.trim() || 'quadrix' } = {}) {
  if (!uri) return null;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const db = client.db(name);
  await db.collection('listings').createIndex({ sellerId: 1 });
  return db;
}
