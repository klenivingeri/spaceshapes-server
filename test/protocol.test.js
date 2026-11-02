import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidEnemyDamage, isValidEnemyShot, isValidEnemySpawn, isValidEnemyStates, isValidJoin, isValidMove, isValidRename,
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
  assert.equal(isValidEnemySpawn({ ...enemy, spot: { ...enemy.spot, cell: -1 } }), false);
  assert.equal(isValidEnemyStates({ enemies: [{ ...enemy, skin: undefined, maxHp: undefined, spot: undefined }] }), true);
  assert.equal(isValidEnemyStates({ enemies: [{ ...enemy, position: [0, 1] }] }), false);
  assert.equal(isValidEnemyDamage({ id: enemy.id, damage: 1 }), true);
  assert.equal(isValidEnemyDamage({ id: enemy.id, damage: -1 }), false);
  assert.equal(isValidEnemyShot({
    enemyId: enemy.id, origin: enemy.position, target: [0.4, 0.3, 0.8660254],
    speed: 120, altitude: 0, targetAltitude: 10, airspace: -1,
  }), true);
  assert.equal(isValidEnemyShot({
    enemyId: enemy.id, origin: [0, 0], target: enemy.position,
    speed: 120, altitude: 0, targetAltitude: 10, airspace: -1,
  }), false);
});
