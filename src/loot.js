// Sorteio dos drops, feito aqui e nunca no cliente: quem sorteia é quem não pode ser adulterado. As tabelas (famílias, inimigos,
// raridades, chances) vêm de gameData.json, gerado a partir do jogo por `scripts/export-drop-data.mjs` (no projeto do cliente).
// Módulo puro: `random` é injetável para teste.
import data from './gameData.json' with { type: 'json' };

export const SOURCES = ['enemy', 'block'];
export const FAMILIES = data.families;
export const ENEMIES = data.enemies;

const totalWeight = data.rarities.reduce((sum, { weight }) => sum + weight, 0);

// A raridade (a cor) da amostra capturada, pelo peso de cada uma.
export function rollRarity(random = Math.random) {
  let roll = random() * totalWeight;
  for (const { id, weight } of data.rarities) {
    roll -= weight;
    if (roll < 0) return id;
  }
  return data.rarities.at(-1).id;
}

// A família do fragmento: sorteada por igual (nunca por nave). `focus` (a família que o jogador mais precisa, uma dica do cliente)
// só vale se for uma família que existe, e só puxa o sorteio com focusChance.
export function rollFamily(focus = null, random = Math.random) {
  if (FAMILIES.includes(focus) && random() < data.focusChance) return focus;
  return FAMILIES[Math.floor(random() * FAMILIES.length)];
}

// O que um abate (`source: 'enemy'`, com a `skin` do inimigo) ou um bloco destruído (`'block'`) larga: lista de
// `{ kind: 'fragment', family }` e/ou `{ kind: 'sample', skin, rarity }`. Pode vir vazia.
export function rollDrops({ source, skin, focus }, random = Math.random) {
  const drops = [];
  if (random() < data.fragmentChance[source]) drops.push({ kind: 'fragment', family: rollFamily(focus, random) });
  if (source === 'enemy' && random() < data.captureChance) drops.push({ kind: 'sample', skin, rarity: rollRarity(random) });
  return drops;
}
