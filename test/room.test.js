import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/room.js';

function socket() {
  const messages = [];
  return {
    OPEN: 1,
    readyState: 1,
    messages,
    closeCode: null,
    closeReason: null,
    send(message) { messages.push(JSON.parse(message)); },
    close(code, reason) { this.closeCode = code; this.closeReason = reason; },
  };
}

test('welcome e tick retransmitem posição 3D e direção do bico', () => {
  const room = new Room('test');
  const first = socket();
  const second = socket();
  const position = [0.3, 0.4, 0.8660254];
  const forward = [0, 1, 0];
  try {
    const playerId = room.join(first, {
      name: 'A', shipId: 'ship', position, forward, altitude: 12, angle: 1, speed: 50,
    });
    room.join(second, { name: 'B', shipId: 'ship', position: [0, 0, 1], forward: [1, 0, 0] });

    assert.deepEqual(second.messages[0].players[0].position, position);
    assert.deepEqual(second.messages[0].players[0].forward, forward);
    assert.equal(second.messages[0].players[0].altitude, 12);

    room.handleRename(playerId, 'Novo nome');
    assert.deepEqual(second.messages[1], { t: 'playerRename', id: playerId, name: 'Novo nome' });

    const movedPosition = [0.4, 0.3, 0.8660254];
    const movedForward = [0, 0, 1];
    room.handleMove(playerId, {
      position: movedPosition, forward: movedForward, angle: 2, speed: 60, altitude: 20,
    });
    room.tick();

    const state = second.messages.at(-1).players[0];
    assert.deepEqual(state.position, movedPosition);
    assert.deepEqual(state.forward, movedForward);
    assert.equal(state.altitude, 20);
  } finally {
    room.dispose();
  }
});

test('desconecta no servidor jogador sem atividade por dois minutos e mantém jogador ativo', () => {
  const room = new Room('idle-test');
  const inactive = socket();
  const active = socket();
  try {
    const inactiveId = room.join(inactive, { name: 'Inativo', shipId: 'ship' });
    const activeId = room.join(active, { name: 'Ativo', shipId: 'ship' });
    room.players.get(inactiveId).lastActivityAt = Date.now() - 120_000;
    room.handleActivity(activeId);

    room.tick();

    assert.equal(inactive.closeCode, 4000);
    assert.equal(inactive.closeReason, 'idle timeout');
    assert.equal(active.closeCode, null);
  } finally {
    room.dispose();
  }
});

test('mantém o dano do inimigo contra estados atrasados enviados pela autoridade', () => {
  const room = new Room('enemy-damage-test');
  const host = socket();
  const guest = socket();
  try {
    const hostId = room.join(host, { name: 'Host', shipId: 'ship' });
    const guestId = room.join(guest, { name: 'Guest', shipId: 'ship' });
    const enemy = {
      id: 'host:1',
      skin: 'orb_plasma',
      position: [0.3, 0.4, 0.8660254],
      altitude: 0,
      radius: 1,
      hp: 10,
      maxHp: 10,
      spot: { cell: 2, inside: false, airspace: -1, level: 1, type: 'chase' },
    };
    room.handleEnemySpawn(hostId, enemy);

    room.handleEnemyDamage(guestId, { id: enemy.id, damage: 3 });
    room.handleEnemyStates(hostId, [{ ...enemy, position: [0.4, 0.3, 0.8660254] }]);

    assert.equal(room.enemies.get(enemy.id).hp, 7);
    assert.equal(guest.messages.at(-1).enemies[0].hp, 7);
  } finally {
    room.dispose();
  }
});

test('somente a autoridade cria inimigos, estados são retransmitidos e dano é compartilhado', () => {
  const room = new Room('enemy-test');
  const host = socket();
  const guest = socket();
  const lateGuest = socket();
  try {
    const hostId = room.join(host, { name: 'Host', shipId: 'ship' });
    const guestId = room.join(guest, { name: 'Guest', shipId: 'ship' });
    assert.equal(host.messages[0].isEnemyHost, true);
    assert.equal(guest.messages[0].isEnemyHost, false);

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
    room.handleEnemySpawn(guestId, enemy);
    assert.equal(room.enemies.size, 0);

    room.handleEnemySpawn(hostId, enemy);
    assert.deepEqual(guest.messages.at(-1), { t: 'enemySpawn', enemy: { ...enemy, alive: true } });
    room.join(lateGuest, { name: 'Late', shipId: 'ship' });
    assert.deepEqual(lateGuest.messages[0].enemies[0], { ...enemy, alive: true });

    const nextState = { ...enemy, position: [0.4, 0.3, 0.8660254], hp: 3 };
    room.handleEnemyStates(hostId, [nextState]);
    assert.deepEqual(guest.messages.at(-1), { t: 'enemyStates', enemies: [nextState] });

    const enemyShot = {
      enemyId: enemy.id,
      origin: enemy.position,
      target: [0.4, 0.3, 0.8660254],
      speed: 120,
      altitude: 0,
      targetAltitude: 12,
      airspace: -1,
    };
    room.handleEnemyShot(guestId, enemyShot);
    assert.notEqual(guest.messages.at(-1).t, 'enemyShot');
    room.handleEnemyShot(hostId, enemyShot);
    assert.deepEqual(guest.messages.at(-1), { t: 'enemyShot', shot: enemyShot });

    room.handleEnemyDamage(guestId, { id: enemy.id, damage: 3 });
    assert.deepEqual(guest.messages.at(-1), {
      t: 'enemyDamage', id: enemy.id, damage: 3, hp: 0, killerId: guestId, dead: true,
    });
    assert.equal(room.enemies.has(enemy.id), false);
    assert.equal(lateGuest.messages.at(-1).dead, true);

    room.leave(hostId);
    assert.equal(room.enemies.size, 0);
    assert.deepEqual(guest.messages.at(-1), { t: 'enemyAuthority', id: guestId });
  } finally {
    room.dispose();
  }
});
