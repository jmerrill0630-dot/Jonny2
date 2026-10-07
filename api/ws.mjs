import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createGame } = require('../engine.js');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const room = globalThis.__jonnyRoom || (globalThis.__jonnyRoom = (() => {
  const game = createGame({ BOTS: 10 });
  game.start();
  return game;
})());

wss.on('connection', (ws) => {
  let player = null;

  const send = (event, data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, data }));
    }
  };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
      if (player) return;
      const name = String(msg.name || 'Player').trim().slice(0, 24);
      player = room.join(send, name);
      return;
    }

    if (!player) return;
    if (msg.type === 'input') player.input(msg.data);
    else if (msg.type === 'split') player.split();
    else if (msg.type === 'eject') player.eject();
    else if (msg.type === 'respawn') player.respawn();
  });

  ws.on('close', () => {
    if (player) player.leave();
    player = null;
  });
});

export default server;
