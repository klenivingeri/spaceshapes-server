// Onde o ranking guarda o poder de cada identidade. Duas implementações com o mesmo contrato (async): memória (dev e testes) e MongoDB.
//   upsert(id, { name, power })   grava (ou troca) o poder da identidade
//   get(id)                       `{ name, power }` da identidade, ou null
//   ranked(limit)                 até `limit` jogadores `{ id, name, power }`, do maior poder para o menor (empate: quem chegou antes)
export class MemoryRankingStore {
  #entries = new Map();

  async upsert(id, { name, power }) {
    const previous = this.#entries.get(id);
    this.#entries.set(id, { id, name, power, at: previous?.at ?? this.#entries.size });
  }

  async get(id) {
    const entry = this.#entries.get(id);
    return entry ? { name: entry.name, power: entry.power } : null;
  }

  async ranked(limit) {
    return [...this.#entries.values()].sort((a, b) => b.power - a.power || a.at - b.at).slice(0, limit).map(({ id, name, power }) => ({ id, name, power }));
  }
}

export class MongoRankingStore {
  #collection;

  constructor(db) {
    this.#collection = db.collection('ranking');
  }

  async upsert(id, { name, power }) {
    await this.#collection.updateOne({ _id: id }, { $set: { name, power, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  }

  async get(id) {
    const doc = await this.#collection.findOne({ _id: id });
    return doc ? { name: doc.name, power: doc.power } : null;
  }

  async ranked(limit) {
    const docs = await this.#collection.find({}, { projection: { name: 1, power: 1 } }).sort({ power: -1, createdAt: 1 }).limit(limit).toArray();
    return docs.map(({ _id, name, power }) => ({ id: _id, name, power }));
  }
}
