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
let users = [];       // { id, nick, avatar }
let disconnectTimers = {}; // { nick: timeoutId } — grace period antes de remover do chat
let queue = [];       // fila de músicas
let currentTrack = null;  // música tocando agora
let isPlaying = false;
let startedAt = null; // timestamp de quando começou a tocar (para sync de posição)
let pausedAt = null;  // posição em ms onde foi pausado

// ── Socket.io
io.on('connection', (socket) => {
  console.log('Conexão:', socket.id);

  // Usuário entrou na sala
  socket.on('join', ({ nick, avatar }) => {
    let finalNick = String(nick || 'user').slice(0, 20);

    // Verifica se é uma reconexão (mesmo nick ainda no grace period)
    const isReconnect = disconnectTimers[finalNick] !== undefined;
    if (isReconnect) {
      clearTimeout(disconnectTimers[finalNick]);
      delete disconnectTimers[finalNick];
      // Remove entrada antiga (socket antigo já está morto)
      users = users.filter(u => u.nick !== finalNick);
    } else {
      // Só adiciona sufixo se não for reconexão e nick estiver em uso
      let count = 1;
      let candidate = finalNick;
      while (users.some(u => u.nick === candidate)) {
        candidate = finalNick + '_' + count++;
      }
      finalNick = candidate;
    }

    // Avatar: string base64 curta (64x64 JPEG ~3KB), limita tamanho
    const safeAvatar = (typeof avatar === 'string' && avatar.startsWith('data:image') && avatar.length < 20000)
      ? avatar : null;

    socket.nick   = finalNick;
    socket.avatar = safeAvatar;
    users.push({ id: socket.id, nick: finalNick, avatar: safeAvatar });

    // Calcula posição atual considerando se está pausado
    let position = 0;
    if (currentTrack) {
      if (isPlaying && startedAt) {
        position = Date.now() - startedAt;
      } else if (!isPlaying && pausedAt !== null) {
        position = pausedAt;
      }
    }

    // Manda estado atual só para quem entrou
    socket.emit('welcome', {
      nick: finalNick,
      users: users.map(u => ({ nick: u.nick, avatar: u.avatar })),
      queue,
      currentTrack,
      isPlaying,
      position,
    });

    io.emit('users', users.map(u => ({ nick: u.nick, avatar: u.avatar })));
    if (!isReconnect) {
      io.emit('chat', { nick: 'sistema', message: `${finalNick} entrou na sala ♪`, system: true });
    }
  });

  // Sync sob demanda (quando cliente volta do background)
  socket.on('requestSync', () => {
    let position = 0;
    if (currentTrack) {
      if (isPlaying && startedAt) {
        position = Date.now() - startedAt;
      } else if (!isPlaying && pausedAt !== null) {
        position = pausedAt;
      }
    }
    socket.emit('syncState', { currentTrack, isPlaying, position });
  });

  // Chat
  socket.on('chat', (msg) => {
    if (!socket.nick || !msg || msg.trim().length === 0) return;
    const safe = String(msg).slice(0, 200);
    io.emit('chat', { nick: socket.nick, message: safe, system: false });
  });

  // Tocar música — só aceita se não tiver nada tocando (chamado pelo cliente que colou link e sala estava vazia)
  socket.on('playTrack', (track) => {
    if (!socket.nick) return;
    track.addedBy = socket.nick;
    currentTrack = track;
    isPlaying = true;
    startedAt = Date.now();
    pausedAt  = null;

    io.emit('playTrack', { track, startedAt });
    io.emit('chat', { nick: 'sistema', message: `${socket.nick} tocando: ${track.name} — ${track.artist}`, system: true });
  });

  // Adicionar à fila — usado quando já tem algo tocando
  socket.on('addQueue', (track) => {
    if (!socket.nick) return;
    // Evita duplicata na fila
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
    // Salva posição em ms onde pausou
    pausedAt = (startedAt) ? Date.now() - startedAt : 0;
    io.emit('pause');
  });

  socket.on('resume', () => {
    if (!socket.nick) return;
    isPlaying = true;
    // Recalcula startedAt baseado na posição pausada
    startedAt = Date.now() - (pausedAt || 0);
    pausedAt  = null;
    io.emit('resume');
  });

  // Desconectou — grace period de 20s antes de remover da sala
  socket.on('disconnect', () => {
    if (!socket.nick) return;
    const nick = socket.nick;
    console.log('Desconectou (aguardando reconexão):', nick);

    // Remove do array de users imediatamente para não duplicar no reconnect
    users = users.filter(u => u.id !== socket.id);
    // Atualiza lista para todos (usuário some visualmente)
    io.emit('users', users.map(u => ({ nick: u.nick, avatar: u.avatar })));

    // Grace period: 20s para reconectar sem aparecer mensagem de "saiu"
    disconnectTimers[nick] = setTimeout(() => {
      delete disconnectTimers[nick];
      io.emit('chat', { nick: 'sistema', message: `${nick} saiu`, system: true });
      console.log('Saiu definitivamente:', nick);
    }, 20000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Hynora rodando na porta ${PORT}`));
