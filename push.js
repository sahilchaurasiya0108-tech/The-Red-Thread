/**
 * push.js — Red Thread Web Push utility
 *
 * Sends a push notification to all registered devices of a given userId.
 * Silently no-ops if web-push is not installed or VAPID keys are missing.
 *
 * SETUP (in .env):
 *   VAPID_PUBLIC_KEY=...
 *   VAPID_PRIVATE_KEY=...
 *   VAPID_SUBJECT=mailto:you@example.com
 *   SAHILOS_URL=https://your-sahilos-url.com     ← click opens SahilOS thread
 *   NOORI_URL=https://your-noori-url.com          ← click opens Noori thread
 *
 * Generate VAPID keys once:
 *   npx web-push generate-vapid-keys
 *
 * Install:
 *   npm install web-push
 */

import PushSubscription from './models/PushSubscription.js';

let webpush = null;

try {
  const wp = await import('web-push');
  webpush = wp.default ?? wp;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@redthread.app',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    console.log('🔔 Web Push ready (VAPID configured)');
  } else {
    webpush = null;
    console.warn('⚠️  VAPID keys missing — push notifications disabled. Add VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to .env');
  }
} catch (_) {
  console.warn('⚠️  web-push not installed — run: npm install web-push');
}

// ── Public key endpoint ───────────────────────────────────────────────────────
export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// ── Core push sender ──────────────────────────────────────────────────────────
/**
 * Send a push to all devices registered for `recipientId`.
 * @param {string} recipientId  'sahil' | 'gauri'
 * @param {object} payload      { title, body, url }
 */
export async function sendPushToUser(recipientId, { title, body, url = '/' }) {
  if (!webpush) return;

  let subs;
  try {
    subs = await PushSubscription.find({ userId: recipientId }).lean();
  } catch (err) {
    console.error('push: DB error fetching subscriptions:', err.message);
    return;
  }

  if (!subs.length) return;

  const payloadStr = JSON.stringify({
    title,
    body,
    url,
    icon:  '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // Unique tag = every push shows separately (no silent replacement)
    tag: `thread-${Date.now()}`,
  });

  const results = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification(s.subscription, payloadStr))
  );

  // Clean up expired / unsubscribed endpoints (410 Gone / 404 Not Found)
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      const code = results[i].reason?.statusCode;
      if (code === 404 || code === 410) {
        try {
          await PushSubscription.deleteOne({ 'subscription.endpoint': subs[i].subscription.endpoint });
        } catch (_) {}
      }
    }
  }
}

/**
 * Notify the *recipient* (the other person) of a new message.
 * Called inside socket.js after a message is saved.
 *
 * @param {string} sender  'sahil' | 'gauri'
 * @param {string} text    message text (truncated for preview)
 */
export async function notifyNewMessage(sender, text) {
  const recipient = sender === 'sahil' ? 'gauri' : 'sahil';

  // Personalised lines per recipient
  const sahilLines = [
    "oh, she replied",
    "that didn't take long",
    "someone's here",
    "you might wanna check this",
    "well… that was fast",
    "guess who's back",
    "she said something",
    "don't keep her waiting",
    "new message. just so you know",
    "the thread moved",
  ];

  const gauriLines = [
    "he's here…",
    "you got something",
    "maybe check?",
    "he didn't wait long",
    "somebody's missing you... again",
    "he reached out",
    "he typed something… for you",
    "he came back",
    "you have a message, shehzadi",
    "the thread moved",
  ];

  // Rare dramatic escalation for Gauri (1 in 5)
  const gauriDramatic = [
    "SHEHZADI SAHIBA!!!!",
    "WHY DON'T YOU REPLY?",
    "Remember, he doesn't have patience",
    "hello?? he's literally right there",
  ];

  let notifTitle;
  if (recipient === 'sahil') {
    notifTitle = sahilLines[Math.floor(Math.random() * sahilLines.length)];
  } else {
    const useDramatic = Math.random() < 0.2;
    const pool = useDramatic ? gauriDramatic : gauriLines;
    notifTitle = pool[Math.floor(Math.random() * pool.length)];
  }

  // Truncate message preview
  const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;

  // Deep-link: clicking the push opens the thread page directly
  const threadUrl = recipient === 'sahil'
    ? `${process.env.SAHILOS_URL || ''}/thread`
    : `${process.env.NOORI_URL || ''}/thread`;

  await sendPushToUser(recipient, {
    title: notifTitle,
    body: preview,
    url: threadUrl,
  });
}
