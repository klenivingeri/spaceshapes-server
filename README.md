# quadrix-server

Servidor WebSocket do QUADRIX (naves multiplayer na mesma fase). Repositório
separado do jogo (front vai para a Vercel, este servidor vai para o Render).

## Rodando local

```
npm install
npm run dev     # node --watch, reinicia ao salvar
```

Porta padrão: `8787` (ou `PORT` do ambiente). Healthcheck em `GET /health`.

## Protocolo

Ver `src/protocol.js` — espelhado manualmente em
`QUADRIX/src/services/MultiplayerService.js`. Mudou um lado, muda o outro.

- Cliente → servidor: `join {room, name, shipId}`, `move {angle, speed}`, `shot
  {angle, originX, originY, bulletSpeed, shotId}`.
- Servidor → cliente: `welcome`, `playerJoin`, `playerLeave`, `tick`, `shot`,
  `hit`.

O servidor é autoritativo (sempre sabe x/y de cada jogador), mas só transmite
`x`/`y` a cada `RESYNC_EVERY_TICKS` ticks — o resto do tempo manda só
`angle`/`speed`, e quem recebe reconstrói a posição por dead-reckoning.

## Deploy no Render

`render.yaml` já descreve um *web service* Node único (`npm install` / `npm
start`). Aponte o `VITE_WS_URL` do front para `wss://<nome-do-serviço>.onrender.com`.
