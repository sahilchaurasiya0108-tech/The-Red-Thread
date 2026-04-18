import Message from './models/Message.js';
import Presence from './models/Presence.js';
import { notifyNewMessage } from './push.js';

const ALLOWED_USERS = ['sahil', 'gauri'];

// Track connected socket IDs → userId
// ONLY sockets that called joinThread (real thread users) go here.
// watchThread sockets (background notification listeners) are NOT added here,
// so they never falsely inflate recipientIsOnline or presence.
const connectedUsers = new Map(); // socketId → userId

export function initSocket(io) {
  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // ── joinThread ───────────────────────────────────────────────────────────
    socket.on('joinThread', async ({ userId } = {}) => {
      if (!ALLOWED_USERS.includes(userId)) {
        socket.emit('error', { message: 'Not allowed.' });
        socket.disconnect(true);
        return;
      }

      connectedUsers.set(socket.id, userId);
      socket.join('red-thread');

      console.log(`✨ ${userId} joined the thread`);

      await Presence.findOneAndUpdate(
        { userId },
        { isOnline: true, lastSeen: null },
        { upsert: true, new: true }
      );

      socket.to('red-thread').emit('presence', { userId, status: 'here' });

      const otherId = userId === 'sahil' ? 'gauri' : 'sahil';
      const otherPresence = await Presence.findOne({ userId: otherId }).lean();
      if (otherPresence) {
        socket.emit('presence', {
          userId: otherId,
          status: otherPresence.isOnline ? 'here' : 'gone',
          lastSeen: otherPresence.lastSeen,
        });
      }

      // ── On join: auto-mark messages from the OTHER user as seen ─────────────
      try {
        const sender = otherId;
        const unseenMessages = await Message.find({
          threadId: 'red-thread',
          sender,
          seen: false,
        }).select('_id').lean();

        if (unseenMessages.length > 0) {
          const messageIds = unseenMessages.map((m) => m._id);
          await Message.updateMany({ _id: { $in: messageIds } }, { $set: { seen: true } });

          socket.to('red-thread').emit('messagesSeenUpdate', {
            messageIds: messageIds.map(String),
            seenBy: userId,
          });
        }
      } catch (err) {
        console.error('joinThread auto-seen error:', err);
      }
    });

    // ── pullThread ───────────────────────────────────────────────────────────
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

    // ── watchThread ──────────────────────────────────────────────────────────
    // Passive listener for background notification sockets (AppLayout / context).
    // Joins the room to receive threadMoved events but does NOT register in
    // connectedUsers — so it never falsely marks the user as "online" for
    // presence or for read-receipt (seen: true) purposes.
    socket.on('watchThread', async ({ userId } = {}) => {
      if (!ALLOWED_USERS.includes(userId)) return;

      // Join the room so this socket receives threadMoved broadcasts
      socket.join('red-thread');

      // Send history so the watcher can deduplicate old messages
      try {
        const messages = await Message.find({ threadId: 'red-thread' })
          .sort({ createdAt: 1 })
          .limit(200)
          .select('_id sender')
          .lean();
        socket.emit('threadHistory', { messages });
      } catch (_) {}

      // No presence update, no connectedUsers registration — intentionally passive
    });

    // ── threadMoved ──────────────────────────────────────────────────────────
    socket.on('threadMoved', async ({ sender, text, replyTo } = {}) => {
      if (!ALLOWED_USERS.includes(sender)) return;
      if (!text || !text.trim()) return;

      try {
        let replyToDoc = undefined;
        if (replyTo && replyTo._id && replyTo.text && ALLOWED_USERS.includes(replyTo.sender)) {
          replyToDoc = {
            _id: replyTo._id,
            text: String(replyTo.text).slice(0, 500),
            sender: replyTo.sender,
          };
        }

        const recipientId = sender === 'sahil' ? 'gauri' : 'sahil';
        const recipientIsOnline = [...connectedUsers.values()].includes(recipientId);

        // Always save as seen: false — we mark it seen via a separate event
        // so the sender sees a single tick first, then double tick after seen update
        const message = await Message.create({
          threadId: 'red-thread',
          sender,
          text: text.trim(),
          seen: false,
          ...(replyToDoc ? { replyTo: replyToDoc } : {}),
        });

        // Broadcast to everyone in the room (message arrives with seen: false = single tick)
        io.to('red-thread').emit('threadMoved', { message });

        // Clear typing indicator for sender
        socket.to('red-thread').emit('stopTyping', { sender });

        // If recipient is already in the room, mark seen immediately and notify sender
        if (recipientIsOnline) {
          await Message.updateOne({ _id: message._id }, { $set: { seen: true } });
          // Notify the SENDER only so their tick updates to double-tick
          socket.emit('messagesSeenUpdate', {
            messageIds: [String(message._id)],
            seenBy: recipientId,
          });
        }

        // ── Web Push to recipient if they are NOT in the socket room ──────────
        // If they're online in the room they see it live — no push needed.
        // If they're offline (app closed, phone locked) — fire the push.
        if (!recipientIsOnline) {
          notifyNewMessage(sender, text.trim()).catch((err) => {
            console.error('push notify error:', err.message);
          });
        }
      } catch (err) {
        console.error('threadMoved error:', err);
        socket.emit('error', { message: 'Message could not be saved.' });
      }
    });

    // ── typing ───────────────────────────────────────────────────────────────
    socket.on('typing', ({ sender } = {}) => {
      if (!ALLOWED_USERS.includes(sender)) return;
      socket.to('red-thread').emit('typing', { sender });
    });

    // ── stopTyping ───────────────────────────────────────────────────────────
    socket.on('stopTyping', ({ sender } = {}) => {
      if (!ALLOWED_USERS.includes(sender)) return;
      socket.to('red-thread').emit('stopTyping', { sender });
    });

    // ── messageSeen ──────────────────────────────────────────────────────────
    socket.on('messageSeen', async ({ viewer } = {}) => {
      if (!ALLOWED_USERS.includes(viewer)) return;

      const sender = viewer === 'sahil' ? 'gauri' : 'sahil';

      try {
        const unseenMessages = await Message.find({
          threadId: 'red-thread',
          sender,
          seen: false,
        }).select('_id').lean();

        if (unseenMessages.length === 0) return;

        const messageIds = unseenMessages.map((m) => m._id);

        await Message.updateMany(
          { _id: { $in: messageIds } },
          { $set: { seen: true } }
        );

        socket.to('red-thread').emit('messagesSeenUpdate', {
          messageIds: messageIds.map(String),
          seenBy: viewer,
        });
      } catch (err) {
        console.error('messageSeen error:', err);
      }
    });

    // ── disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      const userId = connectedUsers.get(socket.id);
      connectedUsers.delete(socket.id);

      if (!userId) return;

      socket.to('red-thread').emit('stopTyping', { sender: userId });

      const hasOtherSockets = [...connectedUsers.values()].includes(userId);
      if (hasOtherSockets) return;

      const lastSeen = new Date();

      await Presence.findOneAndUpdate(
        { userId },
        { isOnline: false, lastSeen },
        { upsert: true }
      );

      console.log(`👋 ${userId} left the thread`);

      socket.to('red-thread').emit('presence', {
        userId,
        status: 'gone',
        lastSeen,
      });
    });
  });
}