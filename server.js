const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let users = [];
let currentTrack = null;

// conexão
io.on('connection', (socket) => {
  console.log('Novo usuário');

  socket.on('join', (nick) => {
    socket.nick = nick;
    users.push(nick);

    io.emit('users', users);

    socket.emit('syncTrack', currentTrack);

    io.emit('chat', {
      nick: 'Sistema',
      message: `${nick} entrou`
    });
  });

  socket.on('chat', (msg) => {
    io.emit('chat', {
      nick: socket.nick,
      message: msg
    });
  });

  // 🎧 sincronizar música
  socket.on('playTrack', (track) => {
    currentTrack = track;

    io.emit('playTrack', track);

    io.emit('chat', {
      nick: 'Sistema',
      message: `${socket.nick} colocou: ${track.name}`
    });
  });

  socket.on('disconnect', () => {
    users = users.filter(u => u !== socket.nick);

    io.emit('users', users);

    io.emit('chat', {
      nick: 'Sistema',
      message: `${socket.nick} saiu`
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Rodando na porta ' + PORT));