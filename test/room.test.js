import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, RoomRegistry } from '../src/room.js';

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
    assert.deepEqual(second.messages.at(-1), { t: 'playerRename', id: playerId, name: 'Novo nome' });

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

test('transfere autoridade para o jogador ativo quando a sala ainda não tem inimigos', () => {
  const room = new Room('empty-enemy-authority-test');
  const pausedPlayer = socket();
  const activePlayer = socket();
  try {
    const previousAuthorityId = room.join(pausedPlayer, { name: 'Menu', shipId: 'ship' });
    const activeAuthorityId = room.join(activePlayer, { name: 'Ativo', shipId: 'ship' });

    assert.equal(pausedPlayer.messages[0].isEnemyHost, true);
    assert.equal(activePlayer.messages[0].isEnemyHost, true);
    assert.deepEqual(pausedPlayer.messages.at(-1), {
      t: 'enemyAuthority', id: activeAuthorityId,
    });

    const enemy = {
      id: `${activeAuthorityId}:1`,
      skin: 'orb_plasma',
      position: [0.3, 0.4, 0.8660254],
      altitude: 0,
      radius: 1,
      hp: 3,
      maxHp: 3,
      spot: { cell: 2, inside: false, airspace: -1, level: 1, type: 'chase' },
    };
    room.handleEnemySpawn(activeAuthorityId, enemy);
    assert.equal(room.enemies.has(enemy.id), true);
    assert.notEqual(previousAuthorityId, activeAuthorityId);
  } finally {
    room.dispose();
  }
});

test('uma nova conexão substitui a sessão existente com a mesma identidade', () => {
  const room = new Room('identity-reconnect-test');
  const previous = socket();
  const current = socket();
  try {
    const previousId = room.join(previous, {
      name: 'A', shipId: 'ship', identityId: 'local:device-1',
    });
    const currentId = room.join(current, {
      name: 'A', shipId: 'ship', identityId: 'local:device-1',
    });

    assert.equal(previous.closeCode, 4002);
    assert.equal(previous.closeReason, 'session replaced');
    assert.equal(room.players.has(previousId), false);
    assert.equal(room.players.has(currentId), true);
    assert.equal(room.players.size, 1);
  } finally {
    room.dispose();
  }
});

test('salas local e account mantêm listas de jogadores separadas', () => {
  const registry = new RoomRegistry();
  const localRoom = registry.get('local:world:1');
  const accountRoom = registry.get('account:world:1');
  const localPlayer = socket();
  const accountPlayer = socket();
  try {
    localRoom.join(localPlayer, { name: 'Local', shipId: 'ship', identityId: 'local:device-1' });
    accountRoom.join(accountPlayer, { name: 'Conta', shipId: 'ship', identityId: 'account:user@example.com' });

    assert.notEqual(localRoom, accountRoom);
    assert.deepEqual(localPlayer.messages[0].players, []);
    assert.deepEqual(accountPlayer.messages[0].players, []);
  } finally {
    localRoom.dispose();
    accountRoom.dispose();
  }
});

test('desconecta no servidor jogador após um minuto sem atividade e mantém jogador ativo', () => {
  const room = new Room('idle-test');
  const inactive = socket();
  const active = socket();
  try {
    const inactiveId = room.join(inactive, { name: 'Inativo', shipId: 'ship' });
    const activeId = room.join(active, { name: 'Ativo', shipId: 'ship' });
    room.players.get(inactiveId).lastActivityAt = Date.now() - 60_000;
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
    const guestId = room.join(guest, { name: 'Guest', shipId: 'ship' });
    const hostId = room.join(host, { name: 'Host', shipId: 'ship' });
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

test('servidor decide os drops e limita a coleta ao jogador que deu o golpe final', () => {
  const room = new Room('enemy-drop-test');
  const host = socket();
  const guest = socket();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const guestId = room.join(guest, { name: 'Guest', shipId: 'ship' });
    const hostId = room.join(host, { name: 'Host', shipId: 'ship' });
    const enemy = {
      id: 'host:1',
      skin: 'orb_plasma',
      position: [0.3, 0.4, 0.8660254],
      altitude: 0,
      radius: 1,
      hp: 1,
      maxHp: 1,
      spot: { cell: 2, inside: false, airspace: -1, level: 1, type: 'chase' },
      dropOptions: {
        parts: [{ part: 'engine', shipId: 'ship-1' }],
        chips: ['turbo'],
      },
    };
    room.handleEnemySpawn(hostId, enemy);
    room.handleEnemyDamage(guestId, { id: enemy.id, damage: 1 });

    const drops = guest.messages.filter((message) => message.t === 'enemyDrop').map((message) => message.drop);
    assert.equal(drops.length, 2);
    assert.equal(drops[0].ownerId, guestId);
    assert.deepEqual(drops[0].partDrop, { part: 'engine', shipId: 'ship-1' });
    assert.equal(drops[1].chipDrop, 'turbo');
    assert.deepEqual(drops[0].position, enemy.position);
    const latePlayer = socket();
    room.join(latePlayer, { name: 'Late', shipId: 'ship' });
    assert.deepEqual(latePlayer.messages[0].drops.map(({ id }) => id), drops.map(({ id }) => id));

    const [partDrop, chipDrop] = drops;
    room.handleDropPickup(hostId, partDrop.id);
    assert.equal(room.drops.has(partDrop.id), true);
    room.handleDropPickup(guestId, partDrop.id);
    assert.equal(room.drops.has(partDrop.id), false);
    assert.deepEqual(guest.messages.at(-1), {
      t: 'dropCollected', id: partDrop.id, pickerId: guestId,
    });

    room.drops.get(chipDrop.id).ownerUntil = Date.now() - 1;
    room.handleDropPickup(hostId, chipDrop.id);
    assert.equal(room.drops.has(chipDrop.id), false);
    assert.deepEqual(guest.messages.at(-1), {
      t: 'dropCollected', id: chipDrop.id, pickerId: hostId,
    });
  } finally {
    Math.random = originalRandom;
    room.dispose();
  }
});

test('somente a autoridade cria inimigos, estados são retransmitidos e dano é compartilhado', () => {
  const room = new Room('enemy-test');
  const host = socket();
  const guest = socket();
  const lateGuest = socket();
  try {
    const guestId = room.join(guest, { name: 'Guest', shipId: 'ship' });
    const hostId = room.join(host, { name: 'Host', shipId: 'ship' });
    assert.equal(host.messages[0].isEnemyHost, true);
    assert.equal(guest.messages[0].isEnemyHost, true);
    assert.deepEqual(guest.messages.at(-1), { t: 'enemyAuthority', id: hostId });

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
