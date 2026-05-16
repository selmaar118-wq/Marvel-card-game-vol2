const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));

// rooms: { roomCode: { host: ws, guest: ws, hostName: str, guestName: str } }
const rooms = {};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'CREATE_ROOM': {
        const code = genCode();
        rooms[code] = { host: ws, guest: null, hostName: msg.name };
        ws.roomCode = code;
        ws.role = 'host';
        send(ws, { type: 'ROOM_CREATED', code });
        break;
      }

      case 'JOIN_ROOM': {
        const code = msg.code.toUpperCase();
        const room = rooms[code];
        if (!room) { send(ws, { type: 'ERROR', msg: 'Oda bulunamadı!' }); return; }
        if (room.guest) { send(ws, { type: 'ERROR', msg: 'Oda dolu!' }); return; }
        room.guest = ws;
        room.guestName = msg.name;
        ws.roomCode = code;
        ws.role = 'guest';
        // Tell host guest joined
        send(room.host, { type: 'GUEST_JOINED', guestName: msg.name });
        send(ws, { type: 'JOIN_OK', hostName: room.hostName });
        break;
      }

      case 'GAME_INIT': {
        // Host sends game init → relay to guest
        const room = rooms[ws.roomCode];
        if (!room) return;
        send(room.guest, { type: 'GAME_INIT', ...msg });
        break;
      }

      case 'COIN_CHOICE': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        // Only host resolves coin — relay choice to host if guest sent it
        // But in our design host always resolves, guest just picks via UI
        // So guest sends COIN_CHOICE → host resolves
        send(room.host, { type: 'COIN_CHOICE', choice: msg.choice });
        break;
      }

      case 'COIN_RESULT': {
        // Host resolved → send to guest
        const room = rooms[ws.roomCode];
        if (!room) return;
        send(room.guest, { type: 'COIN_RESULT', firstPlayer: msg.firstPlayer, firstName: msg.firstName });
        break;
      }

      case 'STAT_CHOSEN': {
        // Relay to the other player
        const room = rooms[ws.roomCode];
        if (!room) return;
        const other = ws.role === 'host' ? room.guest : room.host;
        send(other, { type: 'STAT_CHOSEN', stat: msg.stat });
        break;
      }

      case 'NEXT_TURN': {
        // Host sends authoritative state → relay to guest
        const room = rooms[ws.roomCode];
        if (!room) return;
        send(room.guest, { type: 'NEXT_TURN', state: msg.state });
        break;
      }

      case 'GAME_OVER': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        const other = ws.role === 'host' ? room.guest : room.host;
        send(other, { type: 'GAME_OVER', winnerName: msg.winnerName });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms[ws.roomCode];
    if (!room) return;
    const other = ws.role === 'host' ? room.guest : room.host;
    send(other, { type: 'ERROR', msg: 'Rakip bağlantıyı kesti.' });
    delete rooms[ws.roomCode];
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Sunucu: http://0.0.0.0:${PORT}`));
