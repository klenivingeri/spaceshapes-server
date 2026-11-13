// O que o servidor aceita que o inventário do jogador vire. O cliente continua dono das contas (pesquisar, promover, equipar, vender),
// mas nada de novo pode surgir sem origem: um item só aumenta se o servidor creditou aquele item (depósito de drop, compra ou
// cancelamento no mercado, drop de sala) ou se o jogador gastou o que a regra pede (promoção, pesquisa, evolução). Módulo puro; as
// regras vêm de gameData.json (gerado pelo jogo, ver scripts/export-drop-data.mjs).
import data from './gameData.json' with { type: 'json' };

export class InventoryError extends Error {
  constructor(message, statusCode = 422) {
    super(message);
    this.name = 'InventoryError';
    this.statusCode = statusCode;
  }
}

const MAX_COUNT = 1_000_000;
// Valor de cada raridade: FUSE_COUNT amostras de uma valem 1 da seguinte, então promover não cria nem destrói valor.
const WEIGHT = Object.fromEntries(data.rarities.map(({ id }, index) => [id, data.fuseCount ** index]));
const SHIPS = new Map(Object.entries(data.familyShips).flatMap(([base, ids]) => ids.map((id, index) => [id, { base, index, chain: ids }])));

export const blankItems = () => ({
  partItems: {},
  monsters: {},
  fragmentSlots: Array(data.slots).fill(null),
  ownedShips: { [data.defaultShip]: true },
});
export const blankCredits = () => ({ partItems: {}, monsters: {} });
export const blankDoc = () => ({ items: blankItems(), credits: blankCredits() });

// Inventário guardado com campos faltando (saves antigos): completa com o padrão. `ownedShips` já foi uma lista.
export function withDefaults(items) {
  const blank = blankItems();
  const ships = Array.isArray(items?.ownedShips) ? Object.fromEntries(items.ownedShips.map((id) => [id, true])) : items?.ownedShips;
  return { ...blank, ...items, ownedShips: ships ?? blank.ownedShips, fragmentSlots: items?.fragmentSlots ?? blank.fragmentSlots };
}

const familyOfFragment = (key) => key.split('|')[1];
const monsterWeight = (key) => {
  const weight = WEIGHT[key.split('|')[1]];
  if (weight === undefined) throw new InventoryError(`Amostra inválida: ${key.slice(0, 60)}.`);
  return weight;
};

function assertCounts(map, label) {
  for (const [key, count] of Object.entries(map)) {
    if (!Number.isSafeInteger(count) || count <= 0 || count > MAX_COUNT) throw new InventoryError(`Quantidade inválida em ${label}: ${key.slice(0, 60)}.`);
  }
}

// Fragmentos na bolsa e nos cantos do hangar, somados por tipo (equipar só troca de lugar).
function fragmentTotals({ partItems, fragmentSlots }) {
  const totals = new Map(Object.entries(partItems));
  for (const key of fragmentSlots) if (key) totals.set(key, (totals.get(key) ?? 0) + 1);
  return totals;
}

const monsterValue = (monsters) => Object.entries(monsters).reduce((sum, [key, count]) => sum + count * monsterWeight(key), 0);

// Fragmentos: cada tipo só aumenta até o que foi creditado. Devolve os créditos que sobraram.
function spendFragmentCredits(before, after, credits) {
  const left = { ...credits };
  const oldTotals = fragmentTotals(before);
  for (const [key, count] of fragmentTotals(after)) {
    const increase = count - (oldTotals.get(key) ?? 0);
    if (increase <= 0) continue;
    if ((left[key] ?? 0) < increase) throw new InventoryError(`Fragmento sem origem: ${key.slice(0, 60)}.`);
    left[key] -= increase;
    if (left[key] === 0) delete left[key];
  }
  return left;
}

// Amostras: o valor total só aumenta até o valor creditado (a promoção troca amostras de valor igual, mesmo de outro inimigo).
function spendMonsterCredits(before, after, credits) {
  let remaining = monsterValue(after) - monsterValue(before);
  if (remaining <= 0) return credits;
  const left = { ...credits };
  if (monsterValue(left) < remaining) throw new InventoryError('Amostras sem origem.');
  for (const key of Object.keys(left).sort((a, b) => monsterWeight(a) - monsterWeight(b))) {
    const weight = monsterWeight(key);
    const units = Math.min(left[key], Math.ceil(remaining / weight));
    left[key] -= units;
    remaining -= units * weight;
    if (left[key] === 0) delete left[key];
    if (remaining <= 0) break;
  }
  return left;
}

// Fragmentos que o jogador gastou (diminuíram) por família.
function consumedByFamily(before, after) {
  const consumed = {};
  const now = fragmentTotals(after);
  for (const [key, count] of fragmentTotals(before)) {
    const spent = count - (now.get(key) ?? 0);
    if (spent > 0) consumed[familyOfFragment(key)] = (consumed[familyOfFragment(key)] ?? 0) + spent;
  }
  return consumed;
}

// Criar a nave base de uma família custa researchFragments; cada forma seguinte, 10 + 5 por forma já feita (ver evolutionCost no jogo).
const shipCost = (index) => (index === 0 ? data.researchFragments : data.evolutionFragments.base + data.evolutionFragments.step * (index - 1));

// Nave nova só com os fragmentos gastos da família e, se for evolução, com a forma anterior em mãos.
function assertShips(before, after) {
  const needed = {};
  // A escolha inicial (onboarding) dá uma das naves iniciais de graça, mas só uma: com mais de uma na conta, cada nova paga o preço normal.
  const freeStarter = Object.keys(after.ownedShips).filter((id) => data.starterShips.includes(id)).length <= 1;
  for (const id of Object.keys(after.ownedShips)) {
    if (before.ownedShips[id]) continue;
    const ship = SHIPS.get(id);
    if (!ship) throw new InventoryError(`Nave desconhecida: ${id.slice(0, 60)}.`);
    if (freeStarter && data.starterShips.includes(id)) continue;
    if (ship.index > 0 && !after.ownedShips[ship.chain[ship.index - 1]]) throw new InventoryError(`Nave sem a forma anterior: ${id.slice(0, 60)}.`);
    needed[ship.base] = (needed[ship.base] ?? 0) + shipCost(ship.index);
  }
  const consumed = consumedByFamily(before, after);
  for (const [family, cost] of Object.entries(needed)) {
    if ((consumed[family] ?? 0) < cost) throw new InventoryError('Nave nova sem os fragmentos gastos.');
  }
}

// Confere a troca de `before` para `after` e devolve os créditos que sobram. Lança InventoryError se algo surgiu do nada.
export function assertInventoryChange(before, after, credits) {
  assertCounts(after.partItems, 'fragmentos');
  assertCounts(after.monsters, 'amostras');
  if (after.fragmentSlots.length > data.slots || after.fragmentSlots.some((key) => key !== null && typeof key !== 'string')) throw new InventoryError('Cantos do hangar inválidos.');
  if (Object.values(after.ownedShips).some((owned) => owned !== true)) throw new InventoryError('Naves inválidas.');
  const partItems = spendFragmentCredits(before, after, credits.partItems);
  const monsters = spendMonsterCredits(before.monsters, after.monsters, credits.monsters);
  assertShips(before, after);
  return { partItems, monsters };
}

// Onde cada item que o servidor entrega entra no inventário: `{ bucket, key }`. Aceita o drop da run (`kind: fragment|sample`) e o
// anúncio do mercado (`kind: ship|sample` com `key`).
export function lootEntry(item) {
  if (item.kind === 'fragment') return { bucket: 'partItems', key: `center|${item.family}|common|0` };
  if (item.kind === 'sample' && item.skin) return { bucket: 'monsters', key: `${item.skin}|${item.rarity}|1` };
  if (item.kind === 'ship') return { bucket: 'partItems', key: item.key };
  if (item.kind === 'sample') return { bucket: 'monsters', key: item.key };
  throw new InventoryError('Item inválido.');
}

export function addCredits(credits, items) {
  const next = { partItems: { ...credits.partItems }, monsters: { ...credits.monsters } };
  for (const item of items) {
    const { bucket, key } = lootEntry(item);
    next[bucket][key] = (next[bucket][key] ?? 0) + 1;
  }
  return next;
}
