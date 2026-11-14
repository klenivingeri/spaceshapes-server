import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyBoard, DailyError, claimReward, comebackCoins, dayInCycle, dayOf, daysBetween, nextStreak } from '../src/daily.js';
import { MemoryDailyStore } from '../src/dailyStore.js';

const ID = 'local:0123456789abcdef0123';
// 14/11/2026 12:00 em Brasília (UTC-3) = 15:00 UTC. Cada dia a mais soma 24 h.
const at = (day, hour = 12) => Date.parse(`2026-11-${String(day).padStart(2, '0')}T00:00:00Z`) + (hour + 3) * 3_600_000;

// Os mesmos casos de QUADRIX/src/shared/dailyCatalog.test.js: as contas dos dois lados têm que dar igual.
test('as contas batem com as do jogo', () => {
  assert.equal(daysBetween('2026-11-30', '2026-12-01'), 1);
  assert.equal(nextStreak(null, 0, '2026-11-14'), 1);
  assert.equal(nextStreak('2026-11-13', 3, '2026-11-14'), 4);
  assert.equal(nextStreak('2026-11-10', 5, '2026-11-12'), 5);
  assert.equal(nextStreak('2026-11-10', 5, '2026-11-14'), 3);
  assert.equal(nextStreak('2026-11-01', 2, '2026-11-14'), 1);
  assert.deepEqual([1, 7, 8, 14].map(dayInCycle), [1, 7, 1, 7]);
  assert.equal(comebackCoins('2026-11-12', '2026-11-14'), 0);
  assert.equal(comebackCoins('2026-11-08', '2026-11-14'), 750);
  assert.equal(comebackCoins('2026-01-01', '2026-11-14'), 14 * 150);
  assert.deepEqual(claimReward('2026-11-08', 3, '2026-11-14'), { streak: 1, day: 1, coins: 950, ore: 2, fragments: 0, comeback: 750 });
});

test('o dia vira à meia-noite de Brasília, não à de UTC', () => {
  assert.equal(dayOf(Date.parse('2026-11-14T02:59:00Z')), '2026-11-13');   // 23:59 em Brasília ainda é dia 13
  assert.equal(dayOf(Date.parse('2026-11-14T03:00:00Z')), '2026-11-14');
});

test('resgata uma vez por dia e a sequência cresce nos dias seguidos', async () => {
  let now = at(14);
  const board = new DailyBoard(new MemoryDailyStore(), { now: () => now });
  const first = await board.claim(ID);
  assert.equal(first.streak, 1);
  assert.equal(first.day, 1);
  assert.equal(first.coins, 200);
  await assert.rejects(() => board.claim(ID), (error) => error instanceof DailyError && error.statusCode === 409);
  now = at(15);
  assert.equal((await board.claim(ID)).streak, 2);
});

test('o status mostra se já resgatou e o prêmio seguinte', async () => {
  const board = new DailyBoard(new MemoryDailyStore(), { now: () => at(14) });
  assert.equal((await board.status(ID)).canClaim, true);
  await board.claim(ID);
  const status = await board.status(ID);
  assert.equal(status.canClaim, false);
  assert.equal(status.streak, 1);
  assert.equal(status.next.day, 2);   // o que vem amanhã
});

test('o dia 7 do ciclo concede 3 fragmentos', async () => {
  let now = at(1);
  const board = new DailyBoard(new MemoryDailyStore(), { now: () => now });
  let result;
  for (let day = 1; day <= 7; day++) {
    now = at(day);
    result = await board.claim(ID);
  }
  assert.equal(result.day, 7);
  assert.equal(result.grants.length, 3);
  assert.ok(result.grants.every((grant) => grant.kind === 'fragment' && typeof grant.family === 'string'));
});

test('dois pedidos juntos resgatam só uma vez', async () => {
  const board = new DailyBoard(new MemoryDailyStore(), { now: () => at(14) });
  const results = await Promise.allSettled([board.claim(ID), board.claim(ID)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
});

test('identidade inválida é recusada', async () => {
  const board = new DailyBoard();
  await assert.rejects(() => board.claim('qualquer coisa'), DailyError);
  await assert.rejects(() => board.status('x'), DailyError);
});
