// ==================== MAZE GENERATION ====================
//
// Pure-logic maze generator — no DOM, no Three.js.
// Used by both 3dmaze.html (browser) and tests (Node).

// Cell types in the maze grid
export const CELL_OPEN = 0;
export const CELL_WALL = 1;
export const CELL_START = 2;
export const CELL_EXIT = 3;
export const CELL_DOOR = 4;

const CORRIDOR_TEX = 2; // texDarkStone index for corridors

// ---- BFS helper: returns 2-D distance map from (sr, sc) ----
export function bfsFrom(maze, mazeH, mazeW, sr, sc) {
  const dist = Array.from({ length: mazeH }, () => new Int32Array(mazeW).fill(-1));
  const queue = [[sr, sc]];
  dist[sr][sc] = 0;
  while (queue.length) {
    const [cr, cc] = queue.shift();
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nr = cr + dr, nc = cc + dc;
      if (nr >= 0 && nr < mazeH && nc >= 0 && nc < mazeW && maze[nr][nc] !== CELL_WALL && dist[nr][nc] === -1) {
        dist[nr][nc] = dist[cr][cc] + 1;
        queue.push([nr, nc]);
      }
    }
  }
  return dist;
}

// ==================== CLASSIC MAZE (recursive backtracker) ====================

function generateClassicMaze(maze, wallTextureMap, doorCells, mazeH, mazeW, numWallTextures) {
  const passageCells = [];
  maze[1][1] = CELL_OPEN;
  const stack = [[1, 1]];

  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const dirs = [[0,2],[0,-2],[2,0],[-2,0]].filter(([dr, dc]) => {
      const nr = r + dr, nc = c + dc;
      return nr > 0 && nr < mazeH - 1 && nc > 0 && nc < mazeW - 1 && maze[nr][nc] === CELL_WALL;
    });
    if (dirs.length === 0) { stack.pop(); continue; }
    const [dr, dc] = dirs[Math.floor(Math.random() * dirs.length)];
    const br = r + dr / 2, bc = c + dc / 2;
    maze[br][bc] = CELL_OPEN;
    maze[r + dr][c + dc] = CELL_OPEN;
    passageCells.push({ r: br, c: bc, vertical: dr !== 0 });
    stack.push([r + dr, c + dc]);
  }

  // Start & exit
  const startR = 1, startC = 1;
  maze[1][1] = CELL_START;
  const dist = bfsFrom(maze, mazeH, mazeW, 1, 1);
  let bestR = 1, bestC = 1, bestDist = 0;
  for (let r = 0; r < mazeH; r++)
    for (let c = 0; c < mazeW; c++)
      if (dist[r][c] > bestDist) { bestDist = dist[r][c]; bestR = r; bestC = c; }
  maze[bestR][bestC] = CELL_EXIT;

  // Doors: ~30% of passages
  for (const d of passageCells) {
    if (Math.random() < 0.3 && !(d.r === 1 && d.c === 1)) {
      doorCells.push(d);
      maze[d.r][d.c] = CELL_DOOR;
    }
  }

  // Random textures per wall cell
  for (let r = 0; r < mazeH; r++)
    for (let c = 0; c < mazeW; c++)
      wallTextureMap[r][c] = Math.floor(Math.random() * numWallTextures);

  return { startR, startC };
}

// ==================== ROOM-BASED DUNGEON GENERATOR ====================

function generateRoomDungeon(maze, wallTextureMap, doorCells, mazeH, mazeW) {
  const MIN_ROOM = 3, MAX_ROOM = 7, MAX_ROOMS = 12, ATTEMPTS = 300;
  const COLUMN_CHANCE = 0.15;
  const roomTexChoices = [0, 1, 3, 4, 5]; // exclude index 2 (dark stone = corridors)

  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function randOdd(a, b) {
    const v = randInt(Math.ceil(a / 2), Math.floor(b / 2)) * 2 + 1;
    return Math.min(v, b);
  }

  // Track which wall cells belong to room perimeters (-1 = none)
  const roomWall = Array.from({ length: mazeH }, () => new Int8Array(mazeW).fill(-1));
  // Track which open cells are corridor (not room interior)
  const corridorSet = new Set();

  // ---- Phase 2: Place rooms ----
  const rooms = [];
  for (let att = 0; att < ATTEMPTS && rooms.length < MAX_ROOMS; att++) {
    const w = randOdd(MIN_ROOM, MAX_ROOM);
    const h = randOdd(MIN_ROOM, MAX_ROOM);
    const x1 = randInt(2, mazeW - w - 2);
    const y1 = randInt(2, mazeH - h - 2);
    const x2 = x1 + w - 1;
    const y2 = y1 + h - 1;

    // Check overlap (with 1-cell padding)
    let overlaps = false;
    for (const rm of rooms) {
      if (x1 - 2 <= rm.x2 && x2 + 2 >= rm.x1 && y1 - 2 <= rm.y2 && y2 + 2 >= rm.y1) {
        overlaps = true; break;
      }
    }
    if (overlaps) continue;

    const texIdx = roomTexChoices[Math.floor(Math.random() * roomTexChoices.length)];
    rooms.push({ id: rooms.length, x1, y1, x2, y2, texIdx });
  }

  // Carve rooms and mark wall ring
  for (const rm of rooms) {
    // Carve interior
    for (let r = rm.y1; r <= rm.y2; r++)
      for (let c = rm.x1; c <= rm.x2; c++)
        maze[r][c] = CELL_OPEN;

    // Mark wall ring with room texture
    for (let r = rm.y1 - 1; r <= rm.y2 + 1; r++) {
      for (let c = rm.x1 - 1; c <= rm.x2 + 1; c++) {
        if (r >= 0 && r < mazeH && c >= 0 && c < mazeW && maze[r][c] === CELL_WALL) {
          wallTextureMap[r][c] = rm.texIdx;
          roomWall[r][c] = rm.id;
        }
      }
    }
  }

  // ---- Phase 3: Connect rooms via MST + L-shaped corridors ----
  // Prim's MST on room centers
  const centers = rooms.map(rm => ({
    r: Math.floor((rm.y1 + rm.y2) / 2),
    c: Math.floor((rm.x1 + rm.x2) / 2)
  }));

  const inMST = new Uint8Array(rooms.length);
  const mstEdges = [];
  inMST[0] = 1;
  while (mstEdges.length < rooms.length - 1) {
    let bestD = Infinity, bestI = -1, bestJ = -1;
    for (let i = 0; i < rooms.length; i++) {
      if (!inMST[i]) continue;
      for (let j = 0; j < rooms.length; j++) {
        if (inMST[j]) continue;
        const d = Math.abs(centers[i].r - centers[j].r) + Math.abs(centers[i].c - centers[j].c);
        if (d < bestD) { bestD = d; bestI = i; bestJ = j; }
      }
    }
    if (bestJ === -1) break;
    inMST[bestJ] = 1;
    mstEdges.push([bestI, bestJ]);
  }

  // Add 1-2 extra edges for loops
  for (let extra = 0; extra < 2; extra++) {
    const i = randInt(0, rooms.length - 1);
    let j = randInt(0, rooms.length - 2);
    if (j >= i) j++;
    if (!mstEdges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) {
      mstEdges.push([i, j]);
    }
  }

  // Carve L-shaped corridors (only carve through walls of the two connected rooms)
  function carveCell(r, c, allowedRooms) {
    if (r < 0 || r >= mazeH || c < 0 || c >= mazeW) return;
    if (maze[r][c] === CELL_OPEN) return; // already open
    // Skip walls belonging to rooms we're not connecting
    const owner = roomWall[r][c];
    if (owner !== -1 && !allowedRooms.has(owner)) return;
    maze[r][c] = CELL_OPEN;
    corridorSet.add(r * mazeW + c);
  }

  function carveH(row, c1, c2, allowed) {
    const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
    for (let c = lo; c <= hi; c++) carveCell(row, c, allowed);
  }
  function carveV(col, r1, r2, allowed) {
    const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
    for (let r = lo; r <= hi; r++) carveCell(r, col, allowed);
  }

  for (const [i, j] of mstEdges) {
    const a = centers[i], b = centers[j];
    const allowed = new Set([i, j]);
    if (Math.random() < 0.5) {
      carveH(a.r, a.c, b.c, allowed);
      carveV(b.c, a.r, b.r, allowed);
    } else {
      carveV(a.c, a.r, b.r, allowed);
      carveH(b.r, a.c, b.c, allowed);
    }
  }

  // Mark corridor-adjacent walls with corridor texture (if not already room wall)
  for (const key of corridorSet) {
    const cr = Math.floor(key / mazeW), cc = key % mazeW;
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nr = cr + dr, nc = cc + dc;
      if (nr >= 0 && nr < mazeH && nc >= 0 && nc < mazeW && maze[nr][nc] === CELL_WALL && roomWall[nr][nc] === -1) {
        wallTextureMap[nr][nc] = CORRIDOR_TEX;
      }
    }
  }

  // ---- Phase 4: Place doors at room entrances ----
  const doorSet = new Set();
  for (const rm of rooms) {
    for (let r = rm.y1; r <= rm.y2; r++) {
      for (let c = rm.x1; c <= rm.x2; c++) {
        for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
          const nr = r + dr, nc = c + dc;
          const key = nr * mazeW + nc;
          if (corridorSet.has(key) && !doorSet.has(key)) {
            doorSet.add(key);
            doorCells.push({ r: nr, c: nc, vertical: (dr !== 0) });
          }
        }
      }
    }
  }
  for (const d of doorCells) maze[d.r][d.c] = CELL_DOOR;

  // ---- Phase 5: Columns inside rooms ----
  for (const rm of rooms) {
    const iw = rm.x2 - rm.x1 + 1, ih = rm.y2 - rm.y1 + 1;
    if (iw < 5 || ih < 5) continue;
    const colTex = roomTexChoices.filter(t => t !== rm.texIdx);
    const cTexIdx = colTex[Math.floor(Math.random() * colTex.length)];
    for (let r = rm.y1 + 2; r <= rm.y2 - 2; r += 2) {
      for (let c = rm.x1 + 2; c <= rm.x2 - 2; c += 2) {
        if (Math.random() < COLUMN_CHANCE) {
          maze[r][c] = CELL_WALL;
          wallTextureMap[r][c] = cTexIdx;
        }
      }
    }
  }

  // ---- Phase 6: Start & exit (two most distant rooms) ----
  let maxDist = 0, sIdx = 0, eIdx = 0;
  for (let i = 0; i < rooms.length; i++) {
    const dist = bfsFrom(maze, mazeH, mazeW, centers[i].r, centers[i].c);
    for (let j = i + 1; j < rooms.length; j++) {
      const d = dist[centers[j].r][centers[j].c];
      if (d > maxDist) { maxDist = d; sIdx = i; eIdx = j; }
    }
  }
  const startR = centers[sIdx].r, startC = centers[sIdx].c;
  maze[startR][startC] = CELL_START;
  maze[centers[eIdx].r][centers[eIdx].c] = CELL_EXIT;

  // ---- Phase 7: Default texture for unassigned walls ----
  for (let r = 0; r < mazeH; r++)
    for (let c = 0; c < mazeW; c++)
      if (wallTextureMap[r][c] === -1) wallTextureMap[r][c] = CORRIDOR_TEX;

  return { startR, startC };
}

// ==================== PUBLIC API ====================

const NUM_WALL_TEXTURES = 6;

/**
 * Generate a maze.
 * @param {'rooms'|'classic'} mode
 * @returns {{ maze: Uint8Array[], wallTextureMap: number[][], doorCells: {r,c,vertical}[],
 *             startR: number, startC: number, MAZE_W: number, MAZE_H: number }}
 */
export function generateMaze(mode) {
  const MAZE_W = mode === 'rooms' ? 41 : 21;
  const MAZE_H = mode === 'rooms' ? 41 : 21;

  const maze = [];
  for (let i = 0; i < MAZE_H; i++) {
    maze.push(new Uint8Array(MAZE_W).fill(CELL_WALL));
  }
  const wallTextureMap = [];
  for (let r = 0; r < MAZE_H; r++) {
    wallTextureMap.push(new Array(MAZE_W).fill(-1));
  }
  const doorCells = [];

  let startR, startC;
  if (mode === 'rooms') {
    ({ startR, startC } = generateRoomDungeon(maze, wallTextureMap, doorCells, MAZE_H, MAZE_W));
  } else {
    ({ startR, startC } = generateClassicMaze(maze, wallTextureMap, doorCells, MAZE_H, MAZE_W, NUM_WALL_TEXTURES));
  }

  return { maze, wallTextureMap, doorCells, startR, startC, MAZE_W, MAZE_H };
}
