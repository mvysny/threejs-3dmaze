import { CELL_OPEN, CELL_WALL, CELL_DOOR, CELL_GOLD_DOOR } from './mazegen.js';

export const CELL = 4;
export const WALL_H = 4;
export const PLAYER_RADIUS = 0.5;
export const INVENTORY_SIZE = 10;
export const DOOR_OPEN_DURATION = 3000; // ms before auto-close

export const ITEM_DEFS = {
  golden_key: { name: 'Golden Key', icon: '🗝' },
};

export class GameState {
  constructor(mazeData) {
    const { cells, width, height, doors: doorCells, startRow, startCol } = mazeData;
    this.maze = cells;
    this.mazeW = width;
    this.mazeH = height;
    this.startRow = startRow;
    this.startCol = startCol;

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
      open: false,
      openTime: 0,
      slideY: 0,
    }));

    // World items (logic side — no mesh references)
    this.worldItems = []; // { type, wx, wz, pickupRadius }
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
    return cell === CELL_WALL || cell === CELL_DOOR || cell === CELL_GOLD_DOOR;
  }

  canMove(x, z) {
    return !this.isWall(x - PLAYER_RADIUS, z - PLAYER_RADIUS) &&
           !this.isWall(x + PLAYER_RADIUS, z - PLAYER_RADIUS) &&
           !this.isWall(x - PLAYER_RADIUS, z + PLAYER_RADIUS) &&
           !this.isWall(x + PLAYER_RADIUS, z + PLAYER_RADIUS);
  }

  // ==================== WORLD ITEMS ====================

  spawnItem(type, wx, wz) {
    this.worldItems.push({ type, wx, wz, pickupRadius: CELL * 0.5 });
    return this.worldItems.length - 1; // return index for mesh mapping
  }

  /** Check pickups; returns array of picked-up item indices (caller removes meshes). */
  checkPickups(playerX, playerZ) {
    const pickedUp = [];
    for (let i = this.worldItems.length - 1; i >= 0; i--) {
      const item = this.worldItems[i];
      const dist = Math.hypot(playerX - item.wx, playerZ - item.wz);
      if (dist < item.pickupRadius) {
        if (this.addToInventory(item.type)) {
          pickedUp.push(i);
          this.worldItems.splice(i, 1);
        }
      }
    }
    return pickedUp;
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
      const prevCollision = door.slideY >= WALL_H;

      const closedCell = door.gold ? CELL_GOLD_DOOR : CELL_DOOR;

      // Auto-close after timeout (only if player is not underneath)
      // Gold doors stay open permanently once unlocked
      if (!door.gold && door.open && door.slideY >= WALL_H && now - door.openTime > DOOR_OPEN_DURATION) {
        if (pc !== door.col || pr !== door.row) {
          door.open = false;
          this.maze[door.row][door.col] = closedCell;
        }
      }

      if (door.open) {
        if (door.slideY < WALL_H) {
          door.slideY += dt * 4;
          if (door.slideY > WALL_H) door.slideY = WALL_H;
        }
      } else {
        if (door.slideY > 0) {
          door.slideY -= dt * 3;
          if (door.slideY < 0) door.slideY = 0;
        }
      }

      // Update collision
      if (door.slideY >= WALL_H) {
        this.maze[door.row][door.col] = CELL_OPEN;
      } else {
        this.maze[door.row][door.col] = closedCell;
      }

      const nowCollision = door.slideY >= WALL_H;
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
