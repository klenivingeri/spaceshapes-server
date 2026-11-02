import { randomUUID } from 'node:crypto';
import { HIT, PLAYER_JOIN, PLAYER_LEAVE, REMOTE_SHOT, RESYNC_EVERY_TICKS, TICK, WELCOME } from './protocol.js';

const TICK_MS = 50; // 20 Hz
const SPAWN_SCATTER = 200;
const HIT_RADIUS = 24; // px: raio de acerto contra a posição autoritativa do alvo
const SHOT_MAX_LIFETIME_MS = 2000;
const SHOT_DAMAGE = 10;
const START_HP = 100;

function sendJson(ws, message) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

export class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map(); // id -> { ws, name, shipId, x, y, angle, speed, hp }
    this.pendingShots = []; // { shotId, ownerId, angle, x, y, bulletSpeed, bornAt }
    this.tickCount = 0;
    this.interval = setInterval(() => this.tick(), TICK_MS);
  }

  isEmpty() {
    return this.players.size === 0;
  }

  dispose() {
    clearInterval(this.interval);
  }

  publicPlayer(id) {
    const player = this.players.get(id);
    return { id, name: player.name, shipId: player.shipId, x: player.x, y: player.y, angle: player.angle, speed: player.speed, hp: player.hp };
  }

  join(ws, { name, shipId }) {
    const id = randomUUID();
    const angle = Math.random() * Math.PI * 2;
    this.players.set(id, {
      ws, name, shipId,
      x: (Math.random() - 0.5) * SPAWN_SCATTER,
      y: (Math.random() - 0.5) * SPAWN_SCATTER,
      angle, speed: 0, hp: START_HP,
    });
    sendJson(ws, { t: WELCOME, selfId: id, players: [...this.players.keys()].filter((otherId) => otherId !== id).map((otherId) => this.publicPlayer(otherId)) });
    this.broadcast({ t: PLAYER_JOIN, ...this.publicPlayer(id) }, id);
    return id;
  }

  leave(id) {
    if (!this.players.has(id)) return;
    this.players.delete(id);
    this.pendingShots = this.pendingShots.filter((shot) => shot.ownerId !== id);
    this.broadcast({ t: PLAYER_LEAVE, id });
  }

  handleMove(id, { angle, speed }) {
    const player = this.players.get(id);
    if (!player) return;
    player.angle = angle;
    player.speed = speed;
  }

  handleShot(id, { angle, originX, originY, bulletSpeed, shotId }) {
    if (!this.players.has(id)) return;
    this.pendingShots.push({ shotId, ownerId: id, angle, x: originX, y: originY, bulletSpeed, bornAt: Date.now() });
    this.broadcast({ t: REMOTE_SHOT, id, angle, originX, originY, bulletSpeed, shotId }, id);
  }

  // Avança os tiros pendentes `dtMs` e aplica dano em quem a trajetória alcançar.
  advanceShots(dtMs) {
    const survivors = [];
    for (const shot of this.pendingShots) {
      const age = Date.now() - shot.bornAt;
      if (age > SHOT_MAX_LIFETIME_MS) continue;
      shot.x += Math.cos(shot.angle) * shot.bulletSpeed * (dtMs / 1000);
      shot.y += Math.sin(shot.angle) * shot.bulletSpeed * (dtMs / 1000);
      const target = this.findHit(shot);
      if (target) {
        target.player.hp = Math.max(0, target.player.hp - SHOT_DAMAGE);
        this.broadcast({ t: HIT, shotId: shot.shotId, targetId: target.id, damage: SHOT_DAMAGE, targetHp: target.player.hp });
        continue; // consumido pelo acerto
      }
      survivors.push(shot);
    }
    this.pendingShots = survivors;
  }

  findHit(shot) {
    for (const [id, player] of this.players) {
      if (id === shot.ownerId) continue;
      const dx = player.x - shot.x;
      const dy = player.y - shot.y;
      if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) return { id, player };
    }
    return null;
  }

  tick() {
    const dtMs = TICK_MS;
    const dt = dtMs / 1000;
    for (const player of this.players.values()) {
      player.x += Math.cos(player.angle) * player.speed * dt;
      player.y += Math.sin(player.angle) * player.speed * dt;
    }
    this.advanceShots(dtMs);
    this.tickCount += 1;
    const resync = this.tickCount % RESYNC_EVERY_TICKS === 0;
    const players = [...this.players.entries()].map(([id, player]) => (
      resync
        ? { id, angle: player.angle, speed: player.speed, x: player.x, y: player.y }
        : { id, angle: player.angle, speed: player.speed }
    ));
    if (players.length) this.broadcast({ t: TICK, players });
  }

  broadcast(message, skipId = null) {
    const json = JSON.stringify(message);
    for (const [id, player] of this.players) {
      if (id === skipId) continue;
      if (player.ws.readyState === player.ws.OPEN) player.ws.send(json);
    }
  }
}

export class RoomRegistry {
  constructor() {
    this.rooms = new Map();
  }

  get(roomId) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId);
      this.rooms.set(roomId, room);
    }
    return room;
  }

  disposeIfEmpty(room) {
    if (!room.isEmpty()) return;
    room.dispose();
    this.rooms.delete(room.id);
  }
}
