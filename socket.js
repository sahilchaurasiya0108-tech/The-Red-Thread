import Message from './models/Message.js';
import Presence from './models/Presence.js';

const ALLOWED_USERS = ['sahil', 'gauri'];

// Track connected socket IDs → userId
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
      // This handles the case where both users are online when a message arrives:
      // the recipient is already in the room so they see it immediately.
      try {
        const sender = otherId; // messages FROM the other person, seen by this person
        const unseenMessages = await Message.find({
          threadId: 'red-thread',
          sender,
          seen: false,
        }).select('_id').lean();

        if (unseenMessages.length > 0) {
          const messageIds = unseenMessages.map((m) => m._id);
          await Message.updateMany({ _id: { $in: messageIds } }, { $set: { seen: true } });

          // Tell the sender their messages are now seen
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

        // Check if the OTHER user is currently online in the room
        // If they are, mark the message as already seen immediately
        const recipientId = sender === 'sahil' ? 'gauri' : 'sahil';
        const recipientIsOnline = [...connectedUsers.values()].includes(recipientId);

        const message = await Message.create({
          threadId: 'red-thread',
          sender,
          text: text.trim(),
          seen: recipientIsOnline, // ← already seen if recipient is live in the room
          ...(replyToDoc ? { replyTo: replyToDoc } : {}),
        });

        // Broadcast to everyone in the room (including sender for confirmation)
        io.to('red-thread').emit('threadMoved', { message });

        // Clear typing indicator for sender on the other side
        socket.to('red-thread').emit('stopTyping', { sender });

        // If recipient was online, immediately tell the sender their msg is seen
        if (recipientIsOnline) {
          socket.emit('messagesSeenUpdate', {
            messageIds: [String(message._id)],
            seenBy: recipientId,
          });
        }
      } catch (err) {
        console.error('threadMoved error:', err);
        socket.emit('error', { message: 'Message could not be saved.' });
      }
    });

    // ── typing ───────────────────────────────────────────────────────────────
    // Client sends: { sender }
    socket.on('typing', ({ sender } = {}) => {
      if (!ALLOWED_USERS.includes(sender)) return;
      // Forward to everyone else in the room (i.e. the other person)
      socket.to('red-thread').emit('typing', { sender });
    });

    // ── stopTyping ───────────────────────────────────────────────────────────
    // Client sends: { sender }
    socket.on('stopTyping', ({ sender } = {}) => {
      if (!ALLOWED_USERS.includes(sender)) return;
      socket.to('red-thread').emit('stopTyping', { sender });
    });

    // ── messageSeen ──────────────────────────────────────────────────────────
    // Client sends: { viewer } — marks all unseen messages FROM the other user as seen
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

        // Tell the original sender that their messages are now seen
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

      // Clear any active typing state for this user
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