import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { JOIN, MOVE, SHOT, isValidJoin, isValidMove, isValidShot } from './protocol.js';
import { RoomRegistry } from './room.js';

const PORT = process.env.PORT || 8787;
const registry = new RoomRegistry();

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  // Preenchidos só depois do `join` — até lá a conexão não pertence a sala nenhuma.
  let room = null;
  let playerId = null;

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.t === JOIN) {
      if (room || !isValidJoin(message)) return; // já entrou, ou payload inválido
      room = registry.get(message.room);
      playerId = room.join(ws, { name: message.name, shipId: message.shipId });
      return;
    }
    if (!room || !playerId) return; // mensagens antes do join não valem
    if (message.t === MOVE && isValidMove(message)) {
      room.handleMove(playerId, { angle: message.angle, speed: message.speed });
    } else if (message.t === SHOT && isValidShot(message)) {
      room.handleShot(playerId, message);
    }
  });

  ws.on('close', () => {
    if (!room || !playerId) return;
    room.leave(playerId);
    registry.disposeIfEmpty(room);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[quadrix-server] ouvindo na porta ${PORT}`);
});
