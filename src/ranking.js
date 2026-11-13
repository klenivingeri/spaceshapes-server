// Ranking de poder: cada jogador manda o próprio poder (o melhor entre as naves dele) e o servidor guarda o último valor por identidade.
// O ranking que todos veem é um retrato tirado a cada `refreshMs` (padrão 3 h): o top 10 é igual para qualquer jogador (sem
// identidade) e a posição de cada um vem à parte, calculada nesse mesmo retrato, para o 11º lugar da tela ser coerente com o top.
// O poder é o que o cliente informa (ainda não há como o servidor recalcular: nível e atributos vivem no aparelho), então só se
// recusa o que é impossível (fora de 0..MAX_POWER). O jogador novo só aparece depois do próximo retrato.
import { isValidIdentityId } from './protocol.js';
import { MemoryRankingStore } from './rankingStore.js';

export const TOP_SIZE = 10;
export const MAX_POWER = 10_000_000;
export const DEFAULT_REFRESH_MS = 3 * 60 * 60 * 1000;
// Quantos jogadores entram no retrato (a posição de quem está além disso é "depois do último").
export const MAX_RANKED = 50_000;

export class RankingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'RankingError';
    this.statusCode = statusCode;
  }
}

export class RankingBoard {
  #store;
  #now;
  #refreshMs;
  #snapshot = null;
  #loading = null;

  constructor(store = new MemoryRankingStore(), { now = Date.now, refreshMs = DEFAULT_REFRESH_MS } = {}) {
    this.#store = store;
    this.#now = now;
    this.#refreshMs = refreshMs;
  }

  // O último poder informado pela identidade (substitui o anterior: trocar para uma nave mais fraca também conta).
  async submit(id, name, power) {
    if (!isValidIdentityId(id)) throw new RankingError('Identidade inválida.');
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 24) throw new RankingError('Nome inválido.');
    if (!Number.isInteger(power) || power < 0 || power > MAX_POWER) throw new RankingError('Poder inválido.');
    await this.#store.upsert(id, { name: name.trim(), power });
  }

  // O retrato de agora; refaz só quando venceu (pedidos ao mesmo tempo esperam o mesmo retrato).
  async #current() {
    if (this.#snapshot && this.#now() < this.#snapshot.nextRefreshAt) return this.#snapshot;
    this.#loading ??= this.#store.ranked(MAX_RANKED).then((ranked) => {
      const generatedAt = this.#now();
      this.#snapshot = { generatedAt, nextRefreshAt: generatedAt + this.#refreshMs, ranked };
      return this.#snapshot;
    }).finally(() => { this.#loading = null; });
    return this.#loading;
  }

  // Os 10 primeiros, iguais para todos (só nome e poder; nunca a identidade), e quando o retrato vence.
  async top() {
    const { ranked, generatedAt, nextRefreshAt } = await this.#current();
    return { top: ranked.slice(0, TOP_SIZE).map(({ name, power }, index) => ({ rank: index + 1, name, power })), generatedAt, nextRefreshAt };
  }

  // A posição da identidade no retrato: `{ rank, name, power }`. Quem já estava no retrato vale pelo poder que tinha nele; quem entrou
  // depois (jogador novo) tem a posição estimada pelo poder de agora contra o retrato (`provisional`), para não ficar sem posição por horas.
  // null só se a identidade nunca informou poder.
  async position(id) {
    if (!isValidIdentityId(id)) throw new RankingError('Identidade inválida.');
    const { ranked } = await this.#current();
    const inSnapshot = ranked.find((entry) => entry.id === id);
    const entry = inSnapshot ?? (await this.#store.get(id));
    if (!entry) return { you: null };
    // Empates dividem a posição: vale quantos têm poder maior, mais um.
    const rank = ranked.filter((other) => other.power > entry.power).length + 1;
    return { you: { rank, name: entry.name, power: entry.power, provisional: !inSnapshot } };
  }
}
