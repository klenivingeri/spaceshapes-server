// PvP por jogador e duelos de uma sala. Cada jogador liga o PvP quando quer; só dois jogadores com PvP ligado se enfrentam, e só depois de um
// convite aceito (o primeiro tiro em quem está com PvP ligado chama para o duelo). Em duelo ou com convite próprio pendente o PvP não desliga.
// O servidor não simula combate: guarda quem duela com quem e só deixa passar dano entre os dois (`hit`), que a vítima aplica em si mesma.
import { DUEL_END, DUEL_INVITE, DUEL_INVITE_END, DUEL_START, PLAYER_DAMAGE, PVP_STATE } from './protocol.js';

export const INVITE_MS = 15_000;
export const HONOR_WIN = 10;
export const HONOR_LOSS = 10;
// Teto de golpes de duelo por jogador por segundo (a cadência do jogo é bem menor); passou disso, o golpe é descartado.
const MAX_HITS_PER_SECOND = 30;

export class Duels {
  // `room` dá `players` (Map id -> { ws, name, ... }), `send(id, message)` e `broadcast(message)`.
  constructor(room) {
    this.room = room;
    this.pvp = new Set();          // ids com PvP ligado
    this.duel = new Map();         // id -> id do oponente (nos dois sentidos)
    this.invites = new Map();      // id de quem foi chamado -> { from, expiresAt }
    this.hitLog = new Map();       // id -> { second, count }
  }

  isOn(id) {
    return this.pvp.has(id);
  }

  opponentOf(id) {
    return this.duel.get(id) ?? null;
  }

  // Convite que `id` mandou e ainda espera resposta (id de quem foi chamado) ou null.
  pendingFrom(id) {
    for (const [target, invite] of this.invites) if (invite.from === id) return target;
    return null;
  }

  locked(id) {
    return this.duel.has(id) || this.pendingFrom(id) !== null;
  }

  // Liga ou desliga. Desligar é recusado em duelo ou com convite pendente: o estado de verdade volta ao próprio jogador.
  setPvp(id, on) {
    if (!this.room.players.has(id)) return;
    if (!on && this.locked(id)) return this.room.send(id, { t: PVP_STATE, id, on: true });
    if (on === this.pvp.has(id)) return;
    if (on) this.pvp.add(id);
    else {
      this.pvp.delete(id);
      this.cancelInvitesTo(id, 'off');
    }
    this.room.broadcast({ t: PVP_STATE, id, on });
  }

  // `from` chama `target` para um duelo. Vale com os dois com PvP ligado, livres e sem outro convite no ar.
  request(from, target) {
    const { players } = this.room;
    if (from === target || !players.has(from) || !players.has(target)) return false;
    if (!this.pvp.has(from) || !this.pvp.has(target) || this.locked(from) || this.locked(target) || this.invites.has(target)) return false;
    this.invites.set(target, { from, expiresAt: Date.now() + INVITE_MS });
    this.room.send(target, { t: DUEL_INVITE, from, name: players.get(from).name });
    return true;
  }

  // O chamado responde: aceitar começa o duelo; recusar encerra o convite.
  reply(target, from, accept) {
    const invite = this.invites.get(target);
    if (!invite || invite.from !== from) return false;
    this.invites.delete(target);
    if (!accept) return this.endInvite(from, target, 'declined');
    if (!this.room.players.has(from)) return false;
    this.duel.set(from, target);
    this.duel.set(target, from);
    this.room.send(from, { t: DUEL_START, a: from, b: target });
    this.room.send(target, { t: DUEL_START, a: from, b: target });
    return true;
  }

  endInvite(from, target, reason) {
    this.room.send(from, { t: DUEL_INVITE_END, from, target, reason });
    this.room.send(target, { t: DUEL_INVITE_END, from, target, reason });
    return false;
  }

  cancelInvitesTo(id, reason) {
    const invite = this.invites.get(id);
    if (!invite) return;
    this.invites.delete(id);
    this.endInvite(invite.from, id, reason);
  }

  // Dano do duelo de `from` em `target`: só entre os dois que duelam e dentro do teto por segundo.
  hit(from, target, damage) {
    if (this.duel.get(from) !== target) return false;
    const second = Math.floor(Date.now() / 1000);
    const log = this.hitLog.get(from);
    if (!log || log.second !== second) this.hitLog.set(from, { second, count: 1 });
    else if (++log.count > MAX_HITS_PER_SECOND) return false;
    this.room.send(target, { t: PLAYER_DAMAGE, from, amount: damage });
    return true;
  }

  // `loserId` zerou a vida (declarou a própria derrota), saiu ou caiu: o oponente vence e cada um recebe a honra.
  defeat(loserId, reason = 'defeat') {
    const winnerId = this.duel.get(loserId);
    if (winnerId === undefined) return false;
    this.duel.delete(loserId);
    this.duel.delete(winnerId);
    const message = { t: DUEL_END, winnerId, loserId, reason, honorWin: HONOR_WIN, honorLoss: HONOR_LOSS };
    this.room.send(winnerId, message);
    this.room.send(loserId, message);
    return true;
  }

  // Quem sai da sala: sai do PvP, perde o duelo em andamento e cancela convites.
  leave(id) {
    this.defeat(id, 'left');
    const target = this.pendingFrom(id);
    if (target !== null) {
      this.invites.delete(target);
      this.room.send(target, { t: DUEL_INVITE_END, from: id, target, reason: 'left' });
    }
    this.cancelInvitesTo(id, 'left');
    this.pvp.delete(id);
    this.hitLog.delete(id);
  }

  // Chamado a cada tick: convites sem resposta expiram.
  tick(now = Date.now()) {
    for (const [target, invite] of this.invites) {
      if (now < invite.expiresAt) continue;
      this.invites.delete(target);
      this.endInvite(invite.from, target, 'timeout');
    }
  }
}
