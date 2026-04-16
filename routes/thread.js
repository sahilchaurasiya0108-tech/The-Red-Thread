import { Router } from 'express';
import Message from '../models/Message.js';
import Presence from '../models/Presence.js';

const router = Router();

const ALLOWED_USERS = ['sahil', 'gauri'];

// ── GET /thread/messages — load history (last 200 messages) ──────────────────
router.get('/messages', async (req, res) => {
  try {
    const messages = await Message.find({ threadId: 'red-thread' })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();
    res.json({ ok: true, messages });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /thread/messages — send a message via REST (fallback) ───────────────
router.post('/messages', async (req, res) => {
  const { sender, text } = req.body;

  if (!ALLOWED_USERS.includes(sender)) {
    return res.status(403).json({ ok: false, error: 'Not allowed.' });
  }
  if (!text || !text.trim()) {
    return res.status(400).json({ ok: false, error: 'Empty message.' });
  }

  try {
    const message = await Message.create({
      threadId: 'red-thread',
      sender,
      text: text.trim(),
    });
    res.status(201).json({ ok: true, message });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /thread/messages/seen — mark messages as seen ─────────────────────
router.patch('/messages/seen', async (req, res) => {
  const { viewer } = req.body; // the user who is reading (marks OTHER person's messages as seen)
  if (!ALLOWED_USERS.includes(viewer)) {
    return res.status(403).json({ ok: false, error: 'Not allowed.' });
  }

  const sender = viewer === 'sahil' ? 'gauri' : 'sahil';
  try {
    await Message.updateMany(
      { threadId: 'red-thread', sender, seen: false },
      { $set: { seen: true } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /thread/presence — get both users' presence ─────────────────────────
router.get('/presence', async (req, res) => {
  try {
    const records = await Presence.find({}).lean();
    // Build a clean map
    const presence = {};
    for (const r of records) {
      presence[r.userId] = { isOnline: r.isOnline, lastSeen: r.lastSeen };
    }
    // Fill missing users with defaults
    for (const u of ALLOWED_USERS) {
      if (!presence[u]) presence[u] = { isOnline: false, lastSeen: null };
    }
    res.json({ ok: true, presence });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
