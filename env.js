// env.js — Load .env FIRST, before any other module reads process.env
// Import this as the very first line in server.js:
//   import './env.js';
//
// In ES modules, static imports are hoisted and run in dependency order.
// dotenv.config() inside server.js runs too late — by then push.js has
// already called initWebPush() and read process.env.VAPID_PUBLIC_KEY as undefined.

import dotenv from 'dotenv';
dotenv.config();