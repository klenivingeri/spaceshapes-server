import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, RoomRegistry } from '../src/room.js';

function socket() {
  const messages = [];
  return {
    OPEN: 1,
    readyState: 1,
    messages,
    send(message) { messages.push(JSON.parse(message)); },
    close() {},
    last(type) { return [...messages].reverse().find((message) => message.t === type); },
  };
}

function duelRoom() {
  const room = new Room('duel-test');
  const a = socket();
  const b = socket();
  const idA = room.join(a, { name: 'A', shipId: 'ship' });
  const idB = room.join(b, { name: 'B', shipId: 'ship' });
  return { room, a, b, idA, idB };
}

test('só chama para duelo quem e o alvo estão com PvP ligado', () => {
  const { room, b, idA, idB } = duelRoom();
  try {
    assert.equal(room.duels.request(idA, idB), false);
    room.duels.setPvp(idA, true);
    assert.equal(room.duels.request(idA, idB), false);
    room.duels.setPvp(idB, true);
    assert.equal(room.duels.request(idA, idB), true);
    assert.deepEqual(b.last('duelInvite'), { t: 'duelInvite', from: idA, name: 'A' });
  } finally {
    room.dispose();
  }
});

test('convite pendente trava o PvP de quem chamou; recusar libera', () => {
  const { room, a, idA, idB } = duelRoom();
  try {
    room.duels.setPvp(idA, true);
    room.duels.setPvp(idB, true);
    room.duels.request(idA, idB);
    room.duels.setPvp(idA, false);
    assert.equal(room.duels.isOn(idA), true);
    assert.deepEqual(a.last('pvpState'), { t: 'pvpState', id: idA, on: true });
    room.duels.reply(idB, idA, false);
    assert.equal(a.last('duelInviteEnd').reason, 'declined');
    room.duels.setPvp(idA, false);
    assert.equal(room.duels.isOn(idA), false);
  } finally {
    room.dispose();
  }
});

test('duelo aceito: dano só entre os dois e PvP travado até acabar', () => {
  const { room, a, b, idA, idB } = duelRoom();
  const c = socket();
  const idC = room.join(c, { name: 'C', shipId: 'ship' });
  try {
    for (const id of [idA, idB, idC]) room.duels.setPvp(id, true);
    room.duels.request(idA, idB);
    assert.equal(room.duels.reply(idB, idA, true), true);
    assert.equal(a.last('duelStart').b, idB);
    assert.equal(room.duels.hit(idA, idB, 30), true);
    assert.deepEqual(b.last('playerDamage'), { t: 'playerDamage', from: idA, amount: 30 });
    assert.equal(room.duels.hit(idA, idC, 30), false);
    assert.equal(room.duels.hit(idC, idB, 30), false);
    room.duels.setPvp(idB, false);
    assert.equal(room.duels.isOn(idB), true);

    assert.equal(room.duels.defeat(idB), true);
    assert.deepEqual(a.last('duelEnd'), { t: 'duelEnd', winnerId: idA, loserId: idB, reason: 'defeat', honorWin: 10, honorLoss: 10 });
    assert.equal(b.last('duelEnd').winnerId, idA);
    assert.equal(room.duels.hit(idA, idB, 30), false);
    room.duels.setPvp(idB, false);
    assert.equal(room.duels.isOn(idB), false);
  } finally {
    room.dispose();
  }
});

test('sair da sala em duelo dá a vitória ao oponente; convite expira', () => {
  const { room, a, idA, idB } = duelRoom();
  try {
    room.duels.setPvp(idA, true);
    room.duels.setPvp(idB, true);
    room.duels.request(idA, idB);
    room.duels.tick(Date.now() + 16_000);
    assert.equal(a.last('duelInviteEnd').reason, 'timeout');
    room.duels.request(idA, idB);
    room.duels.reply(idB, idA, true);
    room.leave(idB);
    assert.deepEqual([a.last('duelEnd').winnerId, a.last('duelEnd').reason], [idA, 'left']);
  } finally {
    room.dispose();
  }
});

test('sala lotada abre uma cópia nova do mapa e reaproveita vagas', () => {
  const registry = new RoomRegistry({}, { maxPlayers: 2 });
  const join = (name) => {
    const room = registry.assign('florestatropical');
    return { room, id: room.join(socket(), { name, shipId: 'ship' }) };
  };
  try {
    const first = join('1');
    const second = join('2');
    const third = join('3');
    assert.equal(first.room.id, 'florestatropical#1');
    assert.equal(second.room.id, 'florestatropical#1');
    assert.equal(third.room.id, 'florestatropical#2');
    first.room.leave(first.id);
    assert.equal(join('4').room.id, 'florestatropical#1');
  } finally {
    for (const room of registry.rooms.values()) room.dispose();
  }
});

test('habilidade de um jogador é repassada só aos outros, e o servidor confere o formato', async () => {
  const { isValidSkill } = await import('../src/protocol.js');
  const { room, a, b, idA } = duelRoom();
  try {
    const skill = { skill: 'slowField', position: [0, 0, 1], forward: [1, 0, 0], altitude: 0, value: 20 };
    assert.equal(isValidSkill({ t: 'skill', ...skill }), true);
    assert.equal(isValidSkill({ t: 'skill', ...skill, position: [0, 1] }), false);
    assert.equal(isValidSkill({ t: 'skill', ...skill, value: -1 }), false);
    room.handleSkill(idA, skill);
    assert.deepEqual(b.last('skill'), { t: 'skill', id: idA, ...skill });
    assert.equal(a.last('skill'), undefined);
  } finally {
    room.dispose();
  }
});
