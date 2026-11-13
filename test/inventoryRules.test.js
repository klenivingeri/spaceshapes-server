import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryInventoryStore, creditInventory, readInventory, replaceInventory } from '../src/inventory.js';
import { InventoryError, blankItems } from '../src/inventoryRules.js';
import data from '../src/gameData.json' with { type: 'json' };

const ID = 'local:aaaaaaaaaaaaaaaaaaaa';
// Uma família com pelo menos 3 formas, para testar a evolução em cadeia.
const FAMILY = Object.keys(data.familyShips).find((key) => data.familyShips[key].length >= 3);
const [BASE, SECOND, THIRD] = data.familyShips[FAMILY];
const frag = `center|${FAMILY}|common|0`;
const ships = (...ids) => Object.fromEntries([data.defaultShip, ...ids].map((id) => [id, true]));
const inventory = (patch = {}) => ({ ...blankItems(), ...patch });
const fragments = (count, patch = {}) => inventory({ partItems: count ? { [frag]: count } : {}, ...patch });
const fragmentCredits = (count) => Array.from({ length: count }, () => ({ kind: 'fragment', family: FAMILY }));
const rejects = (promise, message) => assert.rejects(promise, (error) => error instanceof InventoryError && error.statusCode === 422 && message.test(error.message));

test('fragmento e amostra sem origem são recusados; com crédito do servidor, aceitos uma vez', async () => {
  const store = new MemoryInventoryStore();
  await rejects(replaceInventory(store, ID, fragments(1)), /sem origem/);
  await rejects(replaceInventory(store, ID, inventory({ monsters: { 'orb_plasma|common|1': 1 } })), /sem origem/);
  await creditInventory(store, ID, [...fragmentCredits(1), { kind: 'sample', skin: 'orb_plasma', rarity: 'common' }]);
  await replaceInventory(store, ID, fragments(1, { monsters: { 'orb_plasma|common|1': 1 } }));
  assert.deepEqual((await readInventory(store, ID)).credits, { partItems: {}, monsters: {} });
  await rejects(replaceInventory(store, ID, fragments(2, { monsters: { 'orb_plasma|common|1': 1 } })), /sem origem/);
});

test('gastar, vender e equipar não precisam de crédito (equipar só troca de lugar)', async () => {
  const store = new MemoryInventoryStore();
  await creditInventory(store, ID, fragmentCredits(2));
  await replaceInventory(store, ID, fragments(2));
  await replaceInventory(store, ID, fragments(1, { fragmentSlots: [frag, null, null, null] }));
  await replaceInventory(store, ID, fragments(0, { fragmentSlots: [frag, null, null, null] }));
  await rejects(replaceInventory(store, ID, fragments(1, { fragmentSlots: [frag, null, null, null] })), /sem origem/);
});

test('promover amostras troca valor igual (mesmo de outro inimigo); criar valor é recusado', async () => {
  const store = new MemoryInventoryStore();
  await creditInventory(store, ID, Array.from({ length: data.fuseCount }, () => ({ kind: 'sample', skin: 'orb_plasma', rarity: 'common' })));
  await replaceInventory(store, ID, inventory({ monsters: { 'orb_plasma|common|1': data.fuseCount } }));
  await replaceInventory(store, ID, inventory({ monsters: { 'outro|uncommon|1': 1 } }));
  await rejects(replaceInventory(store, ID, inventory({ monsters: { 'outro|uncommon|1': 1, 'x|rare|1': 1 } })), /sem origem/);
  await rejects(replaceInventory(store, ID, inventory({ monsters: { 'x|inventada|1': 1 } })), /Amostra inválida/);
});

test('nave nova exige os fragmentos gastos da família', async () => {
  const store = new MemoryInventoryStore();
  const total = data.researchFragments + data.evolutionFragments.base;
  await creditInventory(store, ID, fragmentCredits(total));
  await replaceInventory(store, ID, fragments(total));
  await rejects(replaceInventory(store, ID, fragments(total, { ownedShips: ships(BASE) })), /sem os fragmentos/);
  await replaceInventory(store, ID, fragments(data.evolutionFragments.base, { ownedShips: ships(BASE) }));
  await rejects(replaceInventory(store, ID, fragments(data.evolutionFragments.base - 1, { ownedShips: ships(BASE, SECOND) })), /sem os fragmentos/);
  await replaceInventory(store, ID, fragments(0, { ownedShips: ships(BASE, SECOND) }));
  await rejects(replaceInventory(store, ID, fragments(0, { ownedShips: ships('nave-que-nao-existe') })), /desconhecida/);
});

test('pular a forma anterior da evolução é recusado', async () => {
  const store = new MemoryInventoryStore();
  await creditInventory(store, ID, fragmentCredits(60));
  await replaceInventory(store, ID, fragments(60));
  await rejects(replaceInventory(store, ID, fragments(0, { ownedShips: ships(THIRD) })), /forma anterior/);
});

test('o primeiro envio de uma identidade nova também é conferido (nada de inventário inventado)', async () => {
  const store = new MemoryInventoryStore();
  await rejects(replaceInventory(store, ID, fragments(999)), /sem origem/);
  await replaceInventory(store, ID, blankItems());
});

test('créditos de compra no mercado e de sala usam o mesmo caminho', async () => {
  const store = new MemoryInventoryStore();
  await creditInventory(store, ID, [{ kind: 'ship', key: frag }, { kind: 'sample', key: 'orb_plasma|rare|1' }]);
  const { credits } = await readInventory(store, ID);
  assert.deepEqual(credits, { partItems: { [frag]: 1 }, monsters: { 'orb_plasma|rare|1': 1 } });
});
