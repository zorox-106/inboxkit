# ⬡ GridWars — Real-Time Shared Grid Game

GridWars is a fast, multiplayer, territory-control grid game. Players join a shared $50 \times 50$ (2,500 cells) grid, claim tiles in real-time, compete on a live leaderboard, and watch the board update instantly as others capture cells.

🔗 **Live Demo: [https://gridwars-yk0i.onrender.com/](https://gridwars-yk0i.onrender.com/)**

---

## 🚀 Tech Stack

We selected a lightweight, high-performance tech stack tailored for low latency and smooth rendering:

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | Vanilla HTML5 + CSS3 + Canvas API | Renders thousands of cells at 60 FPS easily with zero framework overhead. Canvas enables high-performance scrolling, zoom/pan, custom ripple animations, and dirty-rect culling. |
| **Backend** | Node.js + Express | Lightweight, event-driven, single-threaded runtime perfectly suited for handling high-frequency WebSocket traffic. |
| **Real-Time Layer** | WebSocket (`ws` library) | Pure, native WebSockets provide minimal overhead (saving ~30-40% byte size compared to Socket.IO engine wraps) for instantaneous state synchronization. |
| **Database** | SQLite (`better-sqlite3`) | Low-latency, file-based database. Using **WAL (Write-Ahead Logging) mode** enables fast concurrent reads and synchronous writes to persist board captures across server restarts. |

---

## ⚡ Conflict Resolution & Protocol Strategy

In a fast-paced multiplayer grid game, multiple users can click the exact same tile at almost the same time. GridWars handles this using an **Optimistic UI + Server-Authoritative Serialized Execution** strategy:

1. **Optimistic Updates**: When a player clicks a tile, the frontend instantly plays a capture ripple, updates their local cell count, and colors the cell (high responsiveness, zero perceived lag).
2. **Server Authority**: The claim event is sent to the server. Because Node.js is single-threaded, it naturally processes WebSocket messages one by one (acting as a FIFO queue). The first message to hit the server wins the claim.
3. **Rollbacks**: If the claim is rejected (e.g. user is on cooldown, or another player claimed it milliseconds earlier), the server sends a `CLAIM_REJECTED` command, and the frontend automatically reverts the cell to its previous state.
4. **Cooldown Enforcement**: A server-enforced **2-second cooldown** prevents spam and keeps the gameplay strategic.

---

## 📦 Project Structure

```
inboxkit/
├── client/
│   ├── index.html       # Single Page Application layout
│   ├── style.css        # Modern glassmorphism dark-theme style system
│   └── app.js           # Canvas renderer, zoom/pan camera, and WebSocket client
├── server/
│   ├── index.js         # Entry point: HTTP & WebSocket Server
│   ├── grid.js          # In-memory grid controller and claim validations
│   ├── users.js         # User registration and active session management
│   ├── db.js            # SQLite connection, schemas, and state updates
│   ├── broadcast.js     # WebSocket publishing utilities
│   └── uuid.js          # Lightweight session identifier helper
├── package.json         # Package configuration
└── README.md            # Project documentation
```

---

## ✨ Features

- 🎮 **Optimistic Territory Capture**: Seamless clicking feeling with server verification.
- 🎨 **Unique Player Branding**: Players are automatically assigned one of 20 hand-picked HSL colors upon joining.
- ⏱️ **Server-Enforced Cooldowns**: Visual countdown bar in the footer keeping inputs clean.
- 🔍 **Smooth Canvas Nav**: Mouse drag panning, mouse wheel zoom, double-finger touch scale, and keyboard shortcuts.
- 🗺️ **Interactive Mini-Map**: Dynamic top-down overview of the whole canvas with viewport bounding indicators.
- 🏆 **Live Leaderboard**: Scoreboard updating rankings and cell bar widths on every single claim.
- 🔔 **Activity Feed**: Feed detailing recent actions ("User joined", "User captured block").
- 💾 **State Persistence**: Survives server crashes or restarts by caching snapshot states inside SQLite.

---

## 🛠️ How to Run Locally

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed (v16+ recommended).

### 1. Clone the repository
```bash
git clone https://github.com/zorox-106/inboxkit.git
cd inboxkit
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start the application
```bash
npm start
```
The server will initialize a fresh local database (`grid.db`) and listen at:
👉 **`http://localhost:3001`**

### 4. Play with others
Open multiple browser tabs at `http://localhost:3001` to test real-time grid synchronization, steal cells from yourself, and watch the live leaderboard adapt!