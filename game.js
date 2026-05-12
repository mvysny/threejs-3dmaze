import { CELL_OPEN, CELL_WALL, CELL_DOOR, CELL_GOLD_DOOR, CELL_SECRET_DOOR, CELL_START, bfsFrom } from './mazegen.js';

export const CELL = 4;
export const WALL_H = 4;
export const PLAYER_RADIUS = 0.5;
export const ENEMY_RADIUS = 0.4;
export const ENEMY_SPEED = 1.5; // world units per second
export const ENEMY_TURN_MIN_MS = 1500;
export const ENEMY_TURN_RAND_MS = 2000;
export const INVENTORY_SIZE = 10;
export const DOOR_OPEN_DURATION = 3000; // ms before auto-close

export const ITEM_DEFS = {
  golden_key: { name: 'Golden Key', icon: '🗝' },
};

export const ENEMY_DEFS = {
  skeleton: { name: 'Skeleton' },
};

export class GameState {
  constructor(mazeData) {
    const { cells, width, height, doors: doorCells, startRow, startCol,
            rooms = [], startRoomIdx = -1, exitRoomIdx = -1 } = mazeData;
    this.maze = cells;
    this.mazeW = width;
    this.mazeH = height;
    this.startRow = startRow;
    this.startCol = startCol;
    this.rooms = rooms;
    this.startRoomIdx = startRoomIdx;
    this.exitRoomIdx = exitRoomIdx;

    // Find exit
    this.exitX = 0;
    this.exitZ = 0;
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (cells[r][c] === 3 /* CELL_EXIT */) {
          this.exitX = c * CELL + CELL / 2;
          this.exitZ = r * CELL + CELL / 2;
        }
      }
    }

    // Player state
    this.player = {
      health: 100,
      inventory: new Array(INVENTORY_SIZE).fill(null),
    };

    // Game flow
    this.gameStarted = false;
    this.gameWon = false;
    this.startTime = 0;

    // Doors (logic side — no mesh references)
    this.doors = doorCells.map(d => ({
      row: d.row,
      col: d.col,
      vertical: d.vertical,
      gold: !!d.gold,
      secret: !!d.secret,
      open: false,
      openTime: 0,
      slideY: 0,
    }));

    // World items (logic side — no mesh references)
    this.worldItems = []; // { type, wx, wz, pickupRadius }

    // Enemies (logic side — no mesh references)
    this.enemies = []; // { type, wx, wz, dirAngle, nextTurnTime }
  }

  startGame(now) {
    if (this.gameStarted || this.gameWon) return false;
    this.gameStarted = true;
    this.startTime = now;
    return true;
  }

  getElapsedTime(now) {
    return ((now - this.startTime) / 1000).toFixed(0);
  }

  // ==================== INVENTORY ====================

  addToInventory(type) {
    const slot = this.player.inventory.indexOf(null);
    if (slot === -1) return false;
    this.player.inventory[slot] = type;
    return true;
  }

  removeFromInventory(type) {
    const slot = this.player.inventory.indexOf(type);
    if (slot === -1) return false;
    this.player.inventory[slot] = null;
    return true;
  }

  hasItem(type) {
    return this.player.inventory.includes(type);
  }

  // ==================== COLLISION ====================

  isWall(wx, wz) {
    const c = Math.floor(wx / CELL);
    const r = Math.floor(wz / CELL);
    if (r < 0 || r >= this.mazeH || c < 0 || c >= this.mazeW) return true;
    const cell = this.maze[r][c];
    return cell === CELL_WALL || cell === CELL_DOOR || cell === CELL_GOLD_DOOR || cell === CELL_SECRET_DOOR;
  }

  canMove(x, z) {
    if (this.isWall(x - PLAYER_RADIUS, z - PLAYER_RADIUS)) return false;
    if (this.isWall(x + PLAYER_RADIUS, z - PLAYER_RADIUS)) return false;
    if (this.isWall(x - PLAYER_RADIUS, z + PLAYER_RADIUS)) return false;
    if (this.isWall(x + PLAYER_RADIUS, z + PLAYER_RADIUS)) return false;
    if (this._anyEnemyWithin(x, z, ENEMY_RADIUS + PLAYER_RADIUS, null)) return false;
    return true;
  }

  _anyEnemyWithin(x, z, separation, ignoreEnemy) {
    for (const e of this.enemies) {
      if (e === ignoreEnemy) continue;
      const dx = x - e.wx, dz = z - e.wz;
      if (dx * dx + dz * dz < separation * separation) return true;
    }
    return false;
  }

  // ==================== WORLD ITEMS ====================

  spawnItem(type, wx, wz) {
    this.worldItems.push({ type, wx, wz, pickupRadius: CELL * 0.5 });
    return this.worldItems.length - 1; // return index for mesh mapping
  }

  /**
   * Pick a random open, reachable cell in a room rect. Returns { row, col } or null.
   * Avoids the exact start cell so the item isn't under the player.
   */
  _randomOpenCellInRoom(room, reachable) {
    const candidates = [];
    for (let r = room.y1; r <= room.y2; r++) {
      for (let c = room.x1; c <= room.x2; c++) {
        if (reachable[r][c] === -1) continue;
        const cell = this.maze[r][c];
        if (cell === CELL_OPEN || cell === CELL_START) {
          if (r === this.startRow && c === this.startCol) continue;
          candidates.push({ row: r, col: c });
        }
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * Find a random placement for the golden key.
   * - Must not be in the exit room
   * - Must be reachable from start
   * - Prefers non-start rooms; falls back to start room if necessary
   * - For classic mode (no rooms): picks a random reachable cell away from exit
   * Returns { row, col } in grid coordinates, or null if placement fails.
   */
  findKeyPlacement() {
    const reachable = bfsFrom(this.maze, this.mazeH, this.mazeW, this.startRow, this.startCol);

    // Rooms mode
    if (this.rooms.length > 0) {
      const preferred = []; // non-start, non-exit rooms
      let startRoom = null;

      for (let i = 0; i < this.rooms.length; i++) {
        if (i === this.exitRoomIdx) continue;
        if (i === this.startRoomIdx) {
          startRoom = this.rooms[i];
        } else {
          preferred.push(this.rooms[i]);
        }
      }

      // Shuffle preferred rooms and try each
      for (let i = preferred.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [preferred[i], preferred[j]] = [preferred[j], preferred[i]];
      }

      for (const room of preferred) {
        const cell = this._randomOpenCellInRoom(room, reachable);
        if (cell) return cell;
      }

      // Fall back to start room
      if (startRoom) {
        const cell = this._randomOpenCellInRoom(startRoom, reachable);
        if (cell) return cell;
      }

      return null;
    }

    // Classic mode: BFS from start, pick a random reachable cell not near exit
    const dist = bfsFrom(this.maze, this.mazeH, this.mazeW, this.startRow, this.startCol);
    const exitRow = Math.round((this.exitZ - CELL / 2) / CELL);
    const exitCol = Math.round((this.exitX - CELL / 2) / CELL);

    const candidates = [];
    for (let r = 0; r < this.mazeH; r++) {
      for (let c = 0; c < this.mazeW; c++) {
        if (dist[r][c] === -1) continue; // unreachable
        if (r === this.startRow && c === this.startCol) continue;
        const cell = this.maze[r][c];
        if (cell !== CELL_OPEN && cell !== CELL_START) continue;
        // Exclude cells near exit (within 3 grid steps)
        const exitDist = Math.abs(r - exitRow) + Math.abs(c - exitCol);
        if (exitDist <= 3) continue;
        candidates.push({ row: r, col: c });
      }
    }

    // If too restrictive, allow cells near exit but not at exit
    if (candidates.length === 0) {
      for (let r = 0; r < this.mazeH; r++) {
        for (let c = 0; c < this.mazeW; c++) {
          if (dist[r][c] === -1) continue;
          if (r === this.startRow && c === this.startCol) continue;
          if (r === exitRow && c === exitCol) continue;
          const cell = this.maze[r][c];
          if (cell !== CELL_OPEN && cell !== CELL_START) continue;
          candidates.push({ row: r, col: c });
        }
      }
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /** Check pickups; returns array of { index, type } for picked-up items (caller removes meshes). */
  checkPickups(playerX, playerZ) {
    const pickedUp = [];
    for (let i = this.worldItems.length - 1; i >= 0; i--) {
      const item = this.worldItems[i];
      const dist = Math.hypot(playerX - item.wx, playerZ - item.wz);
      if (dist < item.pickupRadius) {
        if (this.addToInventory(item.type)) {
          pickedUp.push({ index: i, type: item.type });
          this.worldItems.splice(i, 1);
        }
      }
    }
    return pickedUp;
  }

  // ==================== ENEMIES ====================

  spawnEnemy(type, wx, wz) {
    this.enemies.push({
      type,
      wx, wz,
      dirAngle: Math.random() * Math.PI * 2,
      nextTurnTime: 0,
    });
    return this.enemies.length - 1;
  }

  /**
   * Spawn an enemy in the start room (rooms mode) or adjacent to the player
   * start (classic mode). Avoids the exact player start cell.
   * Returns the enemy index, or -1 if no suitable cell exists.
   */
  spawnEnemyInStartRoom(type) {
    const place = this._findEnemySpawnInStartRoom();
    if (!place) return -1;
    return this.spawnEnemy(type, place.col * CELL + CELL / 2, place.row * CELL + CELL / 2);
  }

  _findEnemySpawnInStartRoom() {
    if (this.startRoomIdx >= 0 && this.rooms.length > 0) {
      const room = this.rooms[this.startRoomIdx];
      const candidates = [];
      for (let r = room.y1; r <= room.y2; r++) {
        for (let c = room.x1; c <= room.x2; c++) {
          const cell = this.maze[r][c];
          if (cell !== CELL_OPEN && cell !== CELL_START) continue;
          if (r === this.startRow && c === this.startCol) continue;
          candidates.push({ row: r, col: c });
        }
      }
      if (candidates.length === 0) return null;
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    // Classic mode: search outward for an open cell near the start
    const offsets = [
      [0, 1], [0, -1], [1, 0], [-1, 0],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
      [0, 2], [0, -2], [2, 0], [-2, 0],
    ];
    for (const [dr, dc] of offsets) {
      const r = this.startRow + dr;
      const c = this.startCol + dc;
      if (r < 0 || r >= this.mazeH || c < 0 || c >= this.mazeW) continue;
      const cell = this.maze[r][c];
      if (cell === CELL_OPEN || cell === CELL_START) return { row: r, col: c };
    }
    return null;
  }

  /** Can an enemy occupy (x, z) given walls, the player, and other enemies? */
  canEnemyMoveTo(x, z, self, playerX, playerZ) {
    if (this.isWall(x - ENEMY_RADIUS, z - ENEMY_RADIUS)) return false;
    if (this.isWall(x + ENEMY_RADIUS, z - ENEMY_RADIUS)) return false;
    if (this.isWall(x - ENEMY_RADIUS, z + ENEMY_RADIUS)) return false;
    if (this.isWall(x + ENEMY_RADIUS, z + ENEMY_RADIUS)) return false;
    const dpx = x - playerX, dpz = z - playerZ;
    const playerSep = ENEMY_RADIUS + PLAYER_RADIUS;
    if (dpx * dpx + dpz * dpz < playerSep * playerSep) return false;
    if (this._anyEnemyWithin(x, z, ENEMY_RADIUS * 2, self)) return false;
    return true;
  }

  /** Slow random-wander update for all enemies. */
  updateEnemies(dt, now, playerX, playerZ) {
    for (const e of this.enemies) {
      if (now >= e.nextTurnTime) {
        e.dirAngle = Math.random() * Math.PI * 2;
        e.nextTurnTime = now + ENEMY_TURN_MIN_MS + Math.random() * ENEMY_TURN_RAND_MS;
      }
      const dx = Math.cos(e.dirAngle) * ENEMY_SPEED * dt;
      const dz = Math.sin(e.dirAngle) * ENEMY_SPEED * dt;
      let moved = false;
      if (this.canEnemyMoveTo(e.wx + dx, e.wz, e, playerX, playerZ)) {
        e.wx += dx; moved = true;
      }
      if (this.canEnemyMoveTo(e.wx, e.wz + dz, e, playerX, playerZ)) {
        e.wz += dz; moved = true;
      }
      if (!moved) {
        // Stuck — re-pick direction on next tick
        e.nextTurnTime = 0;
      }
    }
  }

  // ==================== DOORS ====================

  /** Try to open the nearest door. Returns { index, needsKey } or null. */
  tryOpenDoor(playerX, playerZ) {
    if (!this.gameStarted || this.gameWon) return null;
    const interactDist = CELL * 1.8;
    for (let i = 0; i < this.doors.length; i++) {
      const door = this.doors[i];
      if (door.open) continue;
      const dx = (door.col * CELL + CELL / 2) - playerX;
      const dz = (door.row * CELL + CELL / 2) - playerZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < interactDist) {
        if (door.gold && !this.hasItem('golden_key')) {
          return { index: i, needsKey: true };
        }
        if (door.gold) {
          this.removeFromInventory('golden_key');
        }
        door.open = true;
        door.openTime = 0;
        return { index: i, needsKey: false };
      }
    }
    return null;
  }

  setDoorOpenTime(doorIndex, now) {
    this.doors[doorIndex].openTime = now;
  }

  /** Update door slide positions; returns list of door indices whose collision state changed. */
  updateDoors(dt, now, playerX, playerZ) {
    const changed = [];
    const pc = Math.floor(playerX / CELL);
    const pr = Math.floor(playerZ / CELL);

    for (let i = 0; i < this.doors.length; i++) {
      const door = this.doors[i];
      // Secret doors stop slightly below WALL_H to stay visible at the ceiling
      const slideTarget = door.secret ? WALL_H - 0.1 : WALL_H;
      const prevCollision = door.slideY >= slideTarget;

      const closedCell = door.secret ? CELL_SECRET_DOOR : door.gold ? CELL_GOLD_DOOR : CELL_DOOR;

      // Auto-close after timeout (only if player is not underneath)
      // Gold doors and secret doors stay open permanently once unlocked
      if (!door.gold && !door.secret && door.open && door.slideY >= slideTarget && now - door.openTime > DOOR_OPEN_DURATION) {
        if (pc !== door.col || pr !== door.row) {
          door.open = false;
          this.maze[door.row][door.col] = closedCell;
        }
      }

      if (door.open) {
        if (door.slideY < slideTarget) {
          door.slideY += dt * 4;
          if (door.slideY > slideTarget) door.slideY = slideTarget;
        }
      } else {
        if (door.slideY > 0) {
          door.slideY -= dt * 3;
          if (door.slideY < 0) door.slideY = 0;
        }
      }

      // Update collision
      if (door.slideY >= slideTarget) {
        this.maze[door.row][door.col] = CELL_OPEN;
      } else {
        this.maze[door.row][door.col] = closedCell;
      }

      const nowCollision = door.slideY >= slideTarget;
      if (prevCollision !== nowCollision) changed.push(i);
    }
    return changed;
  }

  // ==================== WIN CONDITION ====================

  checkWin(playerX, playerZ) {
    if (this.gameWon) return false;
    const dist = Math.hypot(playerX - this.exitX, playerZ - this.exitZ);
    if (dist < CELL * 0.6) {
      this.gameWon = true;
      return true;
    }
    return false;
  }
}
