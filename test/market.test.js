import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketBoard, MarketError, MAX_LISTINGS_PER_SELLER } from '../src/market.js';

const A = 'local:aaa';
const B = 'local:bbb';
const item = (extra = {}) => ({ kind: 'sample', key: 'x|common|1', coins: 10, ore: 0, ...extra });

test('anunciar, comprar e coletar: o vendedor recebe o preço uma única vez', async () => {
  const board = new MarketBoard();
  const listing = await board.create(A, 'Ana', item({ coins: 10, ore: 2 }));
  assert.equal((await board.buy(B, listing.id)).key, 'x|common|1');
  assert.deepEqual(await board.pending(A), { coins: 10, ore: 2 });
  assert.deepEqual(await board.claim(A), { coins: 10, ore: 2 });
  assert.deepEqual(await board.claim(A), { coins: 0, ore: 0 });
});

test('só um comprador leva o anúncio e ninguém compra o próprio', async () => {
  const board = new MarketBoard();
  const { id } = await board.create(A, 'Ana', item());
  await assert.rejects(board.buy(A, id), /próprio anúncio/);
  await board.buy(B, id);
  await assert.rejects(board.buy('local:ccc', id), /não está mais/);
});

test('dois compradores ao mesmo tempo: só um leva', async () => {
  const board = new MarketBoard();
  const { id } = await board.create(A, 'Ana', item());
  const results = await Promise.allSettled([board.buy(B, id), board.buy('local:ccc', id)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
});

test('cancelar é só do dono e devolve o anúncio', async () => {
  const board = new MarketBoard();
  const { id } = await board.create(A, 'Ana', item());
  await assert.rejects(board.cancel(B, id), MarketError);
  assert.equal((await board.cancel(A, id)).id, id);
  assert.equal((await board.listings()).length, 0);
});

test('id de anúncio tem que ser texto (nada de operadores do banco)', async () => {
  const board = new MarketBoard();
  await board.create(A, 'Ana', item());
  await assert.rejects(board.buy(B, { $ne: null }), /Anúncio inválido/);
  await assert.rejects(board.cancel(A, { $ne: null }), /Anúncio inválido/);
  assert.equal((await board.listings()).length, 1);
});

test('valida preço, tipo e limite de anúncios', async () => {
  const board = new MarketBoard();
  await assert.rejects(board.create(A, 'Ana', item({ coins: 0, ore: 0 })), MarketError);
  await assert.rejects(board.create(A, 'Ana', item({ coins: -1 })), MarketError);
  await assert.rejects(board.create(A, 'Ana', item({ coins: 1.5 })), MarketError);
  await assert.rejects(board.create(A, 'Ana', item({ kind: 'arma' })), MarketError);
  await assert.rejects(board.create('qualquer', 'Ana', item()), MarketError);
  for (let i = 0; i < MAX_LISTINGS_PER_SELLER; i++) await board.create(A, 'Ana', item());
  await assert.rejects(board.create(A, 'Ana', item()), /anúncios ativos/);
});
