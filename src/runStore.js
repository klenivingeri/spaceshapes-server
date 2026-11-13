// Onde as runs e os drops pendentes ficam. Duas implementações com o mesmo contrato (async): memória (dev e testes) e MongoDB.
//   insertRun(run) / getRun(id)
//   insertDrops(drops) / countDrops(runId)
//   claimDrop(itemId, runId, identityId)  marca como depositado e devolve `{ itemId, kind, ... }`, ou null se não for válido/já foi
//                                         (uma chamada só ao banco: é ela que impede o item de ser depositado duas vezes)

// O item como o jogador o vê: sem os campos de controle do servidor.
function publicDrop({ runId, identityId, deposited, createdAt, _id, itemId, ...item }) {
  return { itemId: _id ?? itemId, ...item };
}

export class MemoryRunStore {
  #runs = new Map();
  #drops = new Map();

  async insertRun(run) {
    this.#runs.set(run.id, run);
  }

  async getRun(id) {
    return this.#runs.get(id) ?? null;
  }

  async insertDrops(drops) {
    for (const drop of drops) this.#drops.set(drop.itemId, drop);
  }

  async countDrops(runId) {
    return [...this.#drops.values()].filter((drop) => drop.runId === runId).length;
  }

  async claimDrop(itemId, runId, identityId) {
    const drop = this.#drops.get(itemId);
    if (!drop || drop.runId !== runId || drop.identityId !== identityId || drop.deposited) return null;
    drop.deposited = true;
    return publicDrop(drop);
  }
}

// Runs e drops somem sozinhos depois de alguns dias (índice TTL em `createdAt`, ver db.js): nada pendente fica para sempre.
export class MongoRunStore {
  #runs;
  #drops;

  constructor(db) {
    this.#runs = db.collection('runs');
    this.#drops = db.collection('drops');
  }

  async insertRun({ id, ...run }) {
    await this.#runs.insertOne({ _id: id, ...run, createdAt: new Date() });
  }

  async getRun(id) {
    const doc = await this.#runs.findOne({ _id: id });
    return doc ? { id: doc._id, ...doc } : null;
  }

  async insertDrops(drops) {
    await this.#drops.insertMany(drops.map(({ itemId, ...drop }) => ({ _id: itemId, ...drop, createdAt: new Date() })));
  }

  countDrops(runId) {
    return this.#drops.countDocuments({ runId });
  }

  async claimDrop(itemId, runId, identityId) {
    const doc = await this.#drops.findOneAndUpdate({ _id: itemId, runId, identityId, deposited: false }, { $set: { deposited: true } });
    return doc ? publicDrop(doc) : null;
  }
}
