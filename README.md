# quadrix-server

Servidor WebSocket do QUADRIX (naves multiplayer na mesma fase). Repositório
separado do jogo (front vai para a Vercel, este servidor vai para o Render).
Também valida tokens de login Google em `POST /auth/google`.

## Rodando local

```
npm install
npm run dev     # node --watch, reinicia ao salvar
```

Porta padrão: `8787` (ou `PORT` do ambiente). Healthcheck em `GET /health`.

## Login com Google

Crie um cliente OAuth do tipo **Aplicativo da Web** no mesmo projeto Google
Cloud do cliente Android. Configure o ID do cliente Web como `GOOGLE_CLIENT_ID`
no Render e envie o mesmo ID como `VITE_GOOGLE_WEB_CLIENT_ID` no build do jogo.
O endpoint valida a assinatura, audiência, validade e e-mail verificado do
token com o Google; não armazena tokens nem sincroniza progresso.

## Banco de dados (MongoDB) e sessões

O inventário dos jogadores (`POST/GET /inventory`) e o mercado global (`/market/*`) ficam no MongoDB (coleções `inventories`,
`listings` e `earnings`). Variáveis de ambiente (modelo em `.env.example`; local vai em `.env`, ignorado pelo git; no Render, no
painel do serviço):

- `MONGODB_URI` e `MONGODB_DB`: sem a URI o servidor roda em memória em dev, e **recusa subir** com `NODE_ENV=production`.
- `SESSION_SECRET`: assina as sessões que `POST /auth/google` devolve junto com o perfil. Conta Google manda
  `Authorization: Bearer <sessão>`; visitante usa o uuid de `local:<uuid>` (mín. 16 caracteres) como segredo.
- No Atlas, libere o IP do Render em Network Access.

## Protocolo

Ver `src/protocol.js` — espelhado manualmente em
`QUADRIX/src/services/MultiplayerService.js`. Mudou um lado, muda o outro.

- Cliente → servidor: `join {room, name, shipId, position, forward, angle,
  speed, altitude}`, `rename {name}`, `move {position, forward, angle, speed, altitude}`, `shot
  {angle, originX, originY, bulletSpeed, shotId}`, `enemySpawn {enemy}`,
  `enemyStates {enemies}`, `enemyDamage {id, damage}` e `enemyShot {shot}`.
  `position` e `forward` dos jogadores são vetores 3D no referencial comum do
  planeta; `forward` aponta o bico da nave. Estados de inimigos sincronizam
  posição, altitude e vida; o giro visual é calculado localmente em cada cliente.
- Servidor → cliente: `welcome`, `playerJoin`, `playerLeave`, `tick`, `shot`,
  `hit`, `enemySpawn`, `enemyStates`, `enemyDamage` e `enemyAuthority`.

As mensagens `welcome`, `playerJoin` e `tick` retransmitem a posição 3D e a
direção do bico. `rename` atualiza o nome de todos os jogadores conectados.
Cada cliente projeta esses mesmos vetores no próprio ponto de vista do planeta.

O primeiro jogador da sala é a autoridade dos inimigos: só ele cria e transmite
os estados de movimento; o servidor valida dano e replica HP/morte. `welcome`
inclui `isEnemyHost` e a lista de inimigos vivos para clientes que entram depois.
Se a autoridade sair, a sala limpa os inimigos e elege o próximo jogador, que
recria a população. A autoridade também replica cada disparo inimigo com origem,
alvo e velocidade para os demais clientes. Mortes e respawns dos jogadores
continuam independentes.

## Deploy no Render

`render.yaml` já descreve um *web service* Node único (`npm install` / `npm
start`). Aponte o `VITE_WS_URL` do front para `wss://<nome-do-serviço>.onrender.com`.
