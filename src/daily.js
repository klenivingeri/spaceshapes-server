// Recompensa diária: calendário de 7 dias com sequência. O DIA e a sequência são do servidor (o relógio do aparelho não vale: senão bastaria
// mudar a data para resgatar sem parar). O dia é o de Brasília (UTC-3), então vira à meia-noite local do público do jogo.
// As contas repetem as de QUADRIX/src/shared/dailyCatalog.js (pequenas, com os mesmos casos de teste); a tabela de prêmios vem do gameData.json,
// gerado pelo jogo (scripts/export-drop-data.mjs). Ouro e diamantes são aplicados no aparelho; só o fragmento passa pelo servidor (vira crédito
// de inventário, ver httpServer.js).
import data from './gameData.json' with { type: 'json' };
import { rollFamily } from './loot.js';
import { isValidIdentityId } from './protocol.js';
import { MemoryDailyStore } from './dailyStore.js';

export class DailyError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'DailyError';
    this.statusCode = statusCode;
  }
}

const BRASILIA_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const { rewards, comebackAfterDays, comebackCoinsPerDay, comebackMaxDays } = data.daily;

export const dayOf = (timestamp) => new Date(timestamp + BRASILIA_OFFSET_MS).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export function nextStreak(lastDay, streak, today) {
  if (!lastDay) return 1;
  const gap = daysBetween(lastDay, today);
  if (gap <= 0) return Math.max(1, streak);
  return Math.max(0, streak - (gap - 1)) + 1;
}

export const dayInCycle = (streak) => ((Math.max(1, streak) - 1) % rewards.length) + 1;

export function comebackCoins(lastDay, today) {
  if (!lastDay) return 0;
  const away = daysBetween(lastDay, today) - 1;
  return away >= comebackAfterDays ? Math.min(away, comebackMaxDays) * comebackCoinsPerDay : 0;
}

export function claimReward(lastDay, streak, today) {
  const count = nextStreak(lastDay, streak, today);
  const day = dayInCycle(count);
  const base = rewards[day - 1];
  const comeback = comebackCoins(lastDay, today);
  return { streak: count, day, coins: base.coins + comeback, ore: base.ore, fragments: base.fragments ?? 0, comeback };
}

export class DailyBoard {
  #store;
  #now;

  constructor(store = new MemoryDailyStore(), { now = Date.now } = {}) {
    this.#store = store;
    this.#now = now;
  }

  // O retrato para a tela: o dia de hoje, a sequência, se já dá para resgatar e o prêmio de hoje (ou o de amanhã, se já resgatou).
  async status(id) {
    if (!isValidIdentityId(id)) throw new DailyError('Identidade inválida.');
    const today = dayOf(this.#now());
    const state = (await this.#store.get(id)) ?? { lastDay: null, streak: 0 };
    const canClaim = state.lastDay !== today;
    const preview = claimReward(state.lastDay, state.streak, canClaim ? today : dayOf(this.#now() + DAY_MS));
    return { today, lastDay: state.lastDay, streak: state.streak, canClaim, next: preview, rewards };
  }

  // Resgata o prêmio de hoje (uma vez por dia). `focus`: a família de nave que o jogador mais precisa (dica para o fragmento do dia 7).
  // Devolve o prêmio e os itens (`grants`) que o servidor concede (fragmentos), para o chamador creditar no inventário.
  async claim(id, focus = null) {
    if (!isValidIdentityId(id)) throw new DailyError('Identidade inválida.');
    const today = dayOf(this.#now());
    const state = await this.#store.get(id);
    if (state?.lastDay === today) throw new DailyError('Você já resgatou a recompensa de hoje.', 409);
    const reward = claimReward(state?.lastDay ?? null, state?.streak ?? 0, today);
    const saved = await this.#store.save(id, { lastDay: today, streak: reward.streak }, state?.lastDay ?? null);
    if (!saved) throw new DailyError('Você já resgatou a recompensa de hoje.', 409);
    const grants = Array.from({ length: reward.fragments }, () => ({ kind: 'fragment', family: rollFamily(focus) }));
    return { today, ...reward, grants };
  }
}
