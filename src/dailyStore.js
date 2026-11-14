// Onde a recompensa diária guarda o último resgate de cada identidade. Duas implementações com o mesmo contrato (async): memória (dev e testes)
// e MongoDB.
//   get(id)                      `{ lastDay, streak }` da identidade, ou null se nunca resgatou
//   save(id, doc, expectedLast)  grava `doc` só se o último resgate guardado ainda é `expectedLast` (null = nunca resgatou) e devolve se gravou;
//                                é isso que impede dois pedidos juntos de resgatar o mesmo dia duas vezes
export class MemoryDailyStore {
  #entries = new Map();

  async get(id) {
    const entry = this.#entries.get(id);
    return entry ? { ...entry } : null;
  }

  async save(id, doc, expectedLast) {
    if ((this.#entries.get(id)?.lastDay ?? null) !== expectedLast) return false;
    this.#entries.set(id, { lastDay: doc.lastDay, streak: doc.streak });
    return true;
  }
}

export class MongoDailyStore {
  #collection;

  constructor(db) {
    this.#collection = db.collection('daily');
  }

  async get(id) {
    const doc = await this.#collection.findOne({ _id: id });
    return doc ? { lastDay: doc.lastDay, streak: doc.streak } : null;
  }

  async save(id, doc, expectedLast) {
    if (expectedLast === null) {
      try {
        await this.#collection.insertOne({ _id: id, lastDay: doc.lastDay, streak: doc.streak, createdAt: new Date() });
        return true;
      } catch (error) {
        if (error.code === 11000) return false;   // outro pedido resgatou primeiro
        throw error;
      }
    }
    const result = await this.#collection.updateOne({ _id: id, lastDay: expectedLast }, { $set: { lastDay: doc.lastDay, streak: doc.streak, updatedAt: new Date() } });
    return result.matchedCount === 1;
  }
}
