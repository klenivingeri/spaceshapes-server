// Onde o mercado guarda os anúncios e o saldo dos vendedores. Duas implementações com o mesmo contrato (todas as funções são async):
// em memória (dev e testes) e no MongoDB (produção: os anúncios sobrevivem a reinício e deploy). As operações que precisam ser
// atômicas (`take`, `claim`) são uma só chamada ao banco: só um comprador leva o anúncio e o saldo só é coletado uma vez.
//   all()                              todos os anúncios
//   get(id)                            um anúncio, ou null
//   count() / countBySeller(sellerId)  quantos anúncios, no total / de um vendedor
//   insert(data)                       cria o anúncio (ganha um `id`) e o devolve
//   take(id, { sellerId, notSellerId }) tira o anúncio e o devolve, só se casar com o vendedor (ou não for dele); null se não achou
//   credit(sellerId, { coins, ore })   soma ao saldo a coletar do vendedor
//   pending(sellerId) / claim(sellerId) saldo a coletar `{ coins, ore }` / entrega e zera o saldo
import { randomUUID } from 'node:crypto';

const EMPTY_BALANCE = { coins: 0, ore: 0 };

export class MemoryMarketStore {
  #listings = new Map();
  #earnings = new Map();
  #nextId = 1;

  async all() {
    return [...this.#listings.values()];
  }

  async get(id) {
    return this.#listings.get(id) ?? null;
  }

  async count() {
    return this.#listings.size;
  }

  async countBySeller(sellerId) {
    return [...this.#listings.values()].filter((listing) => listing.sellerId === sellerId).length;
  }

  async insert(data) {
    const listing = { id: String(this.#nextId++), ...data };
    this.#listings.set(listing.id, listing);
    return listing;
  }

  async take(id, { sellerId, notSellerId } = {}) {
    const listing = this.#listings.get(id);
    if (!listing) return null;
    if (sellerId !== undefined && listing.sellerId !== sellerId) return null;
    if (notSellerId !== undefined && listing.sellerId === notSellerId) return null;
    this.#listings.delete(id);
    return listing;
  }

  async credit(sellerId, { coins, ore }) {
    const earned = await this.pending(sellerId);
    this.#earnings.set(sellerId, { coins: earned.coins + coins, ore: earned.ore + ore });
  }

  async pending(sellerId) {
    return { ...(this.#earnings.get(sellerId) ?? EMPTY_BALANCE) };
  }

  async claim(sellerId) {
    const earned = await this.pending(sellerId);
    this.#earnings.delete(sellerId);
    return earned;
  }
}

const toListing = ({ _id, createdAt, ...rest }) => ({ id: _id, ...rest });

export class MongoMarketStore {
  #listings;
  #earnings;

  constructor(db) {
    this.#listings = db.collection('listings');
    this.#earnings = db.collection('earnings');
  }

  async all() {
    return (await this.#listings.find().toArray()).map(toListing);
  }

  async get(id) {
    const doc = await this.#listings.findOne({ _id: id });
    return doc ? toListing(doc) : null;
  }

  count() {
    return this.#listings.countDocuments();
  }

  countBySeller(sellerId) {
    return this.#listings.countDocuments({ sellerId });
  }

  async insert(data) {
    const doc = { _id: randomUUID(), ...data, createdAt: new Date() };
    await this.#listings.insertOne(doc);
    return toListing(doc);
  }

  async take(id, { sellerId, notSellerId } = {}) {
    const filter = { _id: id };
    if (sellerId !== undefined) filter.sellerId = sellerId;
    if (notSellerId !== undefined) filter.sellerId = { $ne: notSellerId };
    const doc = await this.#listings.findOneAndDelete(filter);
    return doc ? toListing(doc) : null;
  }

  async credit(sellerId, { coins, ore }) {
    await this.#earnings.updateOne({ _id: sellerId }, { $inc: { coins, ore } }, { upsert: true });
  }

  async pending(sellerId) {
    const doc = await this.#earnings.findOne({ _id: sellerId });
    return doc ? { coins: doc.coins, ore: doc.ore } : { ...EMPTY_BALANCE };
  }

  async claim(sellerId) {
    const doc = await this.#earnings.findOneAndDelete({ _id: sellerId });
    return doc ? { coins: doc.coins, ore: doc.ore } : { ...EMPTY_BALANCE };
  }
}
