/* ════════════════════════════════════════════════════════════════
   GridWars — Frontend App
   Canvas renderer + WebSocket client + zoom/pan + animations
   ════════════════════════════════════════════════════════════════ */

'use strict';

// ─── Constants ───────────────────────────────────────────────────
const CELL_SIZE      = 14;   // px per cell at scale=1
const ROWS           = 50;
const COLS           = 50;
const GRID_W         = COLS * CELL_SIZE;
const GRID_H         = ROWS * CELL_SIZE;
const COOLDOWN_MS    = 2000;
const MAX_ZOOM       = 5;
const MIN_ZOOM       = 0.4;
const ACTIVITY_MAX   = 40;

// ─── DOM Refs ─────────────────────────────────────────────────────
const canvas        = document.getElementById('grid-canvas');
const ctx           = canvas.getContext('2d');
const miniCanvas    = document.getElementById('mini-canvas');
const miniCtx       = miniCanvas.getContext('2d');
const canvasWrap    = document.getElementById('canvas-wrap');
const modalOverlay  = document.getElementById('modal-overlay');
const usernameInput = document.getElementById('username-input');
const joinBtn       = document.getElementById('join-btn');
const topbarDot     = document.getElementById('topbar-dot');
const topbarUsername= document.getElementById('topbar-username');
const topbarCells   = document.getElementById('topbar-cells');
const onlineCountEl = document.getElementById('online-count');
const statCells     = document.getElementById('stat-cells');
const statRank      = document.getElementById('stat-rank');
const lbList        = document.getElementById('leaderboard-list');
const activityFeed  = document.getElementById('activity-feed');
const onlineRow     = document.getElementById('online-users-row');
const cooldownWrap  = document.getElementById('cooldown-wrap');
const cooldownLabel = document.getElementById('cooldown-label');
const cooldownFill  = document.getElementById('cooldown-bar-fill');
const gridInfo      = document.getElementById('grid-info');
const statusDot     = document.getElementById('status-dot');
const statusLabel   = document.getElementById('status-label');
const tooltip       = document.getElementById('cell-tooltip');
const toastContainer= document.getElementById('toast-container');
const zoomInBtn     = document.getElementById('zoom-in');
const zoomOutBtn    = document.getElementById('zoom-out');
const zoomResetBtn  = document.getElementById('zoom-reset');

// ─── App State ────────────────────────────────────────────────────
let myId       = null;
let myColor    = '#7c5cfc';
let myUsername = 'Player';
let myCells    = 0;

/** In-memory grid: cellId → { ownerId, color, username, claimedAt } */
const grid = {};

/** Active ripple animations: [ { row, col, startTime, color } ] */
const ripples = [];

// ─── Viewport / Camera ───────────────────────────────────────────
const cam = { x: 0, y: 0, scale: 1 };
let isDragging = false;
let dragStart  = { x: 0, y: 0 };
let dragCamStart = { x: 0, y: 0 };
let hasDragged = false;

// ─── Cooldown State ───────────────────────────────────────────────
let lastClaim    = 0;
let cooldownRafId = null;
let serverCooldownMs = COOLDOWN_MS;

// ─── WebSocket ────────────────────────────────────────────────────
let ws          = null;
let wsReady     = false;
let reconnectTimer = null;

// ─── Optimistic Update Tracking ──────────────────────────────────
/** Cells claimed optimistically but not yet confirmed by server */
const pendingClaims = new Set();

/* ════════════════════════════════════════════════════════════════
   CANVAS SETUP & RESIZE
   ════════════════════════════════════════════════════════════════ */
function resizeCanvas() {
  const w = canvasWrap.clientWidth;
  const h = canvasWrap.clientHeight;
  canvas.width  = w;
  canvas.height = h;

  // Center grid on first load
  if (cam.x === 0 && cam.y === 0) {
    cam.x = (w - GRID_W * cam.scale) / 2;
    cam.y = (h - GRID_H * cam.scale) / 2;
  }
  renderAll();
}

window.addEventListener('resize', resizeCanvas);

/* ════════════════════════════════════════════════════════════════
   CANVAS RENDERING
   ════════════════════════════════════════════════════════════════ */

/** Map cell colors for owned cells */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

let rafScheduled = false;
function scheduleRender() {
  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      renderAll();
    });
  }
}

function renderAll() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.scale(cam.scale, cam.scale);

  const cs = CELL_SIZE;
  const now = performance.now();

  // ── Compute visible cell range (culling) ──
  const startCol = Math.max(0, Math.floor(-cam.x / (cs * cam.scale)));
  const startRow = Math.max(0, Math.floor(-cam.y / (cs * cam.scale)));
  const endCol   = Math.min(COLS, Math.ceil((w - cam.x) / (cs * cam.scale)) + 1);
  const endRow   = Math.min(ROWS, Math.ceil((h - cam.y) / (cs * cam.scale)) + 1);

  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      const id   = `${r}:${c}`;
      const cell = grid[id];
      const x    = c * cs;
      const y    = r * cs;

      if (cell) {
        // Owned cell
        ctx.fillStyle = cell.color;
        ctx.fillRect(x, y, cs, cs);

        // Subtle inner shadow for depth
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x + cs - 2, y, 2, cs);
        ctx.fillRect(x, y + cs - 2, cs, 2);

        // My cells get a bright border
        if (cell.ownerId === myId) {
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(x + 0.6, y + 0.6, cs - 1.2, cs - 1.2);
        }
      } else {
        // Unclaimed cell
        ctx.fillStyle = '#13131e';
        ctx.fillRect(x, y, cs, cs);

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, cs, cs);
      }
    }
  }

  // ── Ripple animations ──
  const alive = [];
  for (const rip of ripples) {
    const elapsed = now - rip.startTime;
    const duration = 500;
    if (elapsed < duration) {
      const progress = elapsed / duration;
      const radius = progress * cs * 2.2;
      const alpha  = (1 - progress) * 0.6;

      ctx.beginPath();
      ctx.arc(
        rip.col * cs + cs / 2,
        rip.row * cs + cs / 2,
        radius, 0, Math.PI * 2
      );
      ctx.strokeStyle = hexToRgba(rip.color, alpha);
      ctx.lineWidth = 2;
      ctx.stroke();
      alive.push(rip);
    }
  }
  ripples.length = 0;
  ripples.push(...alive);
  if (alive.length > 0) scheduleRender();

  ctx.restore();

  // ── Draw minimap ──
  renderMiniMap();
}

function renderMiniMap() {
  const mw = miniCanvas.width;
  const mh = miniCanvas.height;
  miniCtx.clearRect(0, 0, mw, mh);
  miniCtx.fillStyle = '#13131e';
  miniCtx.fillRect(0, 0, mw, mh);

  const cw = mw / COLS;
  const ch = mh / ROWS;

  for (const [id, cell] of Object.entries(grid)) {
    const [r, c] = id.split(':').map(Number);
    miniCtx.fillStyle = cell.color;
    miniCtx.fillRect(c * cw, r * ch, cw, ch);
  }

  // Viewport indicator
  const vpX = (-cam.x / cam.scale) * (mw / GRID_W);
  const vpY = (-cam.y / cam.scale) * (mh / GRID_H);
  const vpW = (canvas.width  / cam.scale) * (mw / GRID_W);
  const vpH = (canvas.height / cam.scale) * (mh / GRID_H);
  miniCtx.strokeStyle = 'rgba(255,255,255,0.5)';
  miniCtx.lineWidth = 1;
  miniCtx.strokeRect(vpX, vpY, vpW, vpH);
}

/* ════════════════════════════════════════════════════════════════
   CAMERA / ZOOM / PAN
   ════════════════════════════════════════════════════════════════ */
function zoom(factor, pivotX, pivotY) {
  const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.scale * factor));
  const realFactor = newScale / cam.scale;
  cam.x = pivotX - (pivotX - cam.x) * realFactor;
  cam.y = pivotY - (pivotY - cam.y) * realFactor;
  cam.scale = newScale;
  scheduleRender();
}

function resetView() {
  const w = canvas.width;
  const h = canvas.height;
  cam.scale = 1;
  cam.x = (w - GRID_W) / 2;
  cam.y = (h - GRID_H) / 2;
  scheduleRender();
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const px   = e.clientX - rect.left;
  const py   = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoom(factor, px, py);
}, { passive: false });

canvas.addEventListener('mousedown', (e) => {
  isDragging   = true;
  hasDragged   = false;
  dragStart    = { x: e.clientX, y: e.clientY };
  dragCamStart = { x: cam.x, y: cam.y };
  canvas.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  if (isDragging) {
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true;
    cam.x = dragCamStart.x + dx;
    cam.y = dragCamStart.y + dy;
    scheduleRender();
  }

  // Update tooltip on hover
  updateTooltip(e.clientX, e.clientY);
});

window.addEventListener('mouseup', (e) => {
  if (isDragging && !hasDragged) {
    handleCanvasClick(e.clientX, e.clientY);
  }
  isDragging = false;
  canvas.style.cursor = 'crosshair';
});

zoomInBtn.addEventListener('click',    () => zoom(1.3, canvas.width / 2, canvas.height / 2));
zoomOutBtn.addEventListener('click',   () => zoom(1 / 1.3, canvas.width / 2, canvas.height / 2));
zoomResetBtn.addEventListener('click', resetView);

// Touch support
let lastTouchDist = null;
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    lastTouchDist = Math.sqrt(dx * dx + dy * dy);
  } else if (e.touches.length === 1) {
    isDragging   = true;
    hasDragged   = false;
    dragStart    = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    dragCamStart = { x: cam.x, y: cam.y };
  }
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && lastTouchDist !== null) {
    const dx   = e.touches[0].clientX - e.touches[1].clientX;
    const dy   = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const mx   = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const my   = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    zoom(dist / lastTouchDist, mx, my);
    lastTouchDist = dist;
  } else if (e.touches.length === 1 && isDragging) {
    const dx = e.touches[0].clientX - dragStart.x;
    const dy = e.touches[0].clientY - dragStart.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDragged = true;
    cam.x = dragCamStart.x + dx;
    cam.y = dragCamStart.y + dy;
    scheduleRender();
  }
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  if (e.changedTouches.length === 1 && !hasDragged) {
    const t = e.changedTouches[0];
    handleCanvasClick(t.clientX, t.clientY);
  }
  isDragging    = false;
  lastTouchDist = null;
});

/* ════════════════════════════════════════════════════════════════
   CLICK → CLAIM
   ════════════════════════════════════════════════════════════════ */
function screenToCell(screenX, screenY) {
  const rect = canvas.getBoundingClientRect();
  const wx   = (screenX - rect.left  - cam.x) / cam.scale;
  const wy   = (screenY - rect.top   - cam.y) / cam.scale;
  const col  = Math.floor(wx / CELL_SIZE);
  const row  = Math.floor(wy / CELL_SIZE);
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
  return { row, col, id: `${row}:${col}` };
}

function handleCanvasClick(screenX, screenY) {
  if (!wsReady || !myId) return;

  const cell = screenToCell(screenX, screenY);
  if (!cell) return;

  const existing = grid[cell.id];
  if (existing && existing.ownerId === myId) return; // Already mine

  // Cooldown check (client-side for instant feedback)
  const now = Date.now();
  if (now - lastClaim < serverCooldownMs) {
    const rem = serverCooldownMs - (now - lastClaim);
    showToast(`⏱ Wait ${(rem / 1000).toFixed(1)}s`, 'warning');
    return;
  }

  // Optimistic update
  const prevData = grid[cell.id] || null;
  grid[cell.id] = { ownerId: myId, color: myColor, username: myUsername, claimedAt: now };
  pendingClaims.add(cell.id);
  lastClaim = now;
  myCells++;
  updateMyStats();
  addRipple(cell.row, cell.col, myColor);
  scheduleRender();
  startCooldownAnimation();

  // Send to server
  wsSend({ type: 'CLAIM', payload: { cellId: cell.id } });

  // Rollback timeout (if server doesn't confirm in 3s)
  setTimeout(() => {
    if (pendingClaims.has(cell.id)) {
      pendingClaims.delete(cell.id);
      if (prevData) {
        grid[cell.id] = prevData;
      } else {
        delete grid[cell.id];
      }
      myCells--;
      updateMyStats();
      scheduleRender();
      showToast('⚠ Claim timed out', 'danger');
    }
  }, 3000);
}

/* ════════════════════════════════════════════════════════════════
   TOOLTIP
   ════════════════════════════════════════════════════════════════ */
let tooltipHoveredCell = null;

function updateTooltip(screenX, screenY) {
  const cell = screenToCell(screenX, screenY);
  if (!cell) {
    tooltip.classList.remove('visible');
    gridInfo.textContent = 'Hover a cell to inspect';
    tooltipHoveredCell = null;
    return;
  }

  tooltipHoveredCell = cell.id;
  const data = grid[cell.id];
  gridInfo.textContent = `[${cell.row}, ${cell.col}]${data ? ` — ${data.username}` : ' — unclaimed'}`;

  if (data) {
    const ago = timeAgo(data.claimedAt);
    const isMe = data.ownerId === myId;
    tooltip.innerHTML = `
      <span style="color:${data.color};font-weight:600">${data.username}</span>
      ${isMe ? ' <span style="color:#7c5cfc;font-size:10px">(you)</span>' : ''}
      <br/><span style="color:#555570;font-size:10px">Claimed ${ago}</span>
    `;
    tooltip.classList.add('visible');
    tooltip.style.left = `${screenX + 14}px`;
    tooltip.style.top  = `${screenY - 10}px`;
  } else {
    tooltip.classList.remove('visible');
  }
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10)  return 'just now';
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/* ════════════════════════════════════════════════════════════════
   RIPPLE ANIMATION
   ════════════════════════════════════════════════════════════════ */
function addRipple(row, col, color) {
  ripples.push({ row, col, color, startTime: performance.now() });
  scheduleRender();
}

/* ════════════════════════════════════════════════════════════════
   COOLDOWN BAR
   ════════════════════════════════════════════════════════════════ */
function startCooldownAnimation() {
  if (cooldownRafId) cancelAnimationFrame(cooldownRafId);
  cooldownWrap.classList.add('cooldown-active');

  function tick() {
    const elapsed  = Date.now() - lastClaim;
    const progress = Math.min(1, elapsed / serverCooldownMs);
    cooldownFill.style.transform = `scaleX(${progress})`;

    if (progress < 1) {
      const rem = ((serverCooldownMs - elapsed) / 1000).toFixed(1);
      cooldownLabel.textContent = `Cooldown ${rem}s`;
      cooldownRafId = requestAnimationFrame(tick);
    } else {
      cooldownLabel.textContent = 'Ready';
      cooldownFill.style.transform = 'scaleX(1)';
      cooldownWrap.classList.remove('cooldown-active');
      cooldownRafId = null;
    }
  }
  cooldownRafId = requestAnimationFrame(tick);
}

/* ════════════════════════════════════════════════════════════════
   UI UPDATES
   ════════════════════════════════════════════════════════════════ */
function updateMyStats() {
  topbarCells.textContent = myCells;
  statCells.textContent   = myCells;
}

function updateTopbar() {
  topbarUsername.textContent  = myUsername;
  topbarDot.style.background  = myColor;
  topbarDot.style.boxShadow   = `0 0 8px ${myColor}`;
  updateMyStats();
}

function updateLeaderboard(data) {
  if (!data || !data.length) return;
  const maxCount = data[0].cell_count || 1;

  // Update my rank
  const myRank = data.findIndex(u => u.username === myUsername);
  statRank.textContent = myRank >= 0 ? `#${myRank + 1}` : '—';

  lbList.innerHTML = data.map((u, i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const isMe      = u.username === myUsername;
    const barWidth  = Math.max(4, (u.cell_count / maxCount) * 100);
    return `
      <div class="lb-row">
        <div class="lb-bar" style="width:${barWidth}%;background:${u.color}"></div>
        <span class="lb-rank ${rankClass}">${i + 1}</span>
        <span class="lb-dot" style="background:${u.color}"></span>
        <span class="lb-name ${isMe ? 'is-you' : ''}">${escHtml(u.username)}</span>
        <span class="lb-count">${u.cell_count}</span>
      </div>
    `;
  }).join('');
}

function updateOnlineUsers(users) {
  onlineCountEl.textContent = users.length;
  onlineRow.innerHTML = users.map(u =>
    `<div class="online-pip" title="${escHtml(u.username)}" style="background:${u.color}"></div>`
  ).join('');
}

function addActivity(html) {
  const item = document.createElement('div');
  item.className = 'activity-item';
  item.innerHTML = html;
  activityFeed.prepend(item);

  // Trim old entries
  while (activityFeed.children.length > ACTIVITY_MAX) {
    activityFeed.removeChild(activityFeed.lastChild);
  }
}

/* ════════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ════════════════════════════════════════════════════════════════ */
function showToast(msg, type = 'info', duration = 2500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.borderColor = type === 'warning' ? 'rgba(255,201,60,0.3)'
                        : type === 'danger'  ? 'rgba(255,107,107,0.3)'
                        : 'rgba(255,255,255,0.12)';
  el.textContent = msg;
  toastContainer.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/* ════════════════════════════════════════════════════════════════
   WEBSOCKET
   ════════════════════════════════════════════════════════════════ */
function setStatus(state) {
  statusDot.className   = `status-dot ${state}`;
  statusLabel.textContent = state === 'connected' ? 'Live'
                          : state === 'connecting' ? 'Connecting…'
                          : 'Disconnected';
}

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function connect(username) {
  if (ws) ws.close();

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  setStatus('connecting');

  ws.addEventListener('open', () => {
    setStatus('connected');
    wsReady = true;
    wsSend({ type: 'JOIN', payload: { username } });
    clearTimeout(reconnectTimer);
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  });

  ws.addEventListener('close', () => {
    wsReady = false;
    setStatus('disconnected');
    showToast('🔌 Connection lost — reconnecting…', 'warning', 3000);
    reconnectTimer = setTimeout(() => connect(myUsername), 3000);
  });

  ws.addEventListener('error', () => {
    wsReady = false;
    setStatus('disconnected');
  });
}

function handleMessage(msg) {
  switch (msg.type) {

    case 'INIT': {
      const p = msg.payload;
      myId       = p.yourId;
      myColor    = p.yourColor;
      myUsername = p.yourUsername;
      myCells    = p.cellCount;
      serverCooldownMs = p.cooldownMs || COOLDOWN_MS;

      // Populate grid
      for (const [id, data] of Object.entries(p.grid || {})) {
        grid[id] = data;
      }

      updateTopbar();
      updateLeaderboard(p.leaderboard);
      updateOnlineUsers(p.users || []);
      scheduleRender();

      showToast(`👋 Welcome, ${myUsername}! You have ${myCells} cells.`, 'info', 3000);
      break;
    }

    case 'CELL_UPDATED': {
      const { cellId, ownerId, color, username, claimedAt } = msg.payload;
      const wasMyPending = pendingClaims.has(cellId) && ownerId === myId;

      // Check if someone else took a cell we optimistically claimed
      const existing = grid[cellId];
      if (existing && existing.ownerId === myId && ownerId !== myId) {
        // We lost this cell!
        myCells = Math.max(0, myCells - 1);
        updateMyStats();
        showToast(`😬 ${username} stole your cell!`, 'warning');
      }

      grid[cellId] = { ownerId, color, username, claimedAt };
      pendingClaims.delete(cellId);

      const [row, col] = cellId.split(':').map(Number);
      addRipple(row, col, color);
      scheduleRender();

      // Activity log
      const isMe = ownerId === myId;
      if (!isMe) {
        addActivity(
          `<span class="act-user" style="color:${color}">${escHtml(username)}</span> claimed <span class="act-cell">[${row},${col}]</span>`
        );
      }
      break;
    }

    case 'YOUR_STATS': {
      myCells   = msg.payload.cellCount;
      lastClaim = msg.payload.lastClaim || lastClaim;
      updateMyStats();
      break;
    }

    case 'CLAIM_REJECTED': {
      const { cellId, reason, remaining } = msg.payload;

      // Roll back optimistic update
      if (pendingClaims.has(cellId)) {
        pendingClaims.delete(cellId);
        delete grid[cellId];
        myCells = Math.max(0, myCells - 1);
        updateMyStats();
        scheduleRender();
      }

      if (reason === 'cooldown') {
        showToast(`⏱ Wait ${(remaining / 1000).toFixed(1)}s`, 'warning');
      } else if (reason !== 'already_yours') {
        showToast(`✗ Claim rejected: ${reason}`, 'danger');
      }
      break;
    }

    case 'LEADERBOARD': {
      updateLeaderboard(msg.payload);
      break;
    }

    case 'USER_LIST': {
      updateOnlineUsers(msg.payload);
      break;
    }

    case 'USER_JOINED': {
      const { username, color } = msg.payload;
      addActivity(
        `<span class="act-user" style="color:${color}">${escHtml(username)}</span> joined the grid`
      );
      break;
    }

    case 'USER_LEFT': {
      const { username } = msg.payload;
      addActivity(
        `<span style="color:#555570">${escHtml(username)} left</span>`
      );
      break;
    }

    case 'PONG':
      break;

    default:
      break;
  }
}

/* ════════════════════════════════════════════════════════════════
   USERNAME MODAL
   ════════════════════════════════════════════════════════════════ */
function loadSavedUsername() {
  try {
    return localStorage.getItem('gridwars_username') || '';
  } catch { return ''; }
}

function saveUsername(name) {
  try { localStorage.setItem('gridwars_username', name); } catch {}
}

function submitJoin() {
  const raw  = usernameInput.value.trim();
  const name = raw.length > 0 ? raw.slice(0, 20) : `Player${Math.floor(Math.random() * 999)}`;
  myUsername = name;
  saveUsername(name);
  modalOverlay.classList.add('hidden');
  resizeCanvas();
  connect(name);
}

joinBtn.addEventListener('click', submitJoin);
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitJoin();
});

// Pre-fill saved username
const saved = loadSavedUsername();
if (saved) usernameInput.value = saved;
usernameInput.focus();

/* ════════════════════════════════════════════════════════════════
   UTILS
   ════════════════════════════════════════════════════════════════ */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Kick off render (without WS for now)
resizeCanvas();
