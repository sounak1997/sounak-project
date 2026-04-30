const { Server } = require('socket.io');
const redis = require('./redis.config');

const ROOMS = [
  { id: 'general',       name: '# general',       description: 'General chat for everyone' },
  { id: 'tech',          name: '# tech',           description: 'Tech & coding discussions' },
  { id: 'announcements', name: '# announcements',  description: 'Important updates' },
  { id: 'random',        name: '# random',         description: 'Off-topic conversations' },
];

const MAX_HISTORY = 50; // messages stored per room in Redis

// socketId -> { userId, username, roomId }
const onlineUsers = new Map();

const setupSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
  });

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    // Send available rooms immediately on connect
    socket.emit('room-list', ROOMS);

    // ── JOIN ROOM ──────────────────────────────────────────────────────────
    socket.on('join-room', async ({ roomId, userId, username }) => {
      // Leave previous room if user was already in one
      const prev = onlineUsers.get(socket.id);
      if (prev?.roomId && prev.roomId !== roomId) {
        socket.leave(prev.roomId);
        onlineUsers.delete(socket.id);
        const prevOnline = getRoomUsers(prev.roomId);
        io.to(prev.roomId).emit('online-users', prevOnline);
        io.to(prev.roomId).emit('message', systemMsg(prev.roomId, `${username} left the room`));
      }

      socket.join(roomId);
      onlineUsers.set(socket.id, { userId, username, roomId });

      // Send message history from Redis
      try {
        const key = historyKey(roomId);
        const raw = await redis.lrange(key, 0, MAX_HISTORY - 1);
        const history = raw.map(m => JSON.parse(m)).reverse();
        socket.emit('message-history', history);
      } catch {
        socket.emit('message-history', []);
      }

      // Broadcast updated online users to the whole room
      io.to(roomId).emit('online-users', getRoomUsers(roomId));

      // System message to room
      io.to(roomId).emit('message', systemMsg(roomId, `${username} joined the room`));

      console.log(`[WS] ${username} joined #${roomId}`);
    });

    // ── SEND MESSAGE ───────────────────────────────────────────────────────
    socket.on('send-message', async ({ roomId, content, userId, username }) => {
      if (!content?.trim()) return;

      const message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        roomId,
        userId,
        username,
        content: content.trim(),
        timestamp: new Date().toISOString(),
        type: 'message',
      };

      // Persist to Redis (keep latest MAX_HISTORY messages)
      try {
        const key = historyKey(roomId);
        await redis.lpush(key, JSON.stringify(message));
        await redis.ltrim(key, 0, MAX_HISTORY - 1);
        await redis.expire(key, 60 * 60 * 24); // 24h TTL
      } catch {
        // Redis unavailable — still broadcast
      }

      io.to(roomId).emit('message', message);
    });

    // ── TYPING INDICATORS ──────────────────────────────────────────────────
    socket.on('typing', ({ roomId, username }) => {
      socket.to(roomId).emit('typing', { username, roomId });
    });

    socket.on('stop-typing', ({ roomId, username }) => {
      socket.to(roomId).emit('stop-typing', { username, roomId });
    });

    // ── DISCONNECT ─────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const user = onlineUsers.get(socket.id);
      if (user) {
        const { username, roomId } = user;
        onlineUsers.delete(socket.id);
        if (roomId) {
          io.to(roomId).emit('online-users', getRoomUsers(roomId));
          io.to(roomId).emit('message', systemMsg(roomId, `${username} left the room`));
        }
      }
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const historyKey = (roomId) => `chat:history:${roomId}`;

const getRoomUsers = (roomId) =>
  [...onlineUsers.values()]
    .filter(u => u.roomId === roomId)
    .map(u => ({ userId: u.userId, username: u.username }));

const systemMsg = (roomId, content) => ({
  id: `sys-${Date.now()}`,
  roomId,
  userId: 'system',
  username: 'System',
  content,
  timestamp: new Date().toISOString(),
  type: 'system',
});

module.exports = { setupSocket, ROOMS };
