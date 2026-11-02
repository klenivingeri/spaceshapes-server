import { randomUUID } from 'node:crypto';
import { ENEMY_AUTHORITY, ENEMY_DAMAGE, ENEMY_SHOT, ENEMY_SPAWN, ENEMY_STATES, HIT, PLAYER_JOIN, PLAYER_LEAVE, PLAYER_RENAME, REMOTE_SHOT, TICK, WELCOME } from './protocol.js';

const TICK_MS = 50; // 20 Hz
const HIT_RADIUS = 24; // px: raio de acerto contra a posição autoritativa do alvo
const SHOT_MAX_LIFETIME_MS = 2000;
const SHOT_DAMAGE = 10;
const START_HP = 100;
const MAX_ROOM_ENEMIES = 512;

function sendJson(ws, message) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

export class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map(); // id -> { ws, name, shipId, position, forward, altitude, x, y, angle, speed, hp }
    this.enemyAuthorityId = null;
    this.enemies = new Map();
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
    return {
      id,
      name: player.name,
      shipId: player.shipId,
      position: player.position,
      forward: player.forward,
      altitude: player.altitude,
      x: player.x,
      y: player.y,
      angle: player.angle,
      speed: player.speed,
      hp: player.hp,
    };
  }

  join(ws, { name, shipId, position = [0, 0, 1], forward = [1, 0, 0], altitude = 0, angle = 0, speed = 0 }) {
    const id = randomUUID();
    if (!this.enemyAuthorityId) this.enemyAuthorityId = id;
    this.players.set(id, {
      ws, name, shipId, position, forward, altitude,
      x: 0, y: 0, angle, speed, hp: START_HP,
    });
    sendJson(ws, {
      t: WELCOME,
      selfId: id,
      isEnemyHost: this.enemyAuthorityId === id,
      players: [...this.players.keys()].filter((otherId) => otherId !== id).map((otherId) => this.publicPlayer(otherId)),
      enemies: [...this.enemies.values()].filter((enemy) => enemy.alive),
    });
    this.broadcast({ t: PLAYER_JOIN, ...this.publicPlayer(id) }, id);
    return id;
  }

  leave(id) {
    if (!this.players.has(id)) return;
    this.players.delete(id);
    this.pendingShots = this.pendingShots.filter((shot) => shot.ownerId !== id);
    this.broadcast({ t: PLAYER_LEAVE, id });
    if (this.enemyAuthorityId === id) {
      this.enemies.clear();
      this.enemyAuthorityId = this.players.keys().next().value ?? null;
      if (this.enemyAuthorityId) this.broadcast({ t: ENEMY_AUTHORITY, id: this.enemyAuthorityId });
    }
  }

  handleEnemySpawn(id, payload) {
    if (id !== this.enemyAuthorityId || this.enemies.size >= MAX_ROOM_ENEMIES || this.enemies.has(payload.id)) return;
    const enemy = { ...payload, spot: { ...payload.spot }, alive: true };
    this.enemies.set(enemy.id, enemy);
    this.broadcast({ t: ENEMY_SPAWN, enemy }, id);
  }

  handleEnemyStates(id, states) {
    if (id !== this.enemyAuthorityId) return;
    const accepted = [];
    for (const state of states) {
      const enemy = this.enemies.get(state.id);
      if (!enemy?.alive) continue;
      Object.assign(enemy, {
        position: state.position,
        forward: state.forward,
        altitude: state.altitude,
        radius: state.radius,
        hp: Math.min(enemy.maxHp, state.hp),
      });
      accepted.push(state);
    }
    if (accepted.length) this.broadcast({ t: ENEMY_STATES, enemies: accepted }, id);
  }

  handleEnemyDamage(id, { id: enemyId, damage }) {
    const enemy = this.enemies.get(enemyId);
    if (!enemy?.alive) return;
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.alive = enemy.hp > 0;
    this.broadcast({ t: ENEMY_DAMAGE, id: enemyId, damage, hp: enemy.hp, killerId: id, dead: !enemy.alive });
    if (!enemy.alive) this.enemies.delete(enemyId);
  }

  handleEnemyShot(id, shot) {
    if (id !== this.enemyAuthorityId || !this.enemies.get(shot.enemyId)?.alive) return;
    this.broadcast({ t: ENEMY_SHOT, shot }, id);
  }

  handleRename(id, name) {
    const player = this.players.get(id);
    if (!player || player.name === name) return;
    player.name = name;
    this.broadcast({ t: PLAYER_RENAME, id, name });
  }

  handleMove(id, { position, forward, angle, speed, altitude }) {
    const player = this.players.get(id);
    if (!player) return;
    if (position) player.position = position;
    if (forward) player.forward = forward;
    if (altitude !== undefined) player.altitude = altitude;
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
    const players = [...this.players.entries()].map(([id, player]) => ({
      id,
      position: player.position,
      forward: player.forward,
      altitude: player.altitude,
      angle: player.angle,
      speed: player.speed,
      x: player.x,
      y: player.y,
    }));
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
