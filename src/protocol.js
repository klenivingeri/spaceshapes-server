// Tipos de mensagem do WebSocket. Espelhado (não compartilhado) em
// QUADRIX/src/services/MultiplayerService.js — qualquer mudança aqui precisa
// do mesmo ajuste lá.

// Cliente -> servidor
export const JOIN = 'join';
export const MOVE = 'move';
export const RENAME = 'rename';
export const SHOT = 'shot';
export const ENEMY_SPAWN = 'enemySpawn';
export const ENEMY_STATES = 'enemyStates';
export const ENEMY_DAMAGE = 'enemyDamage';
export const ENEMY_SHOT = 'enemyShot';

// Servidor -> cliente
export const WELCOME = 'welcome';
export const PLAYER_JOIN = 'playerJoin';
export const PLAYER_LEAVE = 'playerLeave';
export const PLAYER_RENAME = 'playerRename';
export const TICK = 'tick';
export const REMOTE_SHOT = 'shot';
export const HIT = 'hit';
export const ENEMY_AUTHORITY = 'enemyAuthority';

// A cada quantos ticks do servidor um jogador recebe x/y de novo (resync contra
// o drift do dead-reckoning do cliente). 10 ticks a 20 Hz = 500 ms.
export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVector3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isValidEnemyState(enemy) {
  return enemy && typeof enemy.id === 'string' && enemy.id.length > 0 && enemy.id.length <= 120
    && isVector3(enemy.position)
    && isFiniteNumber(enemy.altitude) && enemy.altitude >= 0
    && isFiniteNumber(enemy.radius) && enemy.radius > 0
    && isFiniteNumber(enemy.hp) && enemy.hp > 0;
}

// Mensagem de join: nome e shipId livres (texto), mas sempre string e não vazios.
export function isValidJoin(payload) {
  return payload && typeof payload.room === 'string' && payload.room.length > 0
    && typeof payload.name === 'string' && typeof payload.shipId === 'string'
    && (!('position' in payload) || isVector3(payload.position))
    && (!('forward' in payload) || isVector3(payload.forward))
    && (!('altitude' in payload) || (isFiniteNumber(payload.altitude) && payload.altitude >= 0))
    && (!('angle' in payload) || isFiniteNumber(payload.angle))
    && (!('speed' in payload) || (isFiniteNumber(payload.speed) && payload.speed >= 0));
}

export function isValidMove(payload) {
  return payload && isFiniteNumber(payload.angle) && isFiniteNumber(payload.speed) && payload.speed >= 0
    && (!('position' in payload) || isVector3(payload.position))
    && (!('forward' in payload) || isVector3(payload.forward))
    && (!('altitude' in payload) || (isFiniteNumber(payload.altitude) && payload.altitude >= 0));
}

export function isValidRename(payload) {
  return payload && typeof payload.name === 'string'
    && payload.name.trim().length > 0 && payload.name.trim().length <= 24;
}

export function isValidShot(payload) {
  return payload
    && isFiniteNumber(payload.angle)
    && isFiniteNumber(payload.originX)
    && isFiniteNumber(payload.originY)
    && isFiniteNumber(payload.bulletSpeed)
    && typeof payload.shotId === 'string' && payload.shotId.length > 0;
}

export function isValidEnemySpawn(payload) {
  return isValidEnemyState(payload)
    && typeof payload.skin === 'string' && payload.skin.length > 0 && payload.skin.length <= 80
    && isFiniteNumber(payload.maxHp) && payload.maxHp >= payload.hp
    && payload.spot && Number.isInteger(payload.spot.cell) && payload.spot.cell >= 0
    && typeof payload.spot.inside === 'boolean'
    && Number.isInteger(payload.spot.airspace)
    && Number.isFinite(payload.spot.level) && payload.spot.level > 0
    && typeof payload.spot.type === 'string';
}

export function isValidEnemyStates(payload) {
  return payload && Array.isArray(payload.enemies) && payload.enemies.length <= 256
    && payload.enemies.every(isValidEnemyState);
}

export function isValidEnemyDamage(payload) {
  return payload && typeof payload.id === 'string' && payload.id.length > 0 && payload.id.length <= 120
    && isFiniteNumber(payload.damage) && payload.damage > 0 && payload.damage <= 10000;
}

export function isValidEnemyShot(payload) {
  return payload && typeof payload.enemyId === 'string' && payload.enemyId.length > 0 && payload.enemyId.length <= 120
    && isVector3(payload.origin) && isVector3(payload.target)
    && isFiniteNumber(payload.speed) && payload.speed > 0 && payload.speed <= 10000
    && isFiniteNumber(payload.altitude) && payload.altitude >= 0
    && isFiniteNumber(payload.targetAltitude) && payload.targetAltitude >= 0
    && Number.isInteger(payload.airspace) && payload.airspace >= -1 && payload.airspace <= 8;
}
