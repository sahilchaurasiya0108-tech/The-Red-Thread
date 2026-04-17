import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import threadRouter from './routes/thread.js';
import pushRouter from './routes/push.js';
import { initSocket } from './socket.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/red-thread';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

// ── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

initSocket(io);

// ── REST routes ───────────────────────────────────────────────────────────────
app.use('/thread', threadRouter);

// Push subscription management (subscribe / unsubscribe / vapid-key)
app.use('/push', pushRouter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'alive',
    message: '🧵 The Red Thread is breathing…',
    ts: new Date(),
  });
});

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('🧵 MongoDB connected for Red Thread');
    server.listen(PORT, () => {
      console.log(`\n🔴 Red Thread Server running on http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err.message);
  server.close(() => process.exit(1));
});
