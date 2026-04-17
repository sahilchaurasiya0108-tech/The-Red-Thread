/**
 * push.js — Red Thread Web Push utility
 *
 * FIXES:
 * 1. Dynamic import of web-push sometimes ran before dotenv loaded env vars.
 *    Switched to a synchronous-safe initialization inside the module.
 * 2. SAHILOS_URL / NOORI_URL were not set in Render env → threadUrl was ''
 *    → push notification had no URL to open. Added fallbacks + console warning.
 * 3. Added TTL to sendNotification options (4 hours) so pushes don't expire
 *    silently while the phone is offline, and get delivered when it reconnects.
 *
 * SETUP (in .env / Render env vars):
 *   VAPID_PUBLIC_KEY=...
 *   VAPID_PRIVATE_KEY=...
 *   VAPID_SUBJECT=mailto:you@example.com
 *   SAHILOS_URL=https://sahilos.vercel.app     ← ADD THIS to Render
 *   NOORI_URL=https://noori-one.vercel.app      ← ADD THIS to Render
 *
 * Generate VAPID keys once:
 *   npx web-push generate-vapid-keys
 */

import PushSubscription from './models/PushSubscription.js';

let webpush = null;

// FIX: Use a named async init function so the module initializes cleanly.
// The top-level await was racing with dotenv in some environments.
async function initWebPush() {
  try {
    const wp = await import('web-push');
    const wpModule = wp.default ?? wp;

    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;

    if (pub && priv) {
      wpModule.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@redthread.app',
        pub,
        priv
      );
      webpush = wpModule;
      console.log('🔔 Web Push ready (VAPID configured)');
    } else {
      console.warn(
        '⚠️  VAPID keys missing — push notifications disabled.\n' +
        '   Add VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to .env (and to Render env vars)'
      );
    }
  } catch (err) {
    console.warn('⚠️  web-push not installed — run: npm install web-push\n', err.message);
  }
}

// Run init immediately (top-level await equivalent, but works in all Node versions)
await initWebPush();

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
    tag: `thread-${Date.now()}`,
  });

  // FIX: Added TTL (4 hours = 14400s). Without TTL, some push services
  // drop the notification if the device is offline when the push is sent.
  // With TTL, it will be delivered when the phone comes back online.
  const pushOptions = {
    TTL: 14400,
    urgency: 'high', // tells FCM/APNs to deliver immediately, not batch
  };

  const results = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification(s.subscription, payloadStr, pushOptions))
  );

  // Clean up expired / unsubscribed endpoints
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      const code = results[i].reason?.statusCode;
      console.error(`push: failed for ${recipientId}, code=${code}`, results[i].reason?.message);
      if (code === 404 || code === 410) {
        try {
          await PushSubscription.deleteOne({ 'subscription.endpoint': subs[i].subscription.endpoint });
          console.log('push: removed expired subscription for', recipientId);
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

  const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;

  // FIX: SAHILOS_URL and NOORI_URL must be set in Render's env vars.
  // Without them, threadUrl is '' and the notification click opens nothing.
  const sahilosUrl = process.env.SAHILOS_URL;
  const nooriUrl   = process.env.NOORI_URL;

  if (!sahilosUrl || !nooriUrl) {
    console.warn(
      '⚠️  SAHILOS_URL or NOORI_URL not set in env vars!\n' +
      '   Notification clicks will not navigate to the thread.\n' +
      '   Add these to your .env and to Render environment variables.'
    );
  }

  const threadUrl = recipient === 'sahil'
    ? `${sahilosUrl || ''}/thread`
    : `${nooriUrl || ''}/thread`;

  await sendPushToUser(recipient, {
    title: notifTitle,
    body: preview,
    url: threadUrl,
  });
}