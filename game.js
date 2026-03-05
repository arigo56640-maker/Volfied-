// ===== CONSTANTS =====
const COLS = 60;
const ROWS = 45;
const CELL = 14;
const CANVAS_W = COLS * CELL;
const CANVAS_H = ROWS * CELL;

const EMPTY  = 0;
const BORDER = 1;
const TRAIL  = 2;

const COLOR_BG           = '#0a0a1a';
const COLOR_BORDER_FILL  = '#0d2a4a';
const COLOR_BORDER_EDGE  = '#00cfff';
const COLOR_TRAIL        = '#ff6600';
const COLOR_PLAYER       = '#00ffcc';
const COLOR_FUZZY        = '#ff2244';
const COLOR_SPARX        = '#ffdd00';

// ===== STATE =====
let grid = new Uint8Array(COLS * ROWS);

function G(r, c) { return grid[r * COLS + c]; }
function setG(r, c, v) { grid[r * COLS + c] = v; }

const player = {
  col: 1, row: 0,
  dir: { dc: 0, dr: 0 },
  nextDir: { dc: 0, dr: 0 },
  onBorder: true,
  trail: [],
  moveTimer: 0,
  moveInterval: 100,
};

const state = {
  phase: 'title',
  score: 0,
  lives: 3,
  level: 1,
  claimedCells: 0,
  totalInnerCells: (COLS - 2) * (ROWS - 2),
  fuzzies: [],
  sparxList: [],
  animTimer: 0,
  dying: false,
};

let perimeterCells = [];
let loopRunning = false;

// ===== CANVAS SETUP =====
const canvas = document.getElementById('gameCanvas');
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext('2d');

// ===== INPUT =====
const KEY_MAP = {
  ArrowUp:    { dc: 0,  dr: -1 },
  ArrowDown:  { dc: 0,  dr:  1 },
  ArrowLeft:  { dc: -1, dr:  0 },
  ArrowRight: { dc:  1, dr:  0 },
};

document.addEventListener('keydown', (e) => {
  if (KEY_MAP[e.key]) {
    e.preventDefault();
    player.nextDir = KEY_MAP[e.key];
  }
});

// ===== INIT =====
function buildPerimeter() {
  perimeterCells = [];
  for (let c = 0; c < COLS; c++) perimeterCells.push({ row: 0, col: c });
  for (let r = 1; r < ROWS; r++) perimeterCells.push({ row: r, col: COLS - 1 });
  for (let c = COLS - 2; c >= 0; c--) perimeterCells.push({ row: ROWS - 1, col: c });
  for (let r = ROWS - 2; r >= 1; r--) perimeterCells.push({ row: r, col: 0 });
}

function initLevel(level) {
  grid.fill(EMPTY);

  // Border ring
  for (let c = 0; c < COLS; c++) {
    setG(0, c, BORDER);
    setG(ROWS - 1, c, BORDER);
  }
  for (let r = 0; r < ROWS; r++) {
    setG(r, 0, BORDER);
    setG(r, COLS - 1, BORDER);
  }

  player.col = 1;
  player.row = 0;
  player.dir = { dc: 0, dr: 0 };
  player.nextDir = { dc: 0, dr: 0 };
  player.trail = [];
  player.onBorder = true;
  player.moveTimer = 0;
  player.moveInterval = Math.max(40, 100 - (level - 1) * 8);

  state.claimedCells = 0;
  state.totalInnerCells = (COLS - 2) * (ROWS - 2);
  state.fuzzies = [];
  state.sparxList = [];
  state.animTimer = 0;

  const fuzzyCount = 1 + level;
  for (let i = 0; i < fuzzyCount; i++) {
    spawnFuzzy(level);
  }

  if (level >= 2) {
    spawnSparx(level);
  }

  buildPerimeter();
  updateHUD();
}

function spawnFuzzy(level) {
  let col, row, tries = 0;
  do {
    col = 4 + Math.floor(Math.random() * (COLS - 8));
    row = 4 + Math.floor(Math.random() * (ROWS - 8));
    tries++;
  } while (G(row, col) !== EMPTY && tries < 200);

  const dirs = [{ dc: 1, dr: 0 }, { dc: -1, dr: 0 }, { dc: 0, dr: 1 }, { dc: 0, dr: -1 }];
  const d = dirs[Math.floor(Math.random() * 4)];

  state.fuzzies.push({
    col, row,
    dc: d.dc, dr: d.dr,
    speed: Math.max(60, 130 - (level - 1) * 15),
    timer: Math.random() * 130,
  });
}

function spawnSparx(level) {
  state.sparxList.push({
    edgeIndex: 0,
    speed: Math.max(40, 80 - (level - 2) * 10),
    timer: 0,
    dir: 1,
  });
  // Second sparx from level 3, going opposite
  if (level >= 3) {
    state.sparxList.push({
      edgeIndex: Math.floor(perimeterCells.length / 2),
      speed: Math.max(40, 80 - (level - 2) * 10),
      timer: 0,
      dir: -1,
    });
  }
}

// ===== GAME LOOP =====
let lastTime = 0;

function gameLoop(timestamp) {
  const dt = Math.min(timestamp - lastTime, 100); // cap dt at 100ms
  lastTime = timestamp;
  update(dt);
  render();
  requestAnimationFrame(gameLoop);
}

function update(dt) {
  if (state.phase === 'playing') {
    updatePlayer(dt);
    updateFuzzies(dt);
    updateSparx(dt);
  } else if (state.phase === 'dying' || state.phase === 'levelclear') {
    updateAnimation(dt);
  }
}

// ===== PLAYER =====
function applyBufferedDirection() {
  const { dc, dr } = player.nextDir;
  if (dc === 0 && dr === 0) return;

  // Block 180 reversal when trailing (would immediately self-hit)
  if (!player.onBorder) {
    if (dc === -player.dir.dc && dr === -player.dir.dr) return;
  }
  player.dir = { dc, dr };
}

function updatePlayer(dt) {
  player.moveTimer += dt;
  if (player.moveTimer < player.moveInterval) return;
  player.moveTimer -= player.moveInterval;

  applyBufferedDirection();

  const { dc, dr } = player.dir;
  if (dc === 0 && dr === 0) return;

  const nc = player.col + dc;
  const nr = player.row + dr;

  if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return;

  const dest = G(nr, nc);

  if (player.onBorder) {
    if (dest === BORDER) {
      player.col = nc;
      player.row = nr;
    } else if (dest === EMPTY) {
      setG(nr, nc, TRAIL);
      player.trail.push({ row: nr, col: nc });
      player.onBorder = false;
      player.col = nc;
      player.row = nr;
    }
  } else {
    if (dest === BORDER) {
      player.col = nc;
      player.row = nr;
      player.onBorder = true;
      completeFill();
      player.trail = [];
    } else if (dest === TRAIL) {
      playerDie();
    } else if (dest === EMPTY) {
      setG(nr, nc, TRAIL);
      player.trail.push({ row: nr, col: nc });
      player.col = nc;
      player.row = nr;
    }
  }
}

// ===== FILL =====
function completeFill() {
  // Convert trail to border
  for (const cell of player.trail) {
    setG(cell.row, cell.col, BORDER);
  }

  // BFS flood from each fuzzy through EMPTY cells → unsafe
  const unsafe = new Uint8Array(COLS * ROWS);
  const queue = [];

  for (const f of state.fuzzies) {
    const idx = f.row * COLS + f.col;
    if (!unsafe[idx] && grid[idx] === EMPTY) {
      unsafe[idx] = 1;
      queue.push(idx);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const r = Math.floor(idx / COLS);
    const c = idx % COLS;
    const neighbors = [
      (r - 1) * COLS + c,
      (r + 1) * COLS + c,
      r * COLS + (c - 1),
      r * COLS + (c + 1),
    ];
    for (const ni of neighbors) {
      const nr2 = Math.floor(ni / COLS);
      const nc2 = ni % COLS;
      if (nr2 < 0 || nr2 >= ROWS || nc2 < 0 || nc2 >= COLS) continue;
      if (!unsafe[ni] && grid[ni] === EMPTY) {
        unsafe[ni] = 1;
        queue.push(ni);
      }
    }
  }

  // Fill safe EMPTY cells
  let newlyClaimed = 0;
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      const idx = r * COLS + c;
      if (grid[idx] === EMPTY && !unsafe[idx]) {
        grid[idx] = BORDER;
        newlyClaimed++;
      }
    }
  }

  state.claimedCells += newlyClaimed;
  const fillPct = newlyClaimed / state.totalInnerCells;
  state.score += Math.floor(newlyClaimed * 10 * (1 + fillPct * 2));

  buildPerimeter();
  updateHUD();

  const totalPct = state.claimedCells / state.totalInnerCells;
  if (totalPct >= 0.75) {
    triggerLevelClear();
  }
}

// ===== ENEMIES =====
function updateFuzzies(dt) {
  for (const f of state.fuzzies) {
    f.timer += dt;
    if (f.timer < f.speed) continue;
    f.timer -= f.speed;
    moveFuzzy(f);
  }
}

function moveFuzzy(f) {
  if (state.phase !== 'playing') return;

  const nc = f.col + f.dc;
  const nr = f.row + f.dr;

  const inBounds = nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS;
  const dest = inBounds ? G(nr, nc) : -1;

  if (dest === EMPTY) {
    f.col = nc;
    f.row = nr;
  } else if (dest === TRAIL) {
    f.col = nc;
    f.row = nr;
    playerDie();
    return;
  } else {
    // Try perpendicular directions
    const perps = f.dr !== 0
      ? [{ dc: 1, dr: 0 }, { dc: -1, dr: 0 }]
      : [{ dc: 0, dr: 1 }, { dc: 0, dr: -1 }];

    if (Math.random() < 0.5) perps.reverse();

    let moved = false;
    for (const d of perps) {
      const tc = f.col + d.dc;
      const tr = f.row + d.dr;
      if (tc >= 0 && tc < COLS && tr >= 0 && tr < ROWS && G(tr, tc) === EMPTY) {
        f.dc = d.dc;
        f.dr = d.dr;
        f.col = tc;
        f.row = tr;
        moved = true;
        break;
      }
    }

    if (!moved) {
      // Check if perp moves hit TRAIL
      for (const d of perps) {
        const tc = f.col + d.dc;
        const tr = f.row + d.dr;
        if (tc >= 0 && tc < COLS && tr >= 0 && tr < ROWS && G(tr, tc) === TRAIL) {
          f.dc = d.dc;
          f.dr = d.dr;
          f.col = tc;
          f.row = tr;
          playerDie();
          return;
        }
      }
      // Reverse
      f.dc = -f.dc;
      f.dr = -f.dr;
    }
  }
}

function updateSparx(dt) {
  for (const s of state.sparxList) {
    s.timer += dt;
    if (s.timer < s.speed) continue;
    s.timer -= s.speed;

    s.edgeIndex = (s.edgeIndex + s.dir + perimeterCells.length) % perimeterCells.length;

    const cell = perimeterCells[s.edgeIndex];
    if (!cell) continue;

    if (cell.row === player.row && cell.col === player.col) {
      playerDie();
    }
  }
}

// ===== DEATH =====
function playerDie() {
  if (state.phase !== 'playing') return;
  state.phase = 'dying';
  state.animTimer = 0;

  // Erase trail
  for (const cell of player.trail) {
    if (G(cell.row, cell.col) === TRAIL) {
      setG(cell.row, cell.col, EMPTY);
    }
  }
  player.trail = [];
  player.onBorder = true;
}

function updateAnimation(dt) {
  state.animTimer += dt;

  if (state.phase === 'dying') {
    if (state.animTimer > 1200) {
      state.lives--;
      updateHUD();
      if (state.lives <= 0) {
        state.phase = 'gameover';
        showOverlay('GAME OVER', 'ניקוד סופי: ' + state.score, 'שחק שוב');
      } else {
        player.col = 1;
        player.row = 0;
        player.dir = { dc: 0, dr: 0 };
        player.nextDir = { dc: 0, dr: 0 };
        player.onBorder = true;
        player.moveTimer = 0;
        state.phase = 'playing';
      }
    }
  } else if (state.phase === 'levelclear') {
    if (state.animTimer > 2500) {
      state.level++;
      initLevel(state.level);
      state.phase = 'playing';
      hideOverlay();
    }
  }
}

function triggerLevelClear() {
  state.phase = 'levelclear';
  state.animTimer = 0;
  state.score += state.level * 1000;
  updateHUD();
  showOverlay('שלב ' + state.level + ' הושלם!', 'ניקוד: ' + state.score, '');
}

// ===== HUD =====
function updateHUD() {
  document.getElementById('score').textContent = state.score;
  document.getElementById('level').textContent = state.level;
  const hearts = state.lives > 0 ? Array(state.lives).fill('\u2764').join(' ') : '0';
  document.getElementById('lives').textContent = hearts;
  const pct = Math.floor((state.claimedCells / state.totalInnerCells) * 100);
  document.getElementById('area').textContent = pct + '%';
}

// ===== OVERLAY =====
function showOverlay(title, subtitle, btnText) {
  const el = document.getElementById('overlay');
  el.querySelector('h1').textContent = title;
  el.querySelector('.subtitle').textContent = subtitle;
  const btn = el.querySelector('button');
  if (btnText) {
    btn.style.display = '';
    btn.textContent = btnText;
  } else {
    btn.style.display = 'none';
  }
  el.style.display = 'flex';
}

function hideOverlay() {
  document.getElementById('overlay').style.display = 'none';
}

// ===== RENDER =====
function render() {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Draw grid cells
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = G(r, c);
      if (v === BORDER) {
        drawBorderCell(r, c);
      } else if (v === TRAIL) {
        drawTrailCell(r, c);
      }
    }
  }

  // Fuzzies
  for (const f of state.fuzzies) {
    drawFuzzy(f);
  }

  // Sparx
  for (const s of state.sparxList) {
    drawSparx(s);
  }

  // Player
  drawPlayer();

  // Death flash
  if (state.phase === 'dying') {
    const t = state.animTimer / 1200;
    const alpha = Math.abs(Math.sin(state.animTimer / 120)) * 0.4 * (1 - t);
    ctx.fillStyle = `rgba(255, 50, 50, ${alpha})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}

function drawBorderCell(r, c) {
  const x = c * CELL, y = r * CELL;
  ctx.fillStyle = COLOR_BORDER_FILL;
  ctx.fillRect(x, y, CELL, CELL);
  // Bright edges (top and left)
  ctx.fillStyle = COLOR_BORDER_EDGE;
  ctx.fillRect(x, y, CELL, 1);
  ctx.fillRect(x, y, 1, CELL);
}

function drawTrailCell(r, c) {
  const x = c * CELL, y = r * CELL;
  ctx.fillStyle = COLOR_TRAIL;
  ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
}

function drawPlayer() {
  if (state.phase === 'dying') {
    const t = Math.min(state.animTimer / 1200, 1);
    const size = CELL * (1 + t * 4);
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = COLOR_PLAYER;
    ctx.fillRect(
      player.col * CELL - (size - CELL) / 2,
      player.row * CELL - (size - CELL) / 2,
      size, size
    );
    ctx.globalAlpha = 1;
    return;
  }

  const x = player.col * CELL + CELL / 2;
  const y = player.row * CELL + CELL / 2;

  ctx.save();
  ctx.translate(x, y);

  const { dc, dr } = player.dir;
  const angle = (dc === 0 && dr === 0) ? 0 : Math.atan2(dr, dc);
  ctx.rotate(angle);

  ctx.fillStyle = COLOR_PLAYER;
  ctx.shadowColor = COLOR_PLAYER;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(CELL / 2, 0);
  ctx.lineTo(-CELL / 3, -CELL / 3);
  ctx.lineTo(-CELL / 5, 0);
  ctx.lineTo(-CELL / 3, CELL / 3);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawFuzzy(f) {
  const x = f.col * CELL + CELL / 2;
  const y = f.row * CELL + CELL / 2;
  const radius = CELL / 2 - 1;
  const spikes = 7;

  ctx.save();
  ctx.fillStyle = COLOR_FUZZY;
  ctx.shadowColor = COLOR_FUZZY;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i * Math.PI) / spikes - Math.PI / 2;
    const r = i % 2 === 0 ? radius : radius * 0.5;
    if (i === 0) ctx.moveTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
    else ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawSparx(s) {
  const cell = perimeterCells[s.edgeIndex];
  if (!cell) return;
  const x = cell.col * CELL + CELL / 2;
  const y = cell.row * CELL + CELL / 2;

  ctx.save();
  ctx.fillStyle = COLOR_SPARX;
  ctx.shadowColor = COLOR_SPARX;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(x, y, CELL / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ===== START =====
document.getElementById('startBtn').addEventListener('click', () => {
  state.score = 0;
  state.lives = 3;
  state.level = 1;
  state.phase = 'playing';
  initLevel(1);
  hideOverlay();
  if (!loopRunning) {
    loopRunning = true;
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
  }
});

// Restart from game over
document.getElementById('startBtn').addEventListener('click', () => {}, { capture: true });
