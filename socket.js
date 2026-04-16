import Message from './models/Message.js';
import Presence from './models/Presence.js';

const ALLOWED_USERS = ['sahil', 'gauri'];

// Track connected socket IDs → userId
const connectedUsers = new Map(); // socketId → userId

export function initSocket(io) {
  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // ── joinThread ───────────────────────────────────────────────────────────
    // Client sends: { userId: "sahil" | "gauri" }
    socket.on('joinThread', async ({ userId } = {}) => {
      if (!ALLOWED_USERS.includes(userId)) {
        socket.emit('error', { message: 'Not allowed.' });
        socket.disconnect(true);
        return;
      }

      connectedUsers.set(socket.id, userId);
      socket.join('red-thread');

      console.log(`✨ ${userId} joined the thread`);

      // Update presence → online
      await Presence.findOneAndUpdate(
        { userId },
        { isOnline: true, lastSeen: null },
        { upsert: true, new: true }
      );

      // Broadcast presence update to the OTHER user
      const presencePayload = { userId, status: 'here' };
      socket.to('red-thread').emit('presence', presencePayload);

      // Also send the current presence of the other user back to THIS socket
      const otherId = userId === 'sahil' ? 'gauri' : 'sahil';
      const otherPresence = await Presence.findOne({ userId: otherId }).lean();
      if (otherPresence) {
        socket.emit('presence', {
          userId: otherId,
          status: otherPresence.isOnline ? 'here' : 'gone',
          lastSeen: otherPresence.lastSeen,
        });
      }
    });

    // ── pullThread ───────────────────────────────────────────────────────────
    // Client sends: { userId } — server replies with recent messages
    socket.on('pullThread', async ({ userId } = {}) => {
      if (!ALLOWED_USERS.includes(userId)) return;

      try {
        const messages = await Message.find({ threadId: 'red-thread' })
          .sort({ createdAt: 1 })
          .limit(200)
          .lean();

        socket.emit('threadHistory', { messages });
      } catch (err) {
        socket.emit('error', { message: 'Could not load messages.' });
      }
    });

    // ── threadMoved ──────────────────────────────────────────────────────────
    // Client sends: { sender, text, replyTo? }
    // replyTo shape: { _id, text, sender } | null
    // Server saves and broadcasts — replyTo snapshot is persisted.
    socket.on('threadMoved', async ({ sender, text, replyTo } = {}) => {
      if (!ALLOWED_USERS.includes(sender)) return;
      if (!text || !text.trim()) return;

      try {
        // Build replyTo sub-document only if valid
        let replyToDoc = undefined;
        if (
          replyTo &&
          replyTo._id &&
          replyTo.text &&
          ALLOWED_USERS.includes(replyTo.sender)
        ) {
          replyToDoc = {
            _id: replyTo._id,
            // Snapshot: truncate to 500 chars so stored text is bounded
            text: String(replyTo.text).slice(0, 500),
            sender: replyTo.sender,
          };
        }

        const message = await Message.create({
          threadId: 'red-thread',
          sender,
          text: text.trim(),
          ...(replyToDoc ? { replyTo: replyToDoc } : {}),
        });

        // Broadcast to everyone in the room (including sender for confirmation)
        io.to('red-thread').emit('threadMoved', { message });
      } catch (err) {
        console.error('threadMoved error:', err);
        socket.emit('error', { message: 'Message could not be saved.' });
      }
    });

    // ── disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      const userId = connectedUsers.get(socket.id);
      connectedUsers.delete(socket.id);

      if (!userId) return;

      // Check if this user has other sockets still connected
      const hasOtherSockets = [...connectedUsers.values()].includes(userId);
      if (hasOtherSockets) return; // still connected on another tab

      const lastSeen = new Date();

      // Update presence → offline
      await Presence.findOneAndUpdate(
        { userId },
        { isOnline: false, lastSeen },
        { upsert: true }
      );

      console.log(`👋 ${userId} left the thread`);

      // Notify the other user
      socket.to('red-thread').emit('presence', {
        userId,
        status: 'gone',
        lastSeen,
      });
    });
  });
}