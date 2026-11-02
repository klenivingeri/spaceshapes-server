// Tipos de mensagem do WebSocket. Espelhado (não compartilhado) em
// QUADRIX/src/services/MultiplayerService.js — qualquer mudança aqui precisa
// do mesmo ajuste lá.

// Cliente -> servidor
export const JOIN = 'join';
export const MOVE = 'move';
export const SHOT = 'shot';

// Servidor -> cliente
export const WELCOME = 'welcome';
export const PLAYER_JOIN = 'playerJoin';
export const PLAYER_LEAVE = 'playerLeave';
export const TICK = 'tick';
export const REMOTE_SHOT = 'shot';
export const HIT = 'hit';

// A cada quantos ticks do servidor um jogador recebe x/y de novo (resync contra
// o drift do dead-reckoning do cliente). 10 ticks a 20 Hz = 500 ms.
export const RESYNC_EVERY_TICKS = 10;

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Mensagem de join: nome e shipId livres (texto), mas sempre string e não vazios.
export function isValidJoin(payload) {
  return payload && typeof payload.room === 'string' && payload.room.length > 0
    && typeof payload.name === 'string' && typeof payload.shipId === 'string';
}

export function isValidMove(payload) {
  return payload && isFiniteNumber(payload.angle) && isFiniteNumber(payload.speed) && payload.speed >= 0;
}

export function isValidShot(payload) {
  return payload
    && isFiniteNumber(payload.angle)
    && isFiniteNumber(payload.originX)
    && isFiniteNumber(payload.originY)
    && isFiniteNumber(payload.bulletSpeed)
    && typeof payload.shotId === 'string' && payload.shotId.length > 0;
}
