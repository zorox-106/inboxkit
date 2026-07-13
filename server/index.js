const http = require('http');
const express = require('express');
const path = require('path');
const WebSocket = require('ws');

const { initGrid, getGridSnapshot, claimCell, getFullLeaderboard, getStats, COOLDOWN_MS } = require('./grid');
const { registerUser, removeUser, getOnlineUsers, onlineUsers } = require('./users');
const { broadcast, send } = require('./broadcast');

const PORT = process.env.PORT || 3001;

// --- Express app ---
const app = express();
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'client')));

// REST: grid snapshot (for debugging/external integrations)
app.get('/api/grid', (req, res) => {
  res.json({ grid: getGridSnapshot(), stats: getStats() });
});

// REST: leaderboard
app.get('/api/leaderboard', (req, res) => {
  res.json(getFullLeaderboard());
});

// --- HTTP server (shared between Express + WebSocket) ---
const server = http.createServer(app);

// --- WebSocket server ---
const wss = new WebSocket.Server({ server });

/**
 * Broadcast updated leaderboard to all clients.
 */
function broadcastLeaderboard() {
  broadcast(wss, {
    type: 'LEADERBOARD',
    payload: getFullLeaderboard(),
  });
}

/**
 * Broadcast online user list to all clients.
 */
function broadcastUserList() {
  broadcast(wss, {
    type: 'USER_LIST',
    payload: getOnlineUsers(),
  });
}

// Handle new WebSocket connections
wss.on('connection', (ws) => {
  let currentUser = null;

  ws.on('message', (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch {
      return; // Ignore malformed JSON
    }

    switch (msg.type) {
      // ── JOIN ────────────────────────────────────────────────────────────
      case 'JOIN': {
        if (currentUser) {
          // Already joined — ignore duplicate join
          send(ws, { type: 'ERROR', payload: { message: 'Already joined' } });
          return;
        }

        const desiredName = (msg.payload && msg.payload.username) || 'Player';
        currentUser = registerUser(ws, desiredName);
        ws._userId = currentUser.id;

        // Send full grid + user info to this client
        send(ws, {
          type: 'INIT',
          payload: {
            yourId: currentUser.id,
            yourColor: currentUser.color,
            yourUsername: currentUser.username,
            cellCount: currentUser.cellCount,
            grid: getGridSnapshot(),
            stats: getStats(),
            users: getOnlineUsers(),
            leaderboard: getFullLeaderboard(),
            cooldownMs: COOLDOWN_MS,
          },
        });

        // Tell everyone else about the new user
        broadcast(wss, {
          type: 'USER_JOINED',
          payload: {
            id: currentUser.id,
            username: currentUser.username,
            color: currentUser.color,
            cellCount: currentUser.cellCount,
          },
        }, currentUser.id, onlineUsers);

        broadcastUserList();

        console.log(`[WS] ${currentUser.username} joined (${currentUser.id})`);
        break;
      }

      // ── CLAIM ───────────────────────────────────────────────────────────
      case 'CLAIM': {
        if (!currentUser) {
          send(ws, { type: 'ERROR', payload: { message: 'Join first' } });
          return;
        }

        const cellId = msg.payload && msg.payload.cellId;
        const result = claimCell(cellId, currentUser.id);

        if (result.ok) {
          // Broadcast the cell update to ALL clients (including sender)
          broadcast(wss, {
            type: 'CELL_UPDATED',
            payload: result.update,
          });

          // Send the sender their updated cell count
          send(ws, {
            type: 'YOUR_STATS',
            payload: {
              cellCount: currentUser.cellCount,
              lastClaim: currentUser.lastClaim,
            },
          });

          // Broadcast updated leaderboard
          broadcastLeaderboard();
        } else {
          // Reject with reason
          send(ws, {
            type: 'CLAIM_REJECTED',
            payload: {
              cellId,
              reason: result.reason,
              remaining: result.remaining || 0,
            },
          });
        }
        break;
      }

      // ── PING ────────────────────────────────────────────────────────────
      case 'PING': {
        send(ws, { type: 'PONG', payload: { ts: Date.now() } });
        break;
      }

      default:
        // Unknown message type — silently ignore
        break;
    }
  });

  ws.on('close', () => {
    if (currentUser) {
      removeUser(currentUser.id);
      broadcast(wss, {
        type: 'USER_LEFT',
        payload: { id: currentUser.id, username: currentUser.username },
      });
      broadcastUserList();
      broadcastLeaderboard();
      console.log(`[WS] ${currentUser.username} disconnected`);
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });
});

// --- Boot sequence ---
initGrid();

server.listen(PORT, () => {
  console.log(`\n🟢 InboxKit Grid running at http://localhost:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down gracefully...');
  wss.close();
  server.close(() => process.exit(0));
});
