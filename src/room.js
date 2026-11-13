import { randomUUID } from 'node:crypto';
import { rollFamily } from './loot.js';
import data from './gameData.json' with { type: 'json' };
import { Duels } from './duels.js';
import { DROP_COLLECTED, ENEMY_AUTHORITY, ENEMY_DAMAGE, ENEMY_DROP, ENEMY_SHOT, ENEMY_SPAWN, ENEMY_STATES, PLAYER_JOIN, PLAYER_LEAVE, PLAYER_RENAME, REMOTE_SHOT, REMOTE_SKILL, TICK, WELCOME } from './protocol.js';

const TICK_MS = 50; // 20 Hz
const IDLE_TIMEOUT_MS = 300_000;
// Vigia do host dos inimigos (ver watchEnemyHost): ele manda `enemyStates` a cada 100 ms. Passar de HOST_LATE_MS sem mandar é um atraso;
// HOST_MAX_LATE atrasos em HOST_LATE_WINDOW_MS, ou HOST_SILENT_MS de silêncio, tiram o papel dele.
const HOST_LATE_MS = 500;
const HOST_SILENT_MS = 2000;
const HOST_MAX_LATE = 3;
const HOST_LATE_WINDOW_MS = 10_000;
const START_HP = 100;
const MAX_ROOM_ENEMIES = 512;
const DROP_OWNER_WINDOW_MS = 10_000;
const SESSION_REPLACED_CODE = 4002;
const SESSION_REPLACED_REASON = 'session replaced';

function sendJson(ws, message) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

export class Room {
  // `onLoot(identityId, item)`: o servidor credita ao inventário o fragmento que o jogador pegou (ver server.js).
  constructor(id, { onLoot = null } = {}) {
    this.id = id;
    this.onLoot = onLoot;
    this.players = new Map(); // id -> { ws, name, shipId, position, forward, altitude, x, y, angle, speed, hp }
    this.enemyAuthorityId = null;
    this.hostWatch = { hostId: null, lastStatesAt: 0, stalled: false, lateAt: [] };
    this.enemies = new Map();
    this.drops = new Map();
    this.duels = new Duels(this);
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
      level: player.level,
      hp: player.hp,
      pvp: this.duels.isOn(id),
    };
  }

  send(id, message) {
    const player = this.players.get(id);
    if (player) sendJson(player.ws, message);
  }

  join(ws, {
    name, shipId, identityId, position = [0, 0, 1], forward = [1, 0, 0], altitude = 0, angle = 0, speed = 0, level = 1,
  }) {
    this.evictDuplicateIdentity(identityId);
    const id = randomUUID();
    const previousAuthorityId = this.enemyAuthorityId;
    const assignsEnemyAuthority = !previousAuthorityId || this.enemies.size === 0;
    if (assignsEnemyAuthority) this.enemyAuthorityId = id;
    this.players.set(id, {
      ws, name, shipId, identityId, position, forward, altitude,
      x: 0, y: 0, angle, speed, level, hp: START_HP, lastActivityAt: Date.now(), closingForIdle: false,
    });
    sendJson(ws, {
      t: WELCOME,
      selfId: id,
      isEnemyHost: this.enemyAuthorityId === id,
      players: [...this.players.keys()].filter((otherId) => otherId !== id).map((otherId) => this.publicPlayer(otherId)),
      enemies: [...this.enemies.values()].filter((enemy) => enemy.alive),
      drops: [...this.drops.values()].map((drop) => this.publicDrop(drop)),
    });
    this.broadcast({ t: PLAYER_JOIN, ...this.publicPlayer(id) }, id);
    if (assignsEnemyAuthority && previousAuthorityId) {
      this.broadcast({ t: ENEMY_AUTHORITY, id });
    }
    return id;
  }

  leave(id) {
    if (!this.players.has(id)) return;
    this.duels.leave(id);
    this.players.delete(id);
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
    this.hostWatch.lastStatesAt = Date.now();
    this.hostWatch.stalled = false;
    const accepted = [];
    for (const state of states) {
      const enemy = this.enemies.get(state.id);
      if (!enemy?.alive) continue;
      Object.assign(enemy, {
        position: state.position,
        forward: state.forward,
        altitude: state.altitude,
        z: state.z,
        hp: Math.min(enemy.hp, state.hp),
      });
      accepted.push({ ...state, hp: enemy.hp });
    }
    if (accepted.length) this.broadcast({ t: ENEMY_STATES, enemies: accepted }, id);
  }

  handleEnemyDamage(id, { id: enemyId, damage }) {
    const enemy = this.enemies.get(enemyId);
    if (!enemy?.alive) return;
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.alive = enemy.hp > 0;
    this.broadcast({ t: ENEMY_DAMAGE, id: enemyId, damage, hp: enemy.hp, killerId: id, dead: !enemy.alive });
    if (!enemy.alive) {
      this.enemies.delete(enemyId);
      this.createEnemyDrops(enemy, id);
    }
  }

  createEnemyDrops(enemy, ownerId) {
    // A família do fragmento vem da tabela do servidor (loot.js), nunca da lista que o cliente mandou em `dropOptions`.
    if (!enemy.dropOptions || Math.random() >= data.fragmentChance.enemy) return;
    this.createDrop(enemy, ownerId, { partDrop: { part: 'center', shipId: rollFamily() } });
  }

  createDrop(enemy, ownerId, item) {
    const drop = {
      id: randomUUID(),
      ...item,
      position: [...enemy.position],
      altitude: enemy.altitude,
      ownerId,
      ownerUntil: Date.now() + DROP_OWNER_WINDOW_MS,
    };
    this.drops.set(drop.id, drop);
    this.broadcast({ t: ENEMY_DROP, drop: this.publicDrop(drop) });
  }

  publicDrop(drop) {
    return {
      id: drop.id,
      partDrop: drop.partDrop,
      position: drop.position,
      altitude: drop.altitude,
      ownerId: drop.ownerId,
      ownerRemainingMs: Math.max(0, drop.ownerUntil - Date.now()),
    };
  }

  handleDropPickup(playerId, dropId) {
    const drop = this.drops.get(dropId);
    if (!drop || (playerId !== drop.ownerId && Date.now() < drop.ownerUntil)) return;
    this.drops.delete(dropId);
    this.creditPickup(playerId, drop);
    this.broadcast({ t: DROP_COLLECTED, id: dropId, pickerId: playerId });
  }

  // Quem pegou o fragmento ganha o crédito no inventário do servidor; sem identidade (conexão sem conta nem visitante) não há onde creditar.
  creditPickup(playerId, drop) {
    const identityId = this.players.get(playerId)?.identityId;
    if (!identityId || !this.onLoot) return;
    Promise.resolve(this.onLoot(identityId, { kind: 'fragment', family: drop.partDrop.shipId })).catch((error) => console.error('[quadrix-server] falha ao creditar drop da sala:', error));
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

  evictDuplicateIdentity(identityId, exceptId = null) {
    if (!identityId) return;
    for (const [id, player] of this.players) {
      if (id === exceptId || player.identityId !== identityId) continue;
      player.ws.close(SESSION_REPLACED_CODE, SESSION_REPLACED_REASON);
      this.leave(id);
      return;
    }
  }

  handleMove(id, { position, forward, angle, speed, altitude, level }) {
    const player = this.players.get(id);
    if (!player) return;
    if (position) player.position = position;
    if (forward) player.forward = forward;
    if (altitude !== undefined) player.altitude = altitude;
    player.angle = angle;
    player.speed = speed;
    if (level !== undefined) player.level = level;
  }

  handleActivity(id) {
    const player = this.players.get(id);
    if (player) player.lastActivityAt = Date.now();
  }

  // A habilidade de um jogador é só repassada aos outros, para eles a desenharem (no máximo uma a cada SKILL_MIN_GAP_MS por jogador).
  handleSkill(id, skill) {
    const player = this.players.get(id);
    const now = Date.now();
    if (!player || now - (player.lastSkillAt ?? 0) < SKILL_MIN_GAP_MS) return;
    player.lastSkillAt = now;
    this.broadcast({ t: REMOTE_SKILL, id, skill: skill.skill, position: skill.position, forward: skill.forward, altitude: skill.altitude, value: skill.value }, id);
  }

  // O tiro do jogador é só repassado aos outros, com para onde a nave apontava (ver isValidShot): quem recebe calcula a trajetória.
  handleShot(id, shot) {
    if (!this.players.has(id)) return;
    this.broadcast({
      t: REMOTE_SHOT,
      id,
      shotId: shot.shotId,
      position: shot.position,
      forward: shot.forward,
      speed: shot.speed,
      altitude: shot.altitude,
      targetAltitude: shot.targetAltitude,
      climb: shot.climb,
      range: shot.range,
      bullet: shot.bullet,
      index: shot.index,
    }, id);
  }

  hasAliveEnemy() {
    for (const enemy of this.enemies.values()) if (enemy.alive) return true;
    return false;
  }

  // Quem simula os inimigos é o host (um jogador); o servidor só retransmite. Host travado ou com lag congelaria os inimigos de todos, então
  // o servidor mede o intervalo entre os `enemyStates` dele e passa o papel adiante. Só vale com alguém para assumir e inimigo vivo (sem
  // inimigo o host não tem o que mandar).
  watchEnemyHost(now) {
    const watch = this.hostWatch;
    if (watch.hostId !== this.enemyAuthorityId) Object.assign(watch, { hostId: this.enemyAuthorityId, lastStatesAt: now, stalled: false, lateAt: [] });
    if (this.players.size < 2 || !this.hasAliveEnemy()) {
      watch.lastStatesAt = now;
      watch.stalled = false;
      return;
    }
    const silent = now - watch.lastStatesAt;
    if (silent > HOST_SILENT_MS) return this.replaceEnemyHost();
    if (silent <= HOST_LATE_MS || watch.stalled) return;
    watch.stalled = true;   // uma parada conta um atraso só, por mais que dure
    watch.lateAt = watch.lateAt.filter((at) => now - at < HOST_LATE_WINDOW_MS);
    watch.lateAt.push(now);
    if (watch.lateAt.length >= HOST_MAX_LATE) this.replaceEnemyHost();
  }

  // Passa o papel de host a outro jogador (o de atividade mais recente; o servidor não mede latência). Os inimigos são recriados pelo novo
  // host, como quando o antigo sai; o antigo continua na sala e recebe o `enemyAuthority` como todos.
  replaceEnemyHost() {
    const oldId = this.enemyAuthorityId;
    let next = null;
    for (const [id, player] of this.players) {
      if (id === oldId) continue;
      if (next === null || player.lastActivityAt > this.players.get(next).lastActivityAt) next = id;
    }
    if (next === null) return;
    this.enemies.clear();
    this.enemyAuthorityId = next;
    this.broadcast({ t: ENEMY_AUTHORITY, id: next });
  }

  tick() {
    const now = Date.now();
    this.watchEnemyHost(now);
    this.duels.tick(now);
    for (const player of this.players.values()) {
      if (player.closingForIdle || now - player.lastActivityAt < IDLE_TIMEOUT_MS) continue;
      player.closingForIdle = true;
      player.ws.close(4000, 'idle timeout');
    }
    const dtMs = TICK_MS;
    const dt = dtMs / 1000;
    for (const player of this.players.values()) {
      player.x += Math.cos(player.angle) * player.speed * dt;
      player.y += Math.sin(player.angle) * player.speed * dt;
    }
    const players = [...this.players.entries()].map(([id, player]) => ({
      id,
      position: player.position,
      forward: player.forward,
      altitude: player.altitude,
      angle: player.angle,
      speed: player.speed,
      level: player.level,
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

const SKILL_MIN_GAP_MS = 100;

// Vagas por sala: passou disso, o jogador cai numa cópia nova do mesmo mapa (`mapa#2`), como os servidores do Roblox.
export const MAX_ROOM_PLAYERS = Number(process.env.MAX_ROOM_PLAYERS) || 20;

export class RoomRegistry {
  constructor(roomOptions = {}, { maxPlayers = MAX_ROOM_PLAYERS } = {}) {
    this.roomOptions = roomOptions;
    this.maxPlayers = maxPlayers;
    this.rooms = new Map();
  }

  // A sala do mapa `mapId` com vaga: a primeira cópia (`mapa#1`, `mapa#2`...) que não está cheia; se todas estão, abre a próxima. Cópias
  // vazias são apagadas (disposeIfEmpty), então o número mais baixo livre é sempre reaproveitado.
  assign(mapId) {
    for (let copy = 1; ; copy++) {
      const room = this.get(`${mapId}#${copy}`);
      if (room.players.size < this.maxPlayers) return room;
    }
  }

  get(roomId) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId, this.roomOptions);
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
