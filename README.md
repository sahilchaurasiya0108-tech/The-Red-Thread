# 🔴 The Red Thread

> A private, single-thread, two-soul communication bridge between SahilOS and Noori.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        The Red Thread                           │
│                                                                 │
│   SahilOS (Next.js)          red-thread-server          Noori  │
│   /thread/page.js  ◄────── Socket.IO + REST ──────►  Thread.jsx│
│                                    │                            │
│                              MongoDB Atlas                      │
│                         (messages + presence)                   │
└─────────────────────────────────────────────────────────────────┘
```

**Three services, one thread:**
- `red-thread-server` — standalone Node/Socket.IO/MongoDB server (port 4000)
- `SahilOS` — existing Next.js app (adds `/thread` page + sidebar item)
- `Noori` — existing React/Vite app (Chat.jsx → Thread.jsx, `/chat` → `/thread`)

---

## Folder Structure

```
red-thread-server/
├── server.js              ← Entry point (Express + Socket.IO)
├── socket.js              ← All socket event handlers
├── package.json
├── .env
├── models/
│   ├── Message.js         ← { threadId, sender, text, seen, createdAt }
│   └── Presence.js        ← { userId, isOnline, lastSeen }
└── routes/
    └── thread.js          ← REST: GET /messages, POST /messages, PATCH /seen, GET /presence

Noori-main/                ← Your existing Noori project
├── frontend/src/
│   ├── App.jsx            ← REPLACE with noori-thread/App.jsx
│   ├── pages/
│   │   └── Thread.jsx     ← ADD (from noori-thread/Thread.jsx) — replaces Chat.jsx
│   ├── components/
│   │   └── NavBar.jsx     ← REPLACE with noori-thread/NavBar.jsx
│   └── utils/
│       └── api.js         ← REPLACE with noori-thread/api.js
└── backend/
    └── server.js          ← REPLACE with noori-thread/noori-server.js

sahilos-main/              ← Your existing SahilOS project
└── frontend/
    ├── app/(app)/thread/
    │   └── page.js        ← ADD (from sahilos-thread/page.js)
    └── components/layout/
        └── Sidebar.jsx    ← REPLACE with sahilos-thread/Sidebar.jsx
```

---

## Step 1 — Set Up the Red Thread Server

### Install dependencies
```bash
cd red-thread-server
npm install
```

### Configure environment
```bash
cp .env.example .env
# Edit .env:
#   MONGODB_URI=mongodb://localhost:27017/red-thread
#   ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
#   PORT=4000
```

### Run in development
```bash
npm run dev
# → 🔴 Red Thread Server running on http://localhost:4000
```

---

## Step 2 — Update Noori

### Install Socket.IO client (in Noori frontend)
```bash
cd Noori-main/frontend
npm install socket.io-client date-fns
```

### Copy files
```bash
# Add Thread page
cp noori-thread/Thread.jsx Noori-main/frontend/src/pages/Thread.jsx

# Replace App.jsx (adds /thread route, removes /chat)
cp noori-thread/App.jsx Noori-main/frontend/src/App.jsx

# Replace NavBar (🔴 Thread replaces 💬 Chat)
cp noori-thread/NavBar.jsx Noori-main/frontend/src/components/NavBar.jsx

# Replace api.js (removes dead chat.message call)
cp noori-thread/api.js Noori-main/frontend/src/utils/api.js

# Replace backend server.js (removes /chat route + Groq import)
cp noori-thread/noori-server.js Noori-main/backend/server.js
```

### Update Noori's .env
```bash
# In Noori-main/frontend/.env (or .env.local)
VITE_API_URL=http://localhost:3001
VITE_RED_THREAD_URL=http://localhost:4000
```

### Remove Groq dependency (no longer needed)
```bash
cd Noori-main/backend
npm uninstall groq-sdk
```

You can also delete `Noori-main/backend/routes/chat.js` — it is no longer imported.

---

## Step 3 — Update SahilOS

### Install Socket.IO client + framer-motion (if not present)
```bash
cd sahilos-main/frontend
npm install socket.io-client framer-motion date-fns
```

### Copy files
```bash
# Add Thread page (create directory first)
mkdir -p sahilos-main/frontend/app/\(app\)/thread
cp sahilos-thread/page.js "sahilos-main/frontend/app/(app)/thread/page.js"

# Replace Sidebar (adds "The Thread" nav item)
cp sahilos-thread/Sidebar.jsx sahilos-main/frontend/components/layout/Sidebar.jsx
```

### Update SahilOS's .env
```bash
# In sahilos-main/frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_RED_THREAD_URL=http://localhost:4000
```

---

## Running Everything Together

Open **3 terminals**:

```bash
# Terminal 1 — Red Thread Server
cd red-thread-server && npm run dev

# Terminal 2 — Noori (backend)
cd Noori-main/backend && npm run dev   # or: node server.js

# Terminal 3 — Noori (frontend)
cd Noori-main/frontend && npm run dev  # → http://localhost:5173

# Terminal 4 — SahilOS (backend)
cd sahilos-main/backend && npm run dev # or: node server.js

# Terminal 5 — SahilOS (frontend)
cd sahilos-main/frontend && npm run dev # → http://localhost:3000
```

**Then open:**
- `http://localhost:5173` → Noori (Gauri's app) → go to Thread tab 🔴
- `http://localhost:3000` → SahilOS (Sahil's app) → click "The Thread" in sidebar

---

## Socket.IO Events Reference

| Event | Direction | Payload | Description |
|---|---|---|---|
| `joinThread` | Client → Server | `{ userId }` | Join the room + set online |
| `pullThread` | Client → Server | `{ userId }` | Request message history |
| `threadMoved` | Bidirectional | `{ sender, text }` / `{ message }` | Send / receive a message |
| `presence` | Server → Client | `{ userId, status, lastSeen }` | Presence update |
| `threadHistory` | Server → Client | `{ messages[] }` | Full message history on load |
| `error` | Server → Client | `{ message }` | Error (e.g. invalid userId) |

---

## Presence Display

| Viewer | Other is online | Other is offline |
|---|---|---|
| Sahil (SahilOS) | **She's here** | She was here 5 minutes ago / at 2:33 PM / on 12 Apr at 2:33 PM |
| Gauri (Noori) | **He's here** | He was here 5 minutes ago / at 2:33 PM / on 12 Apr at 2:33 PM |

**Formatting rules:**
- `< 1 min` → "just now"
- `< 60 mins` → "X minutes ago"
- `same day` → "at HH:MM AM/PM"
- `older` → "on DD Mon at HH:MM AM/PM"

---

## Security Model

The server enforces a hard allowlist — only `"sahil"` and `"gauri"` are valid user IDs. Any socket emitting `joinThread` with any other value is immediately disconnected. There is no auth token system because this is a private two-person system running on controlled deployments.

---

## Production Deployment (e.g. Render)

1. Deploy `red-thread-server` as a separate Web Service
2. Set env vars:
   ```
   MONGODB_URI=mongodb+srv://...
   ALLOWED_ORIGINS=https://noori.yourdomain.com,https://sahilos.yourdomain.com
   NODE_ENV=production
   PORT=4000
   ```
3. Update frontend `.env` files:
   ```
   VITE_RED_THREAD_URL=https://red-thread.yourdomain.com       # Noori
   NEXT_PUBLIC_RED_THREAD_URL=https://red-thread.yourdomain.com # SahilOS
   ```

---

## What Was Changed

### Noori
| File | Action |
|---|---|
| `frontend/src/pages/Chat.jsx` | **Replaced** → `Thread.jsx` (Red Thread UI) |
| `frontend/src/App.jsx` | **Modified** → `/chat` redirects to `/thread`, new Thread import |
| `frontend/src/components/NavBar.jsx` | **Modified** → 💬 Chat → 🔴 Thread |
| `frontend/src/utils/api.js` | **Modified** → removed `api.chat.message` |
| `backend/server.js` | **Modified** → removed `/chat` route import |
| `backend/routes/chat.js` | **Unused** → can be deleted |

### SahilOS
| File | Action |
|---|---|
| `frontend/app/(app)/thread/page.js` | **Added** → Red Thread page |
| `frontend/components/layout/Sidebar.jsx` | **Modified** → "The Thread" nav item added |

### New Service
| File | Description |
|---|---|
| `red-thread-server/server.js` | Express + Socket.IO entry point |
| `red-thread-server/socket.js` | All socket event logic |
| `red-thread-server/routes/thread.js` | REST endpoints |
| `red-thread-server/models/Message.js` | Message schema |
| `red-thread-server/models/Presence.js` | Presence schema |

---

*The thread is waiting.*
