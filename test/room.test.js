import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES } from '../src/loot.js';
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
      spot: { cell: 2, inside: false, level: 1, type: 'chase' },
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
    room.players.get(inactiveId).lastActivityAt = Date.now() - 300_000;
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
    const guestId = room.join(guest, { name: 'Guest', shipId: 'ship', identityId: 'local:gggggggggggggggggggg' });
    const hostId = room.join(host, { name: 'Host', shipId: 'ship' });
    const enemy = {
      id: 'host:1',
      skin: 'orb_plasma',
      position: [0.3, 0.4, 0.8660254],
      altitude: 0,
      radius: 1,
      hp: 10,
      maxHp: 10,
      spot: { cell: 2, inside: false, level: 1, type: 'chase' },
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
  const credited = [];
  const room = new Room('enemy-drop-test', { onLoot: async (identityId, item) => credited.push([identityId, item]) });
  const host = socket();
  const guest = socket();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const guestId = room.join(guest, { name: 'Guest', shipId: 'ship', identityId: 'local:gggggggggggggggggggg' });
    const hostId = room.join(host, { name: 'Host', shipId: 'ship' });
    const enemy = {
      id: 'host:1',
      skin: 'orb_plasma',
      position: [0.3, 0.4, 0.8660254],
      altitude: 0,
      radius: 1,
      hp: 1,
      maxHp: 1,
      spot: { cell: 2, inside: false, level: 1, type: 'chase' },
      dropOptions: {
        parts: [{ part: 'engine', shipId: 'ship-1' }],
        chips: [],
      },
    };
    room.handleEnemySpawn(hostId, enemy);
    room.handleEnemyDamage(guestId, { id: enemy.id, damage: 1 });

    const drops = guest.messages.filter((message) => message.t === 'enemyDrop').map((message) => message.drop);
    // A família vem da tabela do servidor (a primeira, com o sorteio zerado), nunca da lista que o cliente mandou.
    assert.equal(drops.length, 1);
    assert.equal(drops[0].ownerId, guestId);
    assert.deepEqual(drops[0].partDrop, { part: 'center', shipId: FAMILIES[0] });
    assert.deepEqual(drops[0].position, enemy.position);
    const latePlayer = socket();
    room.join(latePlayer, { name: 'Late', shipId: 'ship' });
    assert.deepEqual(latePlayer.messages[0].drops.map(({ id }) => id), drops.map(({ id }) => id));

    const [partDrop] = drops;
    room.handleDropPickup(hostId, partDrop.id);
    assert.equal(room.drops.has(partDrop.id), true);
    room.handleDropPickup(guestId, partDrop.id);
    assert.equal(room.drops.has(partDrop.id), false);
    assert.deepEqual(guest.messages.at(-1), {
      t: 'dropCollected', id: partDrop.id, pickerId: guestId,
    });

    // Quem pegou ganha o crédito no inventário do servidor.
    assert.deepEqual(credited, [['local:gggggggggggggggggggg', { kind: 'fragment', family: FAMILIES[0] }]]);
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
      spot: { cell: 2, inside: false, level: 1, type: 'chase' },
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

test('o tiro só é repassado aos outros jogadores, com para onde a nave apontava (o servidor não segue o projétil)', () => {
  const room = new Room('test');
  const first = socket();
  const second = socket();
  try {
    const shooterId = room.join(first, { name: 'A', shipId: 'ship' });
    room.join(second, { name: 'B', shipId: 'ship' });
    const shot = {
      shotId: 'a-1', position: [0, 0, 1], forward: [1, 0, 0], speed: 300, altitude: 20, targetAltitude: 60, climb: 12, range: 540, bullet: 'single', index: 0, extra: 'ignorado',
    };
    const before = first.messages.length;
    room.handleShot(shooterId, shot);
    const { extra, ...relayed } = shot;
    assert.deepEqual(second.messages.at(-1), { t: 'shot', id: shooterId, ...relayed });
    assert.equal(first.messages.length, before);   // quem atirou não recebe o próprio tiro de volta
    room.tick();
    assert.equal(second.messages.some((message) => message.t === 'hit'), false);   // nada de acerto calculado no servidor
  } finally {
    room.dispose();
  }
});

test('o nível do jogador entra no join e no move e vai para os outros no tick', () => {
  const room = new Room('test');
  const first = socket();
  const second = socket();
  try {
    const firstId = room.join(first, { name: 'A', shipId: 'ship', level: 7 });
    room.join(second, { name: 'B', shipId: 'ship' });
    assert.equal(second.messages[0].players[0].level, 7);
    room.handleMove(firstId, { angle: 0, speed: 0, level: 8 });
    room.tick();
    assert.equal(second.messages.at(-1).players.find((player) => player.id === firstId).level, 8);
    assert.equal(second.messages.at(-1).players.find((player) => player.id !== firstId).level, 1);
  } finally {
    room.dispose();
  }
});

// Host dos inimigos: o servidor passa o papel adiante se ele atrasar demais.
function roomWithHost(clock) {
  const room = new Room('watchdog');
  const host = socket();
  const guest = socket();
  const firstId = room.join(host, { name: 'A', shipId: 'ship' });
  const secondId = room.join(guest, { name: 'B', shipId: 'ship' });
  // Sem inimigos na sala, quem entra por último assume o papel de host (ver Room.join).
  const hostId = room.enemyAuthorityId;
  const guestId = hostId === firstId ? secondId : firstId;
  room.handleEnemySpawn(hostId, { id: 'e1', spot: {}, hp: 3 });
  const sendStates = () => room.handleEnemyStates(hostId, [{ id: 'e1', position: [0, 0, 1], forward: [1, 0, 0], altitude: 0, radius: 1, hp: 3 }]);
  sendStates();
  room.tick();
  return { room, hostId, guestId, guests: { [firstId]: host, [secondId]: guest }, sendStates, clock };
}

function withFakeClock(run) {
  const realNow = Date.now;
  const clock = { now: realNow() };
  Date.now = () => clock.now;
  try { run(clock); } finally { Date.now = realNow; }
}

test('host em silêncio por mais de 2 s perde o papel na hora', () => {
  withFakeClock((clock) => {
    const { room, guestId, guests } = roomWithHost(clock);
    try {
      clock.now += 2100;
      room.tick();
      assert.equal(room.enemyAuthorityId, guestId);
      assert.deepEqual(guests[guestId].messages.filter((message) => message.t === 'enemyAuthority').at(-1), { t: 'enemyAuthority', id: guestId });
    } finally { room.dispose(); }
  });
});

test('host que atrasa 3 vezes perde o papel; 2 atrasos não bastam', () => {
  withFakeClock((clock) => {
    const { room, hostId, guestId, sendStates } = roomWithHost(clock);
    try {
      for (let late = 1; late <= 3; late++) {
        clock.now += 600;
        room.tick();   // passou de 500 ms sem mandar: um atraso
        if (late < 3) {
          assert.equal(room.enemyAuthorityId, hostId, `${late} atraso(s) ainda é tolerado`);
          sendStates();   // voltou: a parada acabou
        }
      }
      assert.equal(room.enemyAuthorityId, guestId);
    } finally { room.dispose(); }
  });
});

test('uma parada longa conta um atraso só', () => {
  withFakeClock((clock) => {
    const { room, hostId } = roomWithHost(clock);
    try {
      clock.now += 600;
      room.tick();
      clock.now += 600;
      room.tick();
      clock.now += 600;
      room.tick();
      assert.equal(room.enemyAuthorityId, hostId, '1,8 s parado ainda é um atraso, abaixo do silêncio total');
    } finally { room.dispose(); }
  });
});

test('atrasos antigos expiram', () => {
  withFakeClock((clock) => {
    const { room, hostId, sendStates } = roomWithHost(clock);
    try {
      for (let late = 0; late < 5; late++) {
        clock.now += 600;
        room.tick();
        sendStates();
        clock.now += 11_000;   // longe da janela de 10 s
        sendStates();
        room.tick();
      }
      assert.equal(room.enemyAuthorityId, hostId);
    } finally { room.dispose(); }
  });
});

test('sozinho na sala o host nunca é trocado', () => {
  withFakeClock((clock) => {
    const room = new Room('solo');
    try {
      const hostId = room.join(socket(), { name: 'A', shipId: 'ship' });
      room.handleEnemySpawn(hostId, { id: 'e1', spot: {}, hp: 3 });
      clock.now += 5000;
      room.tick();
      assert.equal(room.enemyAuthorityId, hostId);
    } finally { room.dispose(); }
  });
});
