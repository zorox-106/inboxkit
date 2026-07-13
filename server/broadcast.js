const WebSocket = require('ws');

/**
 * Broadcast a message to all connected WebSocket clients.
 * @param {WebSocket.Server} wss
 * @param {object} msg - Will be JSON-serialized
 * @param {string|null} excludeId - userId to skip (optional)
 * @param {Map} onlineUsers - Reference to users map for WS lookup
 */
function broadcast(wss, msg, excludeId = null, onlineUsers = null) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (excludeId && onlineUsers) {
      const user = onlineUsers.get(ws._userId);
      if (user && user.id === excludeId) return;
    }
    ws.send(data);
  });
}

/**
 * Send a message to a single WebSocket client.
 * @param {WebSocket} ws
 * @param {object} msg
 */
function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

module.exports = { broadcast, send };
