// Mercado global: anúncios dos jogadores (amostras e naves), guardados num MarketStore (marketStore.js: MongoDB em produção). Cada
// anúncio vende 1 item por ouro, por diamante ou pelos dois juntos. Comprar tira o anúncio da lista (atômico: só um comprador leva)
// e guarda o pagamento para o vendedor coletar depois, esteja ele online ou não. O servidor não conhece o inventário dos jogadores:
// quem anuncia retira o item da própria bolsa antes e quem cancela ou compra recebe o item de volta do anúncio.
import { isValidIdentityId } from './protocol.js';
import { MemoryMarketStore } from './marketStore.js';

export const MAX_LISTINGS_PER_SELLER = 5;
export const MAX_LISTINGS = 10_000;
export const MAX_PRICE = 1_000_000;
export const KINDS = ['sample', 'ship'];

export class MarketError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'MarketError';
    this.statusCode = statusCode;
  }
}

const isPrice = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_PRICE;

export function assertValidIdentity(id) {
  if (!isValidIdentityId(id)) throw new MarketError('Identidade inválida.');
}

// O id vai direto para o filtro do banco: só texto simples, nunca um objeto ({ $ne: null } casaria com qualquer anúncio).
function assertValidListingId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) throw new MarketError('Anúncio inválido.');
}

function assertValidItem({ kind, key }) {
  if (!KINDS.includes(kind)) throw new MarketError('Tipo de item inválido.');
  if (typeof key !== 'string' || key.length === 0 || key.length > 120) throw new MarketError('Item inválido.');
}

function assertValidPrice({ coins, ore }) {
  if (!isPrice(coins) || !isPrice(ore)) throw new MarketError('Preço inválido.');
  if (coins + ore === 0) throw new MarketError('Defina um preço em ouro, diamante ou nos dois.');
}

export class MarketBoard {
  #store;

  constructor(store = new MemoryMarketStore()) {
    this.#store = store;
  }

  listings() {
    return this.#store.all();
  }

  pending(sellerId) {
    return this.#store.pending(sellerId);
  }

  async create(sellerId, sellerName, item) {
    assertValidIdentity(sellerId);
    assertValidItem(item);
    assertValidPrice(item);
    if (typeof sellerName !== 'string' || sellerName.trim().length === 0 || sellerName.length > 24) throw new MarketError('Nome inválido.');
    if ((await this.#store.count()) >= MAX_LISTINGS) throw new MarketError('O mercado está cheio. Tente mais tarde.', 503);
    if ((await this.#store.countBySeller(sellerId)) >= MAX_LISTINGS_PER_SELLER) {
      throw new MarketError(`Você já tem ${MAX_LISTINGS_PER_SELLER} anúncios ativos.`);
    }
    return this.#store.insert({ sellerId, sellerName: sellerName.trim(), kind: item.kind, key: item.key, coins: item.coins, ore: item.ore });
  }

  // Tira o anúncio (do próprio vendedor) e devolve o item para ele.
  async cancel(sellerId, id) {
    assertValidIdentity(sellerId);
    assertValidListingId(id);
    const listing = await this.#store.take(id, { sellerId });
    if (!listing) throw new MarketError('Anúncio não encontrado.', 404);
    return listing;
  }

  // Tira o anúncio e credita o preço ao vendedor. Quem chama entrega o item ao comprador.
  async buy(buyerId, id) {
    assertValidIdentity(buyerId);
    assertValidListingId(id);
    const listing = await this.#store.take(id, { notSellerId: buyerId });
    if (!listing) {
      const own = (await this.#store.get(id)) !== null;
      throw new MarketError(own ? 'Você não pode comprar o próprio anúncio.' : 'Esse anúncio não está mais disponível.', own ? 400 : 404);
    }
    await this.#store.credit(listing.sellerId, listing);
    return listing;
  }

  // Entrega ao vendedor tudo o que as vendas renderam e zera o saldo.
  claim(sellerId) {
    assertValidIdentity(sellerId);
    return this.#store.claim(sellerId);
  }
}
