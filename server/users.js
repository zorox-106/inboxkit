const { v4: uuidv4 } = require('./uuid');
const { persistUser, findUserByUsername, updateUserCellCount } = require('./db');

// 20 curated, vibrant HSL colors — visually distinct on dark background
const COLORS = [
  '#FF6B6B', '#FF8E53', '#FFC93C', '#A8FF3E', '#3EFFDC',
  '#3E9BFF', '#A855F7', '#F43F8E', '#FF6BBA', '#6BFFB8',
  '#FFD166', '#06D6A0', '#118AB2', '#EF476F', '#FFB347',
  '#B5E48C', '#56CFE1', '#9B5DE5', '#F15BB5', '#FEE440',
];

/**
 * In-memory map of currently connected users.
 * Key: userId (string)
 * Value: { id, username, color, cellCount, ws, lastClaim }
 */
const onlineUsers = new Map();

/** Track which colors are in use to avoid duplicates */
const usedColors = new Set();

function assignColor() {
  for (const color of COLORS) {
    if (!usedColors.has(color)) {
      usedColors.add(color);
      return color;
    }
  }
  // Fallback: generate random hue if all 20 are taken
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 85%, 65%)`;
}

/**
 * Register a new WebSocket connection.
 * If username matches an existing DB user, restore their identity.
 */
function registerUser(ws, desiredUsername) {
  // Sanitize username
  const username = (desiredUsername || 'anonymous')
    .trim()
    .slice(0, 20)
    .replace(/[^a-zA-Z0-9_\-. ]/g, '') || 'Player';

  // Check if username is already taken by an online user
  for (const [, user] of onlineUsers) {
    if (user.username.toLowerCase() === username.toLowerCase()) {
      // Reconnect: give them a suffixed name
      return registerUser(ws, username + Math.floor(Math.random() * 99));
    }
  }

  // Try to restore from DB
  const existing = findUserByUsername(username);
  const id = existing ? existing.id : uuidv4();
  const color = existing ? existing.color : assignColor();
  const cellCount = existing ? existing.cell_count : 0;

  const user = {
    id,
    username,
    color,
    cellCount,
    ws,
    lastClaim: 0,
  };

  onlineUsers.set(id, user);
  persistUser(id, username, color, cellCount);

  return user;
}

/**
 * Remove user from online map and free their color.
 */
function removeUser(userId) {
  const user = onlineUsers.get(userId);
  if (user) {
    usedColors.delete(user.color);
    onlineUsers.delete(userId);
    updateUserCellCount(userId, user.cellCount);
  }
  return user;
}

/**
 * Increment a user's cell count.
 */
function incrementCellCount(userId) {
  const user = onlineUsers.get(userId);
  if (user) {
    user.cellCount += 1;
    updateUserCellCount(userId, user.cellCount);
  }
}

/**
 * Decrement a user's cell count (when they lose a cell to someone else).
 */
function decrementCellCount(userId) {
  const user = onlineUsers.get(userId);
  if (user && user.cellCount > 0) {
    user.cellCount -= 1;
    updateUserCellCount(userId, user.cellCount);
  }
}

/**
 * Get snapshot of all online users (safe for broadcast).
 */
function getOnlineUsers() {
  return Array.from(onlineUsers.values()).map(({ id, username, color, cellCount }) => ({
    id,
    username,
    color,
    cellCount,
  }));
}

/**
 * Get a single user by ID.
 */
function getUser(userId) {
  return onlineUsers.get(userId);
}

module.exports = {
  registerUser,
  removeUser,
  incrementCellCount,
  decrementCellCount,
  getOnlineUsers,
  getUser,
  onlineUsers,
};
