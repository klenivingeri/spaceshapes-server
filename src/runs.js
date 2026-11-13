// Registro das runs: o servidor sorteia os drops (loot.js), dá a cada um um id único e o guarda como pendente da run; o jogador só
// ganha o item ao depositar na base, e o depósito confere que o id é de verdade, é dele, é desta run e ainda não foi depositado.
// Limites de plausibilidade (o servidor não vê o combate): pedidos de drop por janela de tempo, drops por run e validade da run.
// O que não é depositado (run abandonada) vence junto com a run e se perde, como o minério da carga.
import { randomUUID } from 'node:crypto';
import { ENEMIES, SOURCES, rollDrops } from './loot.js';
import { isValidIdentityId } from './protocol.js';
import { MemoryRunStore } from './runStore.js';

export const RUN_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_DROP_REQUESTS = 50;
export const DROP_WINDOW_MS = 10_000;
export const MAX_RUN_DROPS = 2000;
export const MAX_DEPOSIT = 200;

export class RunError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'RunError';
    this.statusCode = statusCode;
  }
}

const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

export class RunLedger {
  #store;
  #now;
  #random;
  // Quando foram os últimos pedidos de drop de cada run. Só na memória: é limite de ritmo, não dado a guardar.
  #recent = new Map();

  constructor(store = new MemoryRunStore(), { now = Date.now, random = Math.random } = {}) {
    this.#store = store;
    this.#now = now;
    this.#random = random;
  }

  async start(identityId, mapId) {
    if (!isValidIdentityId(identityId)) throw new RunError('Identidade inválida.');
    if (!isText(mapId, 60)) throw new RunError('Mapa inválido.');
    this.#forgetIdleRuns();
    const run = { id: randomUUID(), identityId, mapId, startedAt: this.#now() };
    await this.#store.insertRun(run);
    return { runId: run.id };
  }

  async #openRun(identityId, runId) {
    if (!isText(runId, 64)) throw new RunError('Run inválida.');
    const run = await this.#store.getRun(runId);
    if (!run || run.identityId !== identityId) throw new RunError('Run não encontrada.', 404);
    if (this.#now() - run.startedAt > RUN_TTL_MS) throw new RunError('Essa run venceu. Comece outra.', 410);
  }

  // Runs paradas há mais que a janela não precisam mais do histórico de ritmo: o mapa não cresce com o tempo.
  #forgetIdleRuns() {
    const now = this.#now();
    for (const [runId, times] of this.#recent) if (now - times.at(-1) >= DROP_WINDOW_MS) this.#recent.delete(runId);
  }

  #withinRate(runId) {
    const now = this.#now();
    const recent = (this.#recent.get(runId) ?? []).filter((at) => now - at < DROP_WINDOW_MS);
    if (recent.length >= MAX_DROP_REQUESTS) return false;
    recent.push(now);
    this.#recent.set(runId, recent);
    return true;
  }

  // Sorteia o que o abate/bloco largou e guarda como pendente. Devolve os itens com o id (`itemId`) que o depósito vai exigir.
  async drop(identityId, runId, { source, skin, focus }) {
    await this.#openRun(identityId, runId);
    if (!SOURCES.includes(source)) throw new RunError('Origem do drop inválida.');
    if (source === 'enemy' && !ENEMIES.includes(skin)) throw new RunError('Inimigo inválido.');
    if (!this.#withinRate(runId)) throw new RunError('Abates rápidos demais. Aguarde um instante.', 429);
    const drops = rollDrops({ source, skin, focus }, this.#random);
    if (drops.length === 0) return { items: [] };
    if ((await this.#store.countDrops(runId)) + drops.length > MAX_RUN_DROPS) throw new RunError('Limite de drops da run atingido.', 429);
    const items = drops.map((item) => ({ itemId: randomUUID(), ...item }));
    await this.#store.insertDrops(items.map((item) => ({ ...item, runId, identityId, deposited: false })));
    return { items };
  }

  // Confere cada id e entrega só os válidos (cada um uma única vez, mesmo com dois depósitos ao mesmo tempo). Ids que não são desta
  // run, já depositados ou inventados ficam de fora: o cliente só aplica o que voltar.
  async deposit(identityId, runId, itemIds) {
    await this.#openRun(identityId, runId);
    if (!Array.isArray(itemIds) || itemIds.length > MAX_DEPOSIT || !itemIds.every((id) => isText(id, 64))) throw new RunError('Itens inválidos.');
    const items = [];
    for (const itemId of new Set(itemIds)) {
      const claimed = await this.#store.claimDrop(itemId, runId, identityId);
      if (claimed) items.push(claimed);
    }
    return { items };
  }
}
