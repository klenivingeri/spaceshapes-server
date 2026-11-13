import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REFRESH_MS, MAX_POWER, RankingBoard, RankingError, TOP_SIZE } from '../src/ranking.js';

const player = (n) => `local:${String(n).padStart(20, '0')}`;

async function filled(count, options) {
  const board = new RankingBoard(undefined, options);
  for (let i = 1; i <= count; i++) await board.submit(player(i), `P${i}`, i * 100);
  return board;
}

test('o top 10 vem do maior para o menor poder, sem a identidade de ninguém', async () => {
  const board = await filled(15);
  const { top } = await board.top();
  assert.equal(top.length, TOP_SIZE);
  assert.deepEqual(top[0], { rank: 1, name: 'P15', power: 1500 });
  assert.deepEqual(top.map((entry) => entry.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(top.every((entry) => Object.keys(entry).sort().join() === 'name,power,rank'));
});

test('a posição do jogador fora do top vem do mesmo retrato; empates dividem a posição', async () => {
  let clock = 0;
  const board = await filled(15, { now: () => clock });
  clock += 1;
  assert.deepEqual((await board.position(player(3))).you, { rank: 13, name: 'P3', power: 300, provisional: false });
  await board.submit(player(99), 'Empate', 300);
  clock = DEFAULT_REFRESH_MS + 1;
  assert.equal((await board.position(player(3))).you.rank, 13);
  assert.equal((await board.position(player(99))).you.rank, 13);
});

test('o retrato só é refeito depois de X horas; quem entrou depois tem posição estimada', async () => {
  let clock = 0;
  const board = await filled(12, { now: () => clock, refreshMs: 1000 });
  const first = await board.top();
  await board.submit(player(50), 'Novo', 100_000);
  clock = 999;
  assert.equal((await board.top()).generatedAt, first.generatedAt);
  assert.equal((await board.top()).top[0].name, 'P12');
  assert.deepEqual((await board.position(player(50))).you, { rank: 1, name: 'Novo', power: 100_000, provisional: true });
  clock = 1000;
  const refreshed = await board.top();
  assert.equal(refreshed.top[0].name, 'Novo');
  assert.equal(refreshed.nextRefreshAt, 2000);
  assert.equal((await board.position(player(50))).you.provisional, false);
});

test('quem nunca informou poder não tem posição; valida nome, poder e identidade', async () => {
  const board = new RankingBoard();
  assert.deepEqual(await board.position(player(1)), { you: null });
  await assert.rejects(board.submit('qualquer', 'A', 1), RankingError);
  await assert.rejects(board.submit(player(1), '', 1), /Nome inválido/);
  await assert.rejects(board.submit(player(1), 'A', -1), /Poder inválido/);
  await assert.rejects(board.submit(player(1), 'A', 1.5), /Poder inválido/);
  await assert.rejects(board.submit(player(1), 'A', MAX_POWER + 1), /Poder inválido/);
});

test('o último poder informado substitui o anterior', async () => {
  const board = new RankingBoard();
  await board.submit(player(1), 'A', 500);
  await board.submit(player(1), 'A', 200);
  assert.equal((await board.top()).top[0].power, 200);
});
