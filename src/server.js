import { WebSocketServer } from 'ws';
import { createHttpServer } from './httpServer.js';
import {
  ACTIVITY, DROP_PICKUP, ENEMY_DAMAGE, ENEMY_SHOT, ENEMY_SPAWN, ENEMY_STATES, JOIN, MOVE, RENAME, SHOT,
  isValidDropPickup, isValidEnemyDamage, isValidEnemyShot, isValidEnemySpawn, isValidEnemyStates, isValidIdentityId, isValidJoin, isValidMove, isValidRename, isValidShot,
} from './protocol.js';
import { RoomRegistry } from './room.js';

const PORT = process.env.PORT || 8787;
const registry = new RoomRegistry();

const httpServer = createHttpServer();

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
      room = registry.get(message.room);
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
