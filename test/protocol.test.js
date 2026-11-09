import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDropPickup, isValidEnemyDamage, isValidEnemyShot, isValidEnemySpawn, isValidEnemyStates, isValidIdentityId, isValidJoin, isValidMove, isValidRename, isValidShot,
} from '../src/protocol.js';

test('join e move aceitam posição 3D e vetor do bico', () => {
  const state = {
    position: [0.3, 0.4, 0.8660254],
    forward: [0, 1, 0],
    angle: Math.PI / 2,
    speed: 50,
    altitude: 12,
  };

  assert.equal(isValidJoin({ room: 'world', name: 'A', shipId: 'ship', ...state }), true);
  assert.equal(isValidJoin({ room: 'world', name: 'A', shipId: 'ship', identityId: 'account:a@example.com', ...state }), true);
  assert.equal(isValidJoin({ room: 'world', name: 'A', shipId: 'ship', identityId: 'invalid id', ...state }), false);
  assert.equal(isValidIdentityId('account:uuid-1'), true);
  assert.equal(isValidIdentityId('local:uuid-1'), true);
  assert.equal(isValidIdentityId('google:uuid-1'), false);
  assert.equal(isValidMove(state), true);
  assert.equal(isValidMove({ ...state, position: [0, 1] }), false);
  assert.equal(isValidMove({ ...state, altitude: -1 }), false);
  assert.equal(isValidRename({ name: 'Novo nome' }), true);
  assert.equal(isValidRename({ name: '  ' }), false);
  assert.equal(isValidRename({ name: 'x'.repeat(25) }), false);
});

test('validates spawn, state and damage for shared enemies', () => {
  const enemy = {
    id: 'host:1',
    skin: 'orb_plasma',
    position: [0.3, 0.4, 0.8660254],
    altitude: 0,
    radius: 1,
    hp: 3,
    maxHp: 3,
    spot: { cell: 2, inside: false, airspace: -1, level: 1, type: 'chase' },
  };

  assert.equal(isValidEnemySpawn(enemy), true);
  assert.equal(isValidEnemySpawn({
    ...enemy,
    dropOptions: { parts: [{ part: 'engine', shipId: 'ship-1' }], chips: ['turbo'] },
  }), true);
  assert.equal(isValidEnemySpawn({
    ...enemy,
    dropOptions: { parts: [{ part: 'invalid', shipId: 'ship-1' }], chips: ['turbo'] },
  }), false);
  assert.equal(isValidEnemySpawn({ ...enemy, spot: { ...enemy.spot, cell: -1 } }), false);
  assert.equal(isValidEnemyStates({ enemies: [{ ...enemy, skin: undefined, maxHp: undefined, spot: undefined }] }), true);
  assert.equal(isValidEnemyStates({ enemies: [{ ...enemy, position: [0, 1] }] }), false);
  assert.equal(isValidEnemyDamage({ id: enemy.id, damage: 1 }), true);
  assert.equal(isValidEnemyDamage({ id: enemy.id, damage: -1 }), false);
  assert.equal(isValidDropPickup({ id: 'drop-1' }), true);
  assert.equal(isValidDropPickup({ id: '' }), false);
  assert.equal(isValidEnemyShot({
    enemyId: enemy.id, origin: enemy.position, target: [0.4, 0.3, 0.8660254],
    speed: 120, altitude: 0, targetAltitude: 10, airspace: -1,
  }), true);
  assert.equal(isValidEnemyShot({
    enemyId: enemy.id, origin: [0, 0], target: enemy.position,
    speed: 120, altitude: 0, targetAltitude: 10, airspace: -1,
  }), false);
});

test('join e move aceitam o nível do jogador (inteiro de 1 a 999)', () => {
  const state = { position: [0, 0, 1], forward: [1, 0, 0], angle: 0, speed: 0, altitude: 0 };
  assert.equal(isValidMove({ ...state, level: 12 }), true);
  assert.equal(isValidMove({ ...state, level: 0 }), false);
  assert.equal(isValidMove({ ...state, level: 2.5 }), false);
  assert.equal(isValidJoin({ room: 'world', name: 'A', shipId: 'ship', ...state, level: 3 }), true);
  assert.equal(isValidJoin({ room: 'world', name: 'A', shipId: 'ship', ...state, level: '3' }), false);
});

test('tiro do jogador: origem e direção 3D, voo e qual tiro desenhar', () => {
  const shot = {
    shotId: 'a-1', position: [0, 0, 1], forward: [1, 0, 0], speed: 300, altitude: 20, targetAltitude: 60, climb: 12, range: 540, airspace: -1, bullet: 'single', index: 0,
  };
  assert.equal(isValidShot(shot), true);
  assert.equal(isValidShot({ ...shot, position: [0, 1] }), false);
  assert.equal(isValidShot({ ...shot, forward: [0, 0, Number.NaN] }), false);
  assert.equal(isValidShot({ ...shot, speed: 0 }), false);
  assert.equal(isValidShot({ ...shot, range: 1e9 }), false);
  assert.equal(isValidShot({ ...shot, airspace: 1.5 }), false);
  assert.equal(isValidShot({ ...shot, bullet: '' }), false);
  assert.equal(isValidShot({ ...shot, index: 99 }), false);
  // o formato antigo (ângulo e origem 2D do mapa de cada cliente) não vale mais
  assert.equal(isValidShot({ angle: 1, originX: 0, originY: 0, bulletSpeed: 300, shotId: 'a-2' }), false);
});
