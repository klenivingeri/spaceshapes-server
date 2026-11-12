// Inventário do jogador: os itens que o jogo guarda no servidor (antes ficavam no localStorage), um documento por identidade.
// O servidor não conhece as regras do jogo (quais peças existem, quanto vale cada uma): só garante o formato e o tamanho, e que
// ninguém grave campo que não seja inventário. Quem normaliza os itens é o jogo, ao carregar (GameManager.loadPersistedState).
export const MAX_INVENTORY_CHARS = 200_000;

// Campo → tipo: `object` = mapa chave → valor, `array` = lista, `number` = inteiro não negativo.
export const INVENTORY_FIELDS = {
  partItems: 'object',
  bagCells: 'number',
  bagLayout: 'object',
  monsters: 'object',
  skinItems: 'object',
  chipSlots: 'array',
  fragmentSlots: 'array',
  ownedShips: 'object',
};

export class InventoryError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'InventoryError';
    this.statusCode = statusCode;
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const HAS_TYPE = {
  object: isPlainObject,
  array: Array.isArray,
  number: (value) => Number.isInteger(value) && value >= 0,
};

// Só os campos de INVENTORY_FIELDS, cada um do tipo certo; qualquer outra coisa recusa o pedido inteiro (nada é gravado pela metade).
export function sanitizeInventory(items) {
  if (!isPlainObject(items)) throw new InventoryError('Inventário inválido.');
  const clean = {};
  for (const [field, value] of Object.entries(items)) {
    const type = INVENTORY_FIELDS[field];
    if (!type) throw new InventoryError(`Campo desconhecido no inventário: ${field.slice(0, 40)}.`);
    if (!HAS_TYPE[type](value)) throw new InventoryError(`Campo inválido no inventário: ${field}.`);
    clean[field] = value;
  }
  if (JSON.stringify(clean).length > MAX_INVENTORY_CHARS) throw new InventoryError('Inventário grande demais.', 413);
  return clean;
}

export class MemoryInventoryStore {
  #items = new Map();

  async get(id) {
    return this.#items.get(id) ?? null;
  }

  async put(id, items) {
    this.#items.set(id, items);
  }
}

export class MongoInventoryStore {
  #collection;

  constructor(db) {
    this.#collection = db.collection('inventories');
  }

  async get(id) {
    const doc = await this.#collection.findOne({ _id: id });
    return doc?.items ?? null;
  }

  async put(id, items) {
    await this.#collection.updateOne({ _id: id }, { $set: { items, updatedAt: new Date() } }, { upsert: true });
  }
}
