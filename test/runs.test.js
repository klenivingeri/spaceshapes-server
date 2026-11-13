import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, ENEMIES, rollDrops, rollFamily, rollRarity } from '../src/loot.js';
import { DROP_WINDOW_MS, MAX_DROP_REQUESTS, MAX_DEPOSIT, RUN_TTL_MS, RunError, RunLedger } from '../src/runs.js';

const A = 'local:aaaaaaaaaaaaaaaaaaaa';
const B = 'local:bbbbbbbbbbbbbbbbbbbb';
const skin = ENEMIES[0];
// Sorteio que sempre acerta tudo: o abate larga fragmento e amostra.
const lucky = () => 0;

test('o abate sorteia no servidor: fragmento por família e amostra com raridade', () => {
  const drops = rollDrops({ source: 'enemy', skin }, lucky);
  assert.deepEqual(drops, [{ kind: 'fragment', family: FAMILIES[0] }, { kind: 'sample', skin, rarity: 'common' }]);
  assert.deepEqual(rollDrops({ source: 'block' }, lucky), [{ kind: 'fragment', family: FAMILIES[0] }]);
  assert.deepEqual(rollDrops({ source: 'enemy', skin }, () => 0.999), []);
});

test('o foco só vale se for uma família que existe', () => {
  assert.equal(rollFamily(FAMILIES[5], () => 0), FAMILIES[5]);
  assert.equal(rollFamily('inventada', () => 0), FAMILIES[0]);
  assert.equal(rollRarity(() => 0.9999), 'immortal');
});

test('o item sorteado só entra depois do depósito, uma única vez', async () => {
  const ledger = new RunLedger(undefined, { random: lucky });
  const { runId } = await ledger.start(A, 'pampa');
  const { items } = await ledger.drop(A, runId, { source: 'enemy', skin });
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => typeof item.itemId === 'string'));
  const ids = items.map((item) => item.itemId);
  assert.deepEqual((await ledger.deposit(A, runId, ids)).items, items);
  assert.deepEqual((await ledger.deposit(A, runId, ids)).items, []);
});

test('id inventado, de outra run ou de outro jogador não vale', async () => {
  const ledger = new RunLedger(undefined, { random: lucky });
  const mine = await ledger.start(A, 'pampa');
  const other = await ledger.start(A, 'canion');
  const { items } = await ledger.drop(A, mine.runId, { source: 'block' });
  const [{ itemId }] = items;
  assert.deepEqual((await ledger.deposit(A, mine.runId, ['inventado'])).items, []);
  assert.deepEqual((await ledger.deposit(A, other.runId, [itemId])).items, []);
  await assert.rejects(ledger.deposit(B, mine.runId, [itemId]), /Run não encontrada/);
  assert.equal((await ledger.deposit(A, mine.runId, [itemId, itemId])).items.length, 1);
});

test('dois depósitos ao mesmo tempo: o item vale uma vez só', async () => {
  const ledger = new RunLedger(undefined, { random: lucky });
  const { runId } = await ledger.start(A, 'pampa');
  const { items } = await ledger.drop(A, runId, { source: 'block' });
  const ids = items.map((item) => item.itemId);
  const [first, second] = await Promise.all([ledger.deposit(A, runId, ids), ledger.deposit(A, runId, ids)]);
  assert.equal(first.items.length + second.items.length, 1);
});

test('valida a origem, o inimigo e o tamanho do depósito', async () => {
  const ledger = new RunLedger(undefined, { random: lucky });
  const { runId } = await ledger.start(A, 'pampa');
  await assert.rejects(ledger.drop(A, runId, { source: 'ceu' }), RunError);
  await assert.rejects(ledger.drop(A, runId, { source: 'enemy', skin: 'inventado' }), /Inimigo inválido/);
  await assert.rejects(ledger.deposit(A, runId, 'x'), /Itens inválidos/);
  await assert.rejects(ledger.deposit(A, runId, Array.from({ length: MAX_DEPOSIT + 1 }, (_, i) => String(i))), /Itens inválidos/);
  await assert.rejects(ledger.start('qualquer', 'pampa'), /Identidade inválida/);
});

test('abates rápidos demais são recusados e a janela libera depois', async () => {
  let clock = 1_000_000;
  const ledger = new RunLedger(undefined, { random: () => 0.999, now: () => clock });
  const { runId } = await ledger.start(A, 'pampa');
  for (let i = 0; i < MAX_DROP_REQUESTS; i++) await ledger.drop(A, runId, { source: 'block' });
  await assert.rejects(ledger.drop(A, runId, { source: 'block' }), /rápidos demais/);
  clock += DROP_WINDOW_MS;
  await ledger.drop(A, runId, { source: 'block' });
});

test('run vencida não sorteia nem deposita', async () => {
  let clock = 1_000_000;
  const ledger = new RunLedger(undefined, { random: lucky, now: () => clock });
  const { runId } = await ledger.start(A, 'pampa');
  clock += RUN_TTL_MS + 1;
  await assert.rejects(ledger.drop(A, runId, { source: 'block' }), /venceu/);
  await assert.rejects(ledger.deposit(A, runId, ['x']), /venceu/);
});
