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

  // ---- Phase 1: Place rooms ----
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

  // ---- Phase 2: Carve rooms and mark wall ring ----
  for (const rm of rooms) {
    for (let r = rm.y1; r <= rm.y2; r++)
      for (let c = rm.x1; c <= rm.x2; c++)
        maze[r][c] = CELL_OPEN;

    for (let r = rm.y1 - 1; r <= rm.y2 + 1; r++) {
      for (let c = rm.x1 - 1; c <= rm.x2 + 1; c++) {
        if (r >= 0 && r < mazeH && c >= 0 && c < mazeW && maze[r][c] === CELL_WALL) {
          wallTextureMap[r][c] = rm.texIdx;
          roomWall[r][c] = rm.id;
        }
      }
    }
  }

  // ---- Phase 3: Place corridor anchors (1-4 per room) ----
  // Each anchor = a CELL_DOOR on the wall ring + a CELL_OPEN cell just outside
  const anchors = []; // { roomId, doorR, doorC, anchorR, anchorC, used }
  // Track wall cells that support doors — must not be carved by anchors or corridors
  const protectedWalls = new Set();

  function addDoorProtection(doorR, doorC, vertical) {
    if (vertical) {
      // Vertical door (N/S): wall supports to east and west
      if (doorC > 0) protectedWalls.add(doorR * mazeW + (doorC - 1));
      if (doorC < mazeW - 1) protectedWalls.add(doorR * mazeW + (doorC + 1));
    } else {
      // Horizontal door (E/W): wall supports to north and south
      if (doorR > 0) protectedWalls.add((doorR - 1) * mazeW + doorC);
      if (doorR < mazeH - 1) protectedWalls.add((doorR + 1) * mazeW + doorC);
    }
  }

  for (const rm of rooms) {
    const numExits = randInt(1, 4);
    const placed = []; // [{doorR, doorC}] to check adjacency

    for (let ei = 0; ei < numExits; ei++) {
      // Collect all valid wall-ring positions for an exit
      const candidates = [];

      // North wall (row = y1-1, cols = x1..x2)
      for (let c = rm.x1; c <= rm.x2; c++) {
        const dr = rm.y1 - 1, ar = rm.y1 - 2;
        if (ar >= 0 && maze[ar][c] === CELL_WALL)
          candidates.push({ doorR: dr, doorC: c, anchorR: ar, anchorC: c });
      }
      // South wall
      for (let c = rm.x1; c <= rm.x2; c++) {
        const dr = rm.y2 + 1, ar = rm.y2 + 2;
        if (ar < mazeH && maze[ar][c] === CELL_WALL)
          candidates.push({ doorR: dr, doorC: c, anchorR: ar, anchorC: c });
      }
      // West wall
      for (let r = rm.y1; r <= rm.y2; r++) {
        const dc = rm.x1 - 1, ac = rm.x1 - 2;
        if (ac >= 0 && maze[r][ac] === CELL_WALL)
          candidates.push({ doorR: r, doorC: dc, anchorR: r, anchorC: ac });
      }
      // East wall
      for (let r = rm.y1; r <= rm.y2; r++) {
        const dc = rm.x2 + 1, ac = rm.x2 + 2;
        if (ac < mazeW && maze[r][ac] === CELL_WALL)
          candidates.push({ doorR: r, doorC: dc, anchorR: r, anchorC: ac });
      }

      // Filter out candidates that conflict with existing exits
      const valid = candidates.filter(c => {
        // Not adjacent to already-placed exits on this room
        if (placed.some(p =>
          Math.abs(c.doorR - p.doorR) + Math.abs(c.doorC - p.doorC) <= 1
        )) return false;

        // Anchor/door must not land on a protected wall cell
        if (protectedWalls.has(c.anchorR * mazeW + c.anchorC)) return false;
        if (protectedWalls.has(c.doorR * mazeW + c.doorC)) return false;

        // The door's wall supports must currently be walls
        const vert = (c.doorR === rm.y1 - 1 || c.doorR === rm.y2 + 1);
        if (vert) {
          // Vertical door needs walls east and west
          const wOk = c.doorC > 0 && maze[c.doorR][c.doorC - 1] === CELL_WALL;
          const eOk = c.doorC < mazeW - 1 && maze[c.doorR][c.doorC + 1] === CELL_WALL;
          if (!wOk || !eOk) return false;
        } else {
          // Horizontal door needs walls north and south
          const nOk = c.doorR > 0 && maze[c.doorR - 1][c.doorC] === CELL_WALL;
          const sOk = c.doorR < mazeH - 1 && maze[c.doorR + 1][c.doorC] === CELL_WALL;
          if (!nOk || !sOk) return false;
        }

        return true;
      });

      if (valid.length === 0) break; // can't place more exits

      const pick = valid[Math.floor(Math.random() * valid.length)];
      placed.push(pick);

      // Determine door orientation: vertical if door is north/south of room
      const vertical = (pick.doorR === rm.y1 - 1 || pick.doorR === rm.y2 + 1);

      maze[pick.doorR][pick.doorC] = CELL_DOOR;
      maze[pick.anchorR][pick.anchorC] = CELL_OPEN;
      corridorSet.add(pick.anchorR * mazeW + pick.anchorC);

      doorCells.push({ r: pick.doorR, c: pick.doorC, vertical });
      addDoorProtection(pick.doorR, pick.doorC, vertical);

      anchors.push({
        roomId: rm.id,
        doorR: pick.doorR, doorC: pick.doorC,
        anchorR: pick.anchorR, anchorC: pick.anchorC,
        used: false,
      });
    }
  }

  // ---- Phase 4: MST on room centers + extra edges ----
  const centers = rooms.map(rm => ({
    r: Math.floor((rm.y1 + rm.y2) / 2),
    c: Math.floor((rm.x1 + rm.x2) / 2)
  }));

  const inMST = new Uint8Array(rooms.length);
  const mstEdges = [];
  if (rooms.length > 0) {
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
  }

  // ---- Phase 5: Pathfind corridors between anchor pairs ----
  // BFS that can carve through unowned walls, avoiding rooms, room walls, and door supports
  function corridorBFS(sr, sc, er, ec) {
    const dist = Array.from({ length: mazeH }, () => new Int32Array(mazeW).fill(-1));
    const prev = Array.from({ length: mazeH }, () => new Array(mazeW).fill(null));
    dist[sr][sc] = 0;
    const queue = [[sr, sc]];
    while (queue.length) {
      const [cr, cc] = queue.shift();
      if (cr === er && cc === ec) break;
      for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nr = cr + dr, nc = cc + dc;
        if (nr < 0 || nr >= mazeH || nc < 0 || nc >= mazeW) continue;
        if (dist[nr][nc] !== -1) continue;
        // Can only pass through unowned wall cells, or open cells that are corridor/anchors
        const cell = maze[nr][nc];
        const owner = roomWall[nr][nc];
        if (owner !== -1) continue; // room wall — impassable
        if (protectedWalls.has(nr * mazeW + nc) && cell === CELL_WALL) continue; // door support
        if (cell === CELL_OPEN || cell === CELL_DOOR) {
          // Already-carved corridor or anchor — passable
        } else if (cell === CELL_WALL) {
          // Unowned wall — passable (will be carved)
        } else {
          continue; // room interior (START/EXIT treated as room interior)
        }
        dist[nr][nc] = dist[cr][cc] + 1;
        prev[nr][nc] = [cr, cc];
        queue.push([nr, nc]);
      }
    }
    if (dist[er][ec] === -1) return null; // no path
    // Reconstruct path
    const path = [];
    let cur = [er, ec];
    while (cur) {
      path.push(cur);
      cur = prev[cur[0]][cur[1]];
    }
    return path;
  }

  for (const [i, j] of mstEdges) {
    // Find closest unused anchor pair between rooms i and j
    let bestDist = Infinity, bestA = null, bestB = null;
    for (const a of anchors) {
      if (a.roomId !== i || a.used) continue;
      for (const b of anchors) {
        if (b.roomId !== j || b.used) continue;
        const d = Math.abs(a.anchorR - b.anchorR) + Math.abs(a.anchorC - b.anchorC);
        if (d < bestDist) { bestDist = d; bestA = a; bestB = b; }
      }
    }
    if (!bestA || !bestB) continue; // no available anchors

    const path = corridorBFS(bestA.anchorR, bestA.anchorC, bestB.anchorR, bestB.anchorC);
    if (!path) continue; // no path found, skip

    // Carve the corridor path
    for (const [r, c] of path) {
      if (maze[r][c] === CELL_WALL) {
        maze[r][c] = CELL_OPEN;
        corridorSet.add(r * mazeW + c);
      }
    }
    bestA.used = true;
    bestB.used = true;
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

  // ---- Phase 6: Columns inside rooms ----
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

  // ---- Phase 7: Start & exit (two most distant rooms) ----
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

  // ---- Phase 8: Default texture for unassigned walls ----
  for (let r = 0; r < mazeH; r++)
    for (let c = 0; c < mazeW; c++)
      if (wallTextureMap[r][c] === -1) wallTextureMap[r][c] = CORRIDOR_TEX;

  return { startR, startC };
}

// ==================== PUBLIC API ====================

const NUM_WALL_TEXTURES = 6;

/**
 * Result of maze generation. All 2D arrays are indexed as [row][col], where
 * row corresponds to the Z axis (north/south) and col to the X axis (east/west).
 */
export class Maze {
  /**
   * 2D cell grid, `height` rows x `width` columns. Each element is one of the
   * CELL_* constants: CELL_OPEN (0), CELL_WALL (1), CELL_START (2),
   * CELL_EXIT (3), or CELL_DOOR (4).
   *
   * Mutable — the game writes to it when doors open/close.
   * @type {Uint8Array[]}
   */
  cells;

  /**
   * Per-cell wall texture index, same dimensions as `cells`.
   * Only meaningful for CELL_WALL cells; values are indices into the wall
   * texture array used by the renderer (0–5).
   * @type {number[][]}
   */
  wallTextureMap;

  /**
   * Doors placed in the maze. Each entry describes one door:
   * - `row`, `col` — position in the grid (matches `cells[row][col]`)
   * - `vertical` — if true the door spans the X axis (blocks north/south
   *   movement); if false it spans the Z axis (blocks east/west movement)
   * @type {{row: number, col: number, vertical: boolean}[]}
   */
  doors;

  /** Row of the player start cell. */
  startRow;

  /** Column of the player start cell. */
  startCol;

  /** Number of columns (X extent). Derived from `cells[0].length`. */
  get width() { return this.cells[0].length; }

  /** Number of rows (Z extent). Derived from `cells.length`. */
  get height() { return this.cells.length; }

  constructor(cells, wallTextureMap, doors, startRow, startCol) {
    this.cells = cells;
    this.wallTextureMap = wallTextureMap;
    this.doors = doors;
    this.startRow = startRow;
    this.startCol = startCol;
  }

  /**
   * Render the maze as ASCII art for debugging.
   * Legend: # = wall, . = open, S = start, E = exit, D = door
   */
  toString() {
    const charMap = ['.', '#', 'S', 'E', 'D'];
    return this.cells.map(row =>
      Array.from(row, v => charMap[v] ?? '?').join('')
    ).join('\n');
  }
}

/**
 * Generate a maze.
 * @param {'rooms'|'classic'} mode
 * @returns {Maze|null} null if room generation fails after max retries
 */
export function generateMaze(mode) {
  const MAZE_W = mode === 'rooms' ? 41 : 21;
  const MAZE_H = mode === 'rooms' ? 41 : 21;
  const maxRetries = mode === 'rooms' ? 10 : 1;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const cells = [];
    for (let i = 0; i < MAZE_H; i++) {
      cells.push(new Uint8Array(MAZE_W).fill(CELL_WALL));
    }
    const wallTextureMap = [];
    for (let r = 0; r < MAZE_H; r++) {
      wallTextureMap.push(new Array(MAZE_W).fill(-1));
    }
    const doorCells = [];

    let startR, startC;
    if (mode === 'rooms') {
      ({ startR, startC } = generateRoomDungeon(cells, wallTextureMap, doorCells, MAZE_H, MAZE_W));
    } else {
      ({ startR, startC } = generateClassicMaze(cells, wallTextureMap, doorCells, MAZE_H, MAZE_W, NUM_WALL_TEXTURES));
    }

    const doors = doorCells.map(d => ({ row: d.r, col: d.c, vertical: d.vertical }));
    const maze = new Maze(cells, wallTextureMap, doors, startR, startC);

    // Reachability check for room mode
    if (mode === 'rooms') {
      let exitR = -1, exitC = -1;
      for (let r = 0; r < MAZE_H; r++)
        for (let c = 0; c < MAZE_W; c++)
          if (cells[r][c] === CELL_EXIT) { exitR = r; exitC = c; }

      if (exitR === -1) continue; // no exit placed

      const dist = bfsFrom(cells, MAZE_H, MAZE_W, startR, startC);
      if (dist[exitR][exitC] === -1) continue; // exit unreachable, retry
    }

    return maze;
  }

  return null; // all retries failed
}
