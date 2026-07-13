const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'grid.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create schema
db.exec(`
  CREATE TABLE IF NOT EXISTS cells (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT,
    color      TEXT,
    username   TEXT,
    claimed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT UNIQUE,
    color      TEXT,
    cell_count INTEGER DEFAULT 0,
    last_seen  INTEGER
  );
`);

// --- Cell queries ---

/**
 * Load all claimed cells from DB into a plain object map.
 * Returns: { "row:col": { ownerId, color, username, claimedAt } }
 */
function loadGrid() {
  const rows = db.prepare('SELECT * FROM cells WHERE owner_id IS NOT NULL').all();
  const map = {};
  for (const row of rows) {
    map[row.id] = {
      ownerId: row.owner_id,
      color: row.color,
      username: row.username,
      claimedAt: row.claimed_at,
    };
  }
  return map;
}

/**
 * Persist a cell claim to DB (upsert).
 */
const upsertCell = db.prepare(`
  INSERT INTO cells (id, owner_id, color, username, claimed_at)
  VALUES (@id, @ownerId, @color, @username, @claimedAt)
  ON CONFLICT(id) DO UPDATE SET
    owner_id   = excluded.owner_id,
    color      = excluded.color,
    username   = excluded.username,
    claimed_at = excluded.claimed_at
`);

function persistCell(cellId, ownerId, color, username) {
  upsertCell.run({ id: cellId, ownerId, color, username, claimedAt: Date.now() });
}

// --- User queries ---

/**
 * Upsert a user record in DB.
 */
const upsertUser = db.prepare(`
  INSERT INTO users (id, username, color, cell_count, last_seen)
  VALUES (@id, @username, @color, @cellCount, @lastSeen)
  ON CONFLICT(id) DO UPDATE SET
    username   = excluded.username,
    color      = excluded.color,
    cell_count = excluded.cell_count,
    last_seen  = excluded.last_seen
`);

function persistUser(id, username, color, cellCount) {
  upsertUser.run({ id, username, color, cellCount, lastSeen: Date.now() });
}

/**
 * Find a user by username (for reconnects).
 */
function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

/**
 * Update cell_count for a user.
 */
const updateCellCount = db.prepare(
  'UPDATE users SET cell_count = @cellCount, last_seen = @lastSeen WHERE id = @id'
);

function updateUserCellCount(id, cellCount) {
  updateCellCount.run({ id, cellCount, lastSeen: Date.now() });
}

/**
 * Get all-time leaderboard (top 20 by cell_count).
 */
function getLeaderboard() {
  return db
    .prepare('SELECT username, color, cell_count FROM users ORDER BY cell_count DESC LIMIT 20')
    .all();
}

module.exports = {
  loadGrid,
  persistCell,
  persistUser,
  findUserByUsername,
  updateUserCellCount,
  getLeaderboard,
};
