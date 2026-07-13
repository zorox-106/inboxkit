const { loadGrid, persistCell, getLeaderboard } = require('./db');
const { getUser, incrementCellCount, decrementCellCount } = require('./users');

// Grid dimensions
const ROWS = 50;
const COLS = 50;
const TOTAL_CELLS = ROWS * COLS;
const COOLDOWN_MS = 2000; // 2 seconds between claims

/**
 * In-memory grid state.
 * Map<cellId, { ownerId, color, username, claimedAt }>
 * Unclaimed cells are simply absent from the map.
 */
const grid = new Map();

/**
 * Load persisted grid from SQLite on startup.
 */
function initGrid() {
  const saved = loadGrid();
  for (const [id, data] of Object.entries(saved)) {
    grid.set(id, data);
  }
  console.log(`[Grid] Loaded ${grid.size} / ${TOTAL_CELLS} cells from DB`);
}

/**
 * Get entire grid as a plain object for INIT message.
 * Only sends claimed cells; client fills rest as unclaimed.
 */
function getGridSnapshot() {
  const snapshot = {};
  for (const [id, data] of grid) {
    snapshot[id] = data;
  }
  return snapshot;
}

/**
 * Validate and process a CLAIM request.
 *
 * Returns:
 *   { ok: true,  update: { cellId, ownerId, color, username } }
 *   { ok: false, reason: string }
 */
function claimCell(cellId, userId) {
  const user = getUser(userId);
  if (!user) return { ok: false, reason: 'Unknown user' };

  // Validate cell ID format
  if (!isValidCellId(cellId)) return { ok: false, reason: 'Invalid cell' };

  // Cooldown check — enforced server-side
  const now = Date.now();
  if (now - user.lastClaim < COOLDOWN_MS) {
    const remaining = COOLDOWN_MS - (now - user.lastClaim);
    return { ok: false, reason: 'cooldown', remaining };
  }

  // Check if cell is already owned by this user (no-op)
  const existing = grid.get(cellId);
  if (existing && existing.ownerId === userId) {
    return { ok: false, reason: 'already_yours' };
  }

  // --- Claim is valid ---

  // If cell was owned by someone else, decrement their count
  if (existing && existing.ownerId !== userId) {
    decrementCellCount(existing.ownerId);
  }

  // Update in-memory state
  const cellData = {
    ownerId: userId,
    color: user.color,
    username: user.username,
    claimedAt: now,
  };
  grid.set(cellId, cellData);

  // Update user cooldown timer
  user.lastClaim = now;

  // Increment new owner's count
  incrementCellCount(userId);

  // Persist to DB (async-ish — synchronous but non-blocking for single-threaded Node)
  persistCell(cellId, userId, user.color, user.username);

  return {
    ok: true,
    update: { cellId, ...cellData },
  };
}

/**
 * Get leaderboard — merges online cell counts with DB data.
 */
function getFullLeaderboard() {
  return getLeaderboard();
}

/**
 * Stats for the grid.
 */
function getStats() {
  return {
    totalCells: TOTAL_CELLS,
    claimedCells: grid.size,
    rows: ROWS,
    cols: COLS,
  };
}

/**
 * Validate "row:col" format and bounds.
 */
function isValidCellId(cellId) {
  if (typeof cellId !== 'string') return false;
  const parts = cellId.split(':');
  if (parts.length !== 2) return false;
  const row = parseInt(parts[0], 10);
  const col = parseInt(parts[1], 10);
  return (
    !isNaN(row) && !isNaN(col) &&
    row >= 0 && row < ROWS &&
    col >= 0 && col < COLS
  );
}

module.exports = {
  initGrid,
  getGridSnapshot,
  claimCell,
  getFullLeaderboard,
  getStats,
  ROWS,
  COLS,
  COOLDOWN_MS,
};
