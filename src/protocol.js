// Tipos de mensagem do WebSocket. Espelhado (não compartilhado) em
// QUADRIX/src/services/MultiplayerService.js — qualquer mudança aqui precisa
// do mesmo ajuste lá.

// Cliente -> servidor
export const JOIN = 'join';
export const ACTIVITY = 'activity';
export const MOVE = 'move';
export const RENAME = 'rename';
export const SHOT = 'shot';
export const ENEMY_SPAWN = 'enemySpawn';
export const ENEMY_STATES = 'enemyStates';
export const ENEMY_DAMAGE = 'enemyDamage';
export const ENEMY_SHOT = 'enemyShot';
export const DROP_PICKUP = 'dropPickup';
// PvP e duelos (ver duels.js): ligar/desligar o PvP, convidar para duelo (o primeiro tiro no outro), responder ao convite, dano em duelo e
// a derrota de quem zerou a vida (cada cliente só declara a própria).
export const PVP_SET = 'pvpSet';
export const DUEL_REQUEST = 'duelRequest';
export const DUEL_REPLY = 'duelReply';
export const PVP_HIT = 'pvpHit';
export const DUEL_DEFEAT = 'duelDefeat';

// Servidor -> cliente
export const WELCOME = 'welcome';
export const PLAYER_JOIN = 'playerJoin';
export const PLAYER_LEAVE = 'playerLeave';
export const PLAYER_RENAME = 'playerRename';
export const TICK = 'tick';
export const REMOTE_SHOT = 'shot';
// Habilidade usada por um jogador (só visual para os outros, ver isValidSkill): o servidor repassa com o id de quem usou.
export const SKILL = 'skill';
export const REMOTE_SKILL = 'skill';
export const ENEMY_AUTHORITY = 'enemyAuthority';
export const ENEMY_DROP = 'enemyDrop';
export const DROP_COLLECTED = 'dropCollected';
export const PVP_STATE = 'pvpState';            // { id, on }: alguém ligou/desligou o PvP (também corrige quem tentou desligar sem poder)
export const DUEL_INVITE = 'duelInvite';        // { from, name }: para quem foi chamado
export const DUEL_INVITE_END = 'duelInviteEnd'; // { from, target, reason }: o convite acabou (recusado, expirou ou cancelado)
export const DUEL_START = 'duelStart';          // { a, b }: os dois entram em duelo
export const DUEL_END = 'duelEnd';              // { winnerId, loserId, reason, honorWin, honorLoss }
export const PLAYER_DAMAGE = 'playerDamage';    // { from, amount }: dano de duelo que a vítima aplica a si mesma

// A cada quantos ticks do servidor um jogador recebe x/y de novo (resync contra
// o drift do dead-reckoning do cliente). 10 ticks a 20 Hz = 500 ms.
export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Nível do jogador (quem o monstro mundial vigia é o de maior nível, ver PlanetScene.strongestPlayer).
function isLevel(value) {
  return Number.isInteger(value) && value >= 1 && value <= 999;
}

function isVector3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isValidEnemyState(enemy) {
  return enemy && typeof enemy.id === 'string' && enemy.id.length > 0 && enemy.id.length <= 120
    && isVector3(enemy.position)
    && isFiniteNumber(enemy.altitude) && enemy.altitude >= 0
    && isFiniteNumber(enemy.z) && enemy.z >= 0
    && isFiniteNumber(enemy.hp) && enemy.hp > 0;
}

function isValidDropOptions(options) {
  return options
    && Array.isArray(options.parts) && options.parts.length <= 256
    && options.parts.every((item) => item
      && ['center', 'wing', 'nose', 'engine'].includes(item.part)
      && typeof item.shipId === 'string' && item.shipId.length > 0 && item.shipId.length <= 80)
    && Array.isArray(options.chips) && options.chips.length <= 100
    && options.chips.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 80);
}

// Mensagem de join: nome e shipId livres (texto), mas sempre string e não vazios.
export function isValidJoin(payload) {
  return payload && typeof payload.room === 'string' && payload.room.length > 0
    && typeof payload.name === 'string' && typeof payload.shipId === 'string'
    && (!('identityId' in payload) || isValidIdentityId(payload.identityId))
    && (!('position' in payload) || isVector3(payload.position))
    && (!('forward' in payload) || isVector3(payload.forward))
    && (!('altitude' in payload) || (isFiniteNumber(payload.altitude) && payload.altitude >= 0))
    && (!('angle' in payload) || isFiniteNumber(payload.angle))
    && (!('speed' in payload) || (isFiniteNumber(payload.speed) && payload.speed >= 0))
    && (!('level' in payload) || isLevel(payload.level));
}

export function isValidIdentityId(identityId) {
  return typeof identityId === 'string' && identityId.length > 0 && identityId.length <= 320
    && /^(local|account):\S+$/.test(identityId);
}

export function isValidMove(payload) {
  return payload && isFiniteNumber(payload.angle) && isFiniteNumber(payload.speed) && payload.speed >= 0
    && (!('position' in payload) || isVector3(payload.position))
    && (!('forward' in payload) || isVector3(payload.forward))
    && (!('altitude' in payload) || (isFiniteNumber(payload.altitude) && payload.altitude >= 0))
    && (!('level' in payload) || isLevel(payload.level));
}

export function isValidRename(payload) {
  return payload && typeof payload.name === 'string'
    && payload.name.trim().length > 0 && payload.name.trim().length <= 24;
}

// Tiro do jogador: só para onde a nave apontava. `position` (onde o tiro nasce, [x, y, 0] em px da placa) e `forward` (direção, [cos, sen, 0]) vêm no
// referencial comum da placa, e o resto descreve o voo (velocidade em px/s, altura de saída e de chegada, subida em px/s, alcance em px).
// `bullet` e `index` dizem qual tiro do catálogo desenhar. Quem recebe calcula a trajetória; o servidor não segue o projétil.
export function isValidShot(payload) {
  return payload
    && typeof payload.shotId === 'string' && payload.shotId.length > 0 && payload.shotId.length <= 80
    && isVector3(payload.position) && isVector3(payload.forward)
    && isFiniteNumber(payload.speed) && payload.speed > 0 && payload.speed <= 10000
    && isFiniteNumber(payload.altitude) && payload.altitude >= 0
    && isFiniteNumber(payload.targetAltitude) && payload.targetAltitude >= 0
    && isFiniteNumber(payload.climb)
    && isFiniteNumber(payload.range) && payload.range > 0 && payload.range <= 20000
    && typeof payload.bullet === 'string' && payload.bullet.length > 0 && payload.bullet.length <= 40
    && Number.isInteger(payload.index) && payload.index >= 0 && payload.index < 16;
}

// Uso de uma habilidade: `skill` (id do catálogo), `position`/`forward` (ponto da placa e direção onde ela age, como no tiro),
// `altitude` de quem usou e `value` (o que ela vale no ponto atual). Quem recebe só desenha; o dano é de quem usou (ver duels.js).
export function isValidSkill(payload) {
  return payload
    && typeof payload.skill === 'string' && payload.skill.length > 0 && payload.skill.length <= 24
    && isVector3(payload.position) && isVector3(payload.forward)
    && isFiniteNumber(payload.altitude) && payload.altitude >= 0 && payload.altitude <= 10000
    && isFiniteNumber(payload.value) && payload.value >= 0 && payload.value <= 1000;
}

export function isValidEnemySpawn(payload) {
  return isValidEnemyState(payload)
    && typeof payload.skin === 'string' && payload.skin.length > 0 && payload.skin.length <= 80
    && isFiniteNumber(payload.maxHp) && payload.maxHp >= payload.hp
    && payload.spot && Number.isInteger(payload.spot.cell) && payload.spot.cell >= 0
    && typeof payload.spot.inside === 'boolean'
    && Number.isFinite(payload.spot.level) && payload.spot.level > 0
    && typeof payload.spot.type === 'string'
    && (!('dropOptions' in payload) || isValidDropOptions(payload.dropOptions));
}

export function isValidEnemyStates(payload) {
  return payload && Array.isArray(payload.enemies) && payload.enemies.length <= 256
    && payload.enemies.every(isValidEnemyState);
}

export function isValidEnemyDamage(payload) {
  return payload && typeof payload.id === 'string' && payload.id.length > 0 && payload.id.length <= 120
    && isFiniteNumber(payload.damage) && payload.damage > 0 && payload.damage <= 10000;
}

export function isValidPvpSet(payload) {
  return payload && typeof payload.on === 'boolean';
}

export function isValidDuelTarget(payload) {
  return payload && typeof payload.target === 'string' && payload.target.length > 0 && payload.target.length <= 80;
}

export function isValidDuelReply(payload) {
  return payload && typeof payload.from === 'string' && payload.from.length > 0 && payload.from.length <= 80 && typeof payload.accept === 'boolean';
}

export function isValidPvpHit(payload) {
  return isValidDuelTarget(payload) && isFiniteNumber(payload.damage) && payload.damage > 0 && payload.damage <= 5000;
}

export function isValidDropPickup(payload) {
  return payload && typeof payload.id === 'string' && payload.id.length > 0 && payload.id.length <= 120;
}

export function isValidEnemyShot(payload) {
  return payload && typeof payload.enemyId === 'string' && payload.enemyId.length > 0 && payload.enemyId.length <= 120
    && isVector3(payload.origin) && isVector3(payload.target)
    && isFiniteNumber(payload.speed) && payload.speed > 0 && payload.speed <= 10000
    && isFiniteNumber(payload.altitude) && payload.altitude >= 0
    && isFiniteNumber(payload.targetAltitude) && payload.targetAltitude >= 0;
}
