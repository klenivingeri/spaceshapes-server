// Inventário do jogador: os itens que o jogo guarda no servidor, um documento por identidade, com os créditos que o servidor concedeu
// (drops depositados, compras e cancelamentos no mercado, drops de sala) e ainda não aparecem no inventário. Quem normaliza os itens é
// o jogo, ao carregar (GameManager.loadPersistedState); aqui o servidor garante o formato e, com inventoryRules.js, que nada surja do nada.
import { InventoryError, addCredits, assertInventoryChange, blankCredits, blankDoc, withDefaults } from './inventoryRules.js';

export { InventoryError };
export const MAX_INVENTORY_CHARS = 200_000;

// Campo → tipo: `object` = mapa chave → valor, `array` = lista.
export const INVENTORY_FIELDS = {
  partItems: 'object',
  monsters: 'object',
  fragmentSlots: 'array',
  ownedShips: 'object',
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const HAS_TYPE = { object: isPlainObject, array: Array.isArray };

// Só os campos de INVENTORY_FIELDS, cada um do tipo certo, e todos presentes; qualquer outra coisa recusa o pedido inteiro.
export function sanitizeInventory(items) {
  if (!isPlainObject(items)) throw new InventoryError('Inventário inválido.', 400);
  const clean = {};
  for (const [field, type] of Object.entries(INVENTORY_FIELDS)) {
    if (!HAS_TYPE[type](items[field])) throw new InventoryError(`Campo inválido no inventário: ${field}.`, 400);
    clean[field] = items[field];
  }
  for (const field of Object.keys(items)) if (!(field in INVENTORY_FIELDS)) throw new InventoryError(`Campo desconhecido no inventário: ${field.slice(0, 40)}.`, 400);
  if (JSON.stringify(clean).length > MAX_INVENTORY_CHARS) throw new InventoryError('Inventário grande demais.', 413);
  return clean;
}

// Troca o inventário pelo que o jogador mandou, se a troca for legítima (ver inventoryRules.js).
export async function replaceInventory(store, id, items) {
  const clean = sanitizeInventory(items);
  await store.update(id, (doc) => {
    const base = doc ?? blankDoc();
    return { items: clean, credits: assertInventoryChange(withDefaults(base.items), clean, base.credits ?? blankCredits()) };
  });
}

// O servidor concede itens ao jogador (`items`: drops da run, anúncios do mercado): viram crédito, que o inventário gasta ao aumentar.
export const creditInventory = (store, id, items) => store.update(id, (doc) => {
  const base = doc ?? blankDoc();
  return { items: base.items, credits: addCredits(base.credits ?? blankCredits(), items) };
});

// Quem entra com uma conta Google leva o inventário do visitante do aparelho: o servidor move o documento (itens e créditos) para a conta,
// só se ela ainda não tem um (nunca sobrescreve), e deixa o visitante em branco. Atômico por documento; recusa (409) se a conta já tem.
export async function adoptInventory(store, fromId, toId) {
  const from = await store.get(fromId);
  if (!from) return;
  await store.update(toId, (doc) => {
    if (doc) throw new InventoryError('Essa conta já tem um inventário.', 409);
    return from;
  });
  await store.update(fromId, () => blankDoc());
}

// O que o cliente lê: os itens (null se a identidade nunca salvou) e os créditos que ele ainda não aplicou.
export async function readInventory(store, id) {
  const doc = await store.get(id);
  return { items: doc?.items ?? null, credits: doc?.credits ?? blankCredits() };
}

// Contrato dos stores (async): `get(id)` → `{ items, credits }` ou null; `update(id, change)` aplica `change(doc|null)` (síncrona, devolve
// o novo documento) de forma atômica e devolve o documento novo.
export class MemoryInventoryStore {
  #docs = new Map();

  async get(id) {
    return structuredClone(this.#docs.get(id) ?? null);
  }

  // Sem `await` entre ler e gravar: nenhuma outra chamada se intromete.
  async update(id, change) {
    const next = change(structuredClone(this.#docs.get(id) ?? null));
    this.#docs.set(id, next);
    return structuredClone(next);
  }
}

const MAX_ATTEMPTS = 8;

export class MongoInventoryStore {
  #collection;

  constructor(db) {
    this.#collection = db.collection('inventories');
  }

  async get(id) {
    const doc = await this.#collection.findOne({ _id: id });
    return doc ? { items: doc.items, credits: doc.credits } : null;
  }

  // Leitura, mudança e gravação com `rev` (documentos antigos não têm): se outro pedido gravou no meio, refaz com o documento novo.
  async update(id, change) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const doc = await this.#collection.findOne({ _id: id });
      const next = change(doc ? { items: doc.items, credits: doc.credits } : null);
      const saved = doc ? await this.#replace(id, doc, next) : await this.#insert(id, next);
      if (saved) return next;
    }
    throw new InventoryError('Inventário ocupado. Tente de novo.', 503);
  }

  async #replace(id, doc, next) {
    const filter = doc.rev === undefined ? { _id: id, rev: { $exists: false } } : { _id: id, rev: doc.rev };
    const result = await this.#collection.updateOne(filter, { $set: { ...next, updatedAt: new Date(), rev: (doc.rev ?? 0) + 1 } });
    return result.modifiedCount === 1;
  }

  async #insert(id, next) {
    try {
      await this.#collection.insertOne({ _id: id, ...next, updatedAt: new Date(), rev: 1 });
      return true;
    } catch (error) {
      if (error.code === 11000) return false;   // outro pedido criou o documento primeiro
      throw error;
    }
  }
}
