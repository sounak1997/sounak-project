const { Server } = require('socket.io');
const redis = require('./redis.config');

const ROOMS = [
  { id: 'general',       name: '# general',       description: 'General chat for everyone' },
  { id: 'tech',          name: '# tech',           description: 'Tech & coding discussions' },
  { id: 'announcements', name: '# announcements',  description: 'Important updates' },
  { id: 'random',        name: '# random',         description: 'Off-topic conversations' },
];

const MAX_HISTORY = 50;

// socketId → { userId, username, roomId }
const socketUsers = new Map();

// userId → { username, socketId }  — one entry per user (last active socket wins)
const globalOnline = new Map();

const setupSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
  });

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);
    socket.emit('room-list', ROOMS);

    // ── GET ALL REGISTERED USERS (with online status) ──────────────────────
    // Called by frontend on connect so sidebar shows everyone, not just room members
    socket.on('get-all-users', async () => {
      socket.emit('all-users', await fetchAllUsersWithStatus());
    });

    // ── JOIN CHANNEL ROOM ──────────────────────────────────────────────────
    socket.on('join-room', async ({ roomId, userId, username }) => {
      await leaveCurrentRoom(socket, io);

      socket.join(roomId);
      socketUsers.set(socket.id, { userId, username, roomId });
      globalOnline.set(userId, { username, socketId: socket.id });

      socket.emit('message-history', await getHistory(roomId));
      io.to(roomId).emit('online-users', getRoomUsers(roomId));
      io.to(roomId).emit('message', systemMsg(roomId, `${username} joined the room`));

      // Broadcast updated global user list so all clients update online dots
      io.emit('all-users-update', await fetchAllUsersWithStatus());

      console.log(`[WS] ${username} joined #${roomId}`);
    });

    // ── JOIN DIRECT MESSAGE ROOM ───────────────────────────────────────────
    // Creates a private room whose ID is deterministic from both user IDs
    socket.on('join-dm', async ({ targetUserId, targetUsername, myUserId, myUsername }) => {
      await leaveCurrentRoom(socket, io);

      const roomId = getDMRoomId(myUserId, targetUserId);

      socket.join(roomId);
      socketUsers.set(socket.id, { userId: myUserId, username: myUsername, roomId });
      globalOnline.set(myUserId, { username: myUsername, socketId: socket.id });

      socket.emit('message-history', await getHistory(roomId));

      // Tell the sender which DM room they joined (so frontend can update UI)
      socket.emit('dm-joined', { roomId, targetUserId, targetUsername });

      // If target user is online, notify them too so they can see incoming DM
      const targetSocket = globalOnline.get(targetUserId)?.socketId;
      if (targetSocket) {
        io.to(targetSocket).emit('dm-invite', {
          roomId, fromUserId: myUserId, fromUsername: myUsername,
        });
      }

      io.emit('all-users-update', await fetchAllUsersWithStatus());
      console.log(`[WS] DM: ${myUsername} → ${targetUsername} (room: ${roomId})`);
    });

    // ── SEND MESSAGE ───────────────────────────────────────────────────────
    socket.on('send-message', async ({ roomId, content, userId, username }) => {
      if (!content?.trim()) return;

      const message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        roomId, userId, username,
        content: content.trim(),
        timestamp: new Date().toISOString(),
        type: 'message',
      };

      try {
        const key = historyKey(roomId);
        await redis.lpush(key, JSON.stringify(message));
        await redis.ltrim(key, 0, MAX_HISTORY - 1);
        await redis.expire(key, 60 * 60 * 24);
      } catch { /* Redis unavailable — still broadcast */ }

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
    socket.on('disconnect', async () => {
      const user = socketUsers.get(socket.id);
      if (user) {
        const { userId, username, roomId } = user;
        socketUsers.delete(socket.id);
        globalOnline.delete(userId);

        if (roomId) {
          io.to(roomId).emit('online-users', getRoomUsers(roomId));
          io.to(roomId).emit('message', systemMsg(roomId, `${username} left the room`));
        }

        // Broadcast updated online status so everyone's dots update
        io.emit('all-users-update', await fetchAllUsersWithStatus());
      }
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Deterministic DM room ID — same for both users regardless of who initiates
const getDMRoomId = (uid1, uid2) => `dm_${[uid1, uid2].sort().join('_')}`;

const historyKey = (roomId) => `chat:history:${roomId}`;

const getHistory = async (roomId) => {
  try {
    const raw = await redis.lrange(historyKey(roomId), 0, MAX_HISTORY - 1);
    return raw.map(m => JSON.parse(m)).reverse();
  } catch { return []; }
};

const getRoomUsers = (roomId) =>
  [...socketUsers.values()]
    .filter(u => u.roomId === roomId)
    .map(u => ({ userId: u.userId, username: u.username }));

const systemMsg = (roomId, content) => ({
  id: `sys-${Date.now()}`, roomId,
  userId: 'system', username: 'System',
  content, timestamp: new Date().toISOString(), type: 'system',
});

// Fetch all users from MongoDB and merge with live online status
const fetchAllUsersWithStatus = async () => {
  try {
    const User = require('../models/User');
    const users = await User.find({}, 'name email _id').lean();
    return users.map(u => ({
      userId: u._id.toString(),
      username: u.name,
      email: u.email,
      online: globalOnline.has(u._id.toString()),
    }));
  } catch { return []; }
};

const leaveCurrentRoom = async (socket, io) => {
  const prev = socketUsers.get(socket.id);
  if (prev?.roomId) {
    socket.leave(prev.roomId);
    io.to(prev.roomId).emit('online-users', getRoomUsers(prev.roomId));
  }
};

module.exports = { setupSocket, ROOMS };
