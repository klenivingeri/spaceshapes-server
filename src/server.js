import { WebSocketServer } from 'ws';
import { connectDb } from './db.js';
import { createHttpServer } from './httpServer.js';
import { MemoryInventoryStore, MongoInventoryStore, creditInventory } from './inventory.js';
import { MarketBoard } from './market.js';
import { RankingBoard, DEFAULT_REFRESH_MS } from './ranking.js';
import { MongoRankingStore } from './rankingStore.js';
import { RunLedger } from './runs.js';
import { MongoRunStore } from './runStore.js';
import { MongoMarketStore } from './marketStore.js';
import {
  ACTIVITY, DROP_PICKUP, DUEL_DEFEAT, DUEL_REPLY, DUEL_REQUEST, ENEMY_DAMAGE, ENEMY_SHOT, ENEMY_SPAWN, ENEMY_STATES, JOIN, MOVE, PVP_HIT, PVP_SET, RENAME, SHOT,
  isValidDropPickup, isValidDuelReply, isValidDuelTarget, isValidPvpHit, isValidPvpSet, isValidEnemyDamage, isValidEnemyShot, isValidEnemySpawn, isValidEnemyStates, isValidIdentityId, isValidJoin, isValidMove, isValidRename, isValidShot,
} from './protocol.js';
import { RoomRegistry } from './room.js';

const PORT = process.env.PORT || 8787;

// Mercado e inventário dos jogadores moram no MongoDB. Sem MONGODB_URI só funciona em memória (dev): em produção isso perderia tudo
// a cada reinício, então lá o servidor nem sobe.
const db = await connectDb();
if (!db) {
  if (process.env.NODE_ENV === 'production') throw new Error('MONGODB_URI não configurada: sem ela o inventário e o mercado não seriam salvos.');
  console.warn('[quadrix-server] MONGODB_URI não configurada: mercado e inventário só em memória (somem ao reiniciar).');
}
const inventory = db ? new MongoInventoryStore(db) : new MemoryInventoryStore();
// As salas creditam ao inventário o fragmento que o jogador pegou (o sorteio é do servidor, ver room.js).
const registry = new RoomRegistry({ onLoot: (identityId, item) => creditInventory(inventory, identityId, [item]) });
const httpServer = createHttpServer({
  market: new MarketBoard(db ? new MongoMarketStore(db) : undefined),
  inventory,
  runs: new RunLedger(db ? new MongoRunStore(db) : undefined),
  // O ranking é refeito a cada RANKING_REFRESH_HOURS horas (padrão 3).
  ranking: new RankingBoard(db ? new MongoRankingStore(db) : undefined, { refreshMs: Number(process.env.RANKING_REFRESH_HOURS) * 3_600_000 || DEFAULT_REFRESH_MS }),
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  // Preenchidos só depois do `join` — até lá a conexão não pertence a sala nenhuma.
  let room = null;
  let playerId = null;

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.t === JOIN) {
      if (room || !isValidJoin(message)) return; // já entrou, ou payload inválido
      room = registry.assign(message.room);
      playerId = room.join(ws, {
        name: message.name,
        shipId: message.shipId,
        identityId: message.identityId,
        position: message.position,
        forward: message.forward,
        angle: message.angle,
        speed: message.speed,
        altitude: message.altitude,
        level: message.level,
      });
      return;
    }
    if (!room || !playerId) return; // mensagens antes do join não valem
    if (message.t === ACTIVITY) {
      room.handleActivity(playerId);
    } else if (message.t === RENAME && isValidRename(message)) {
      room.handleRename(playerId, message.name.trim());
    } else if (message.t === MOVE && isValidMove(message)) {
      room.handleMove(playerId, {
        position: message.position,
        forward: message.forward,
        angle: message.angle,
        speed: message.speed,
        altitude: message.altitude,
        level: message.level,
      });
    } else if (message.t === SHOT && isValidShot(message)) {
      room.handleShot(playerId, message);
    } else if (message.t === ENEMY_SPAWN && isValidEnemySpawn(message.enemy)) {
      room.handleEnemySpawn(playerId, message.enemy);
    } else if (message.t === ENEMY_STATES && isValidEnemyStates(message)) {
      room.handleEnemyStates(playerId, message.enemies);
    } else if (message.t === ENEMY_DAMAGE && isValidEnemyDamage(message)) {
      room.handleEnemyDamage(playerId, message);
    } else if (message.t === DROP_PICKUP && isValidDropPickup(message)) {
      room.handleDropPickup(playerId, message.id);
    } else if (message.t === ENEMY_SHOT && isValidEnemyShot(message.shot)) {
      room.handleEnemyShot(playerId, message.shot);
    } else if (message.t === PVP_SET && isValidPvpSet(message)) {
      room.duels.setPvp(playerId, message.on);
    } else if (message.t === DUEL_REQUEST && isValidDuelTarget(message)) {
      room.duels.request(playerId, message.target);
    } else if (message.t === DUEL_REPLY && isValidDuelReply(message)) {
      room.duels.reply(playerId, message.from, message.accept);
    } else if (message.t === PVP_HIT && isValidPvpHit(message)) {
      room.duels.hit(playerId, message.target, message.damage);
    } else if (message.t === DUEL_DEFEAT) {
      room.duels.defeat(playerId);
    }
  });

  ws.on('close', () => {
    if (!room || !playerId) return;
    room.leave(playerId);
    registry.disposeIfEmpty(room);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[quadrix-server] ouvindo na porta ${PORT}`);
});
