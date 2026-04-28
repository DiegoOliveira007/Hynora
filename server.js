const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// ── Rotas de página (ANTES do listen)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// ── Estado global da sala
let users = [];       // { id, nick }
let queue = [];       // fila de músicas
let currentTrack = null;  // música tocando agora
let isPlaying = false;
let startedAt = null; // timestamp de quando começou a tocar (para sync de posição)

// ── Socket.io
io.on('connection', (socket) => {
  console.log('Conexão:', socket.id);

  // Usuário entrou na sala
  socket.on('join', (nick) => {
    // Evita nick duplicado — adiciona número se precisar
    let finalNick = nick;
    let count = 1;
    while (users.some(u => u.nick === finalNick)) {
      finalNick = nick + '_' + count++;
    }

    socket.nick = finalNick;
    users.push({ id: socket.id, nick: finalNick });

    // Manda estado atual só para quem entrou
    socket.emit('welcome', {
      nick: finalNick,
      users: users.map(u => u.nick),
      queue,
      currentTrack,
      isPlaying,
      // posição estimada da música atual
      position: (isPlaying && startedAt) ? Date.now() - startedAt : 0,
    });

    // Avisa todos os outros
    io.emit('users', users.map(u => u.nick));
    io.emit('chat', { nick: 'sistema', message: `${finalNick} entrou na sala ♪`, system: true });
  });

  // Chat
  socket.on('chat', (msg) => {
    if (!socket.nick || !msg || msg.trim().length === 0) return;
    const safe = String(msg).slice(0, 200);
    io.emit('chat', { nick: socket.nick, message: safe, system: false });
  });

  // Tocar música agora (broadcast para todos)
  socket.on('playTrack', (track) => {
    if (!socket.nick) return;
    currentTrack = track;
    isPlaying = true;
    startedAt = Date.now();

    io.emit('playTrack', { track, startedAt });
    io.emit('chat', { nick: 'sistema', message: `${socket.nick} colocou: ${track.name} — ${track.artist}`, system: true });
  });

  // Adicionar à fila
  socket.on('addQueue', (track) => {
    if (!socket.nick) return;
    // Evita duplicata
    if (queue.some(q => q.uri === track.uri)) {
      socket.emit('toast', 'JÁ ESTÁ NA FILA');
      return;
    }
    track.addedBy = socket.nick;
    queue.push(track);
    io.emit('queue', queue);
    io.emit('chat', { nick: 'sistema', message: `${socket.nick} adicionou "${track.name}" à fila`, system: true });
  });

  // Remover da fila
  socket.on('removeQueue', (uri) => {
    if (!socket.nick) return;
    queue = queue.filter(q => q.uri !== uri);
    io.emit('queue', queue);
  });

  // Pause / Resume
  socket.on('pause', () => {
    if (!socket.nick) return;
    isPlaying = false;
    io.emit('pause');
  });

  socket.on('resume', () => {
    if (!socket.nick) return;
    isPlaying = true;
    startedAt = Date.now();
    io.emit('resume');
  });

  // Desconectou
  socket.on('disconnect', () => {
    if (!socket.nick) return;
    users = users.filter(u => u.id !== socket.id);
    io.emit('users', users.map(u => u.nick));
    io.emit('chat', { nick: 'sistema', message: `${socket.nick} saiu`, system: true });
    console.log('Saiu:', socket.nick);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Hynora rodando na porta ${PORT}`));
