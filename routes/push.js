/**
 * routes/push.js — Red Thread push subscription management
 *
 * Routes:
 *   GET  /push/vapid-key          → returns VAPID public key
 *   POST /push/subscribe          → register a push subscription
 *   DELETE /push/unsubscribe      → remove a push subscription
 *
 * userId must be 'sahil' or 'gauri' — sent by the client.
 * No auth middleware needed (the two-person model is trust-based).
 */

import { Router } from 'express';
import PushSubscription from '../models/PushSubscription.js';
import { getVapidPublicKey } from '../push.js';

const router = Router();

const ALLOWED_USERS = ['sahil', 'gauri'];

// ── GET /push/vapid-key ───────────────────────────────────────────────────────
router.get('/vapid-key', (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    return res.status(503).json({ ok: false, error: 'Push not configured on server.' });
  }
  res.json({ ok: true, publicKey: key });
});

// ── POST /push/subscribe ──────────────────────────────────────────────────────
router.post('/subscribe', async (req, res) => {
  const { userId, subscription, label = '' } = req.body;

  if (!ALLOWED_USERS.includes(userId)) {
    return res.status(403).json({ ok: false, error: 'Not allowed.' });
  }
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ ok: false, error: 'Invalid subscription object.' });
  }

  try {
    await PushSubscription.findOneAndUpdate(
      { 'subscription.endpoint': subscription.endpoint },
      { userId, subscription, label },
      { upsert: true, new: true }
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('push subscribe error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /push/unsubscribe ──────────────────────────────────────────────────
router.delete('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;

  if (!endpoint) {
    return res.status(400).json({ ok: false, error: 'endpoint required' });
  }

  try {
    await PushSubscription.deleteOne({ 'subscription.endpoint': endpoint });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
