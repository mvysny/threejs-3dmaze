import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, CELL_OPEN, CELL_WALL, CELL_DOOR, CELL_EXIT, bfsFrom } from './mazegen.js';
import { GameState, CELL, WALL_H, INVENTORY_SIZE, ITEM_DEFS, ENEMY_RADIUS, PLAYER_RADIUS } from './game.js';

function makeGame(mode = 'rooms') {
  return new GameState(generateMaze(mode));
}

describe('inventory', () => {
  it('adds item to first empty slot', () => {
    const g = makeGame();
    assert.ok(g.addToInventory('golden_key'));
    assert.equal(g.player.inventory[0], 'golden_key');
    assert.equal(g.player.inventory[1], null);
  });

  it('returns false when inventory is full', () => {
    const g = makeGame();
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      assert.ok(g.addToInventory('golden_key'));
    }
    assert.ok(!g.addToInventory('golden_key'));
  });

  it('removeFromInventory removes first matching item', () => {
    const g = makeGame();
    g.addToInventory('golden_key');
    g.addToInventory('golden_key');
    assert.ok(g.removeFromInventory('golden_key'));
    assert.equal(g.player.inventory[0], null);
    assert.equal(g.player.inventory[1], 'golden_key');
  });

  it('removeFromInventory returns false if item not present', () => {
    const g = makeGame();
    assert.ok(!g.removeFromInventory('golden_key'));
  });

  it('hasItem returns true only when item is present', () => {
    const g = makeGame();
    assert.ok(!g.hasItem('golden_key'));
    g.addToInventory('golden_key');
    assert.ok(g.hasItem('golden_key'));
  });
});

describe('collision', () => {
  it('walls block movement', () => {
    const g = makeGame();
    // Out of bounds is a wall
    assert.ok(g.isWall(-1, -1));
    // Start cell is open
    const sx = g.startCol * CELL + CELL / 2;
    const sz = g.startRow * CELL + CELL / 2;
    assert.ok(!g.isWall(sx, sz));
    assert.ok(g.canMove(sx, sz));
  });

  it('canMove checks four corners', () => {
    const g = makeGame();
    // A position deep inside a wall cell should fail
    // Find a wall cell
    let wr = -1, wc = -1;
    for (let r = 0; r < g.mazeH; r++) {
      for (let c = 0; c < g.mazeW; c++) {
        if (g.maze[r][c] === CELL_WALL) { wr = r; wc = c; break; }
      }
      if (wr >= 0) break;
    }
    assert.ok(wr >= 0, 'maze should have walls');
    const wx = wc * CELL + CELL / 2;
    const wz = wr * CELL + CELL / 2;
    assert.ok(!g.canMove(wx, wz));
  });
});

describe('world items & pickups', () => {
  it('spawns items and picks them up', () => {
    const g = makeGame();
    const sx = g.startCol * CELL + CELL / 2;
    const sz = g.startRow * CELL + CELL / 2;
    const idx = g.spawnItem('golden_key', sx + 0.5, sz + 0.5);
    assert.equal(idx, 0);
    assert.equal(g.worldItems.length, 1);

    // Player walks to the item
    const picked = g.checkPickups(sx + 0.5, sz + 0.5);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].index, 0);
    assert.equal(picked[0].type, 'golden_key');
    assert.equal(g.worldItems.length, 0);
    assert.ok(g.hasItem('golden_key'));
  });

  it('does not pick up when too far', () => {
    const g = makeGame();
    g.spawnItem('golden_key', 100, 100);
    const picked = g.checkPickups(0, 0);
    assert.deepEqual(picked, []);
    assert.ok(!g.hasItem('golden_key'));
  });
});

describe('doors', () => {
  // Find first non-gold door for basic door tests
  function findRegularDoor(g) {
    return g.doors.find(d => !d.gold);
  }

  it('tryOpenDoor opens nearest door', () => {
    const g = makeGame();
    const door = findRegularDoor(g);
    if (!door) return; // no regular doors
    const dx = door.col * CELL + CELL / 2;
    const dz = door.row * CELL + CELL / 2;
    g.gameStarted = true;
    const result = g.tryOpenDoor(dx, dz);
    assert.ok(result);
    assert.ok(!result.needsKey);
    assert.ok(g.doors[result.index].open);
  });

  it('updateDoors slides open door up', () => {
    const g = makeGame();
    const door = findRegularDoor(g);
    if (!door) return;
    g.gameStarted = true;
    const dx = door.col * CELL + CELL / 2;
    const dz = door.row * CELL + CELL / 2;
    const result = g.tryOpenDoor(dx, dz);
    g.setDoorOpenTime(result.index, 0);

    // Simulate several frames
    for (let i = 0; i < 60; i++) {
      g.updateDoors(1 / 15, 1000, 0, 0); // player far away
    }
    assert.ok(door.slideY > 0, 'door should have slid up');
  });

  it('gold door requires golden key', () => {
    const g = makeGame();
    const goldDoor = g.doors.find(d => d.gold);
    if (!goldDoor) return; // no gold doors in this maze
    const dx = goldDoor.col * CELL + CELL / 2;
    const dz = goldDoor.row * CELL + CELL / 2;
    g.gameStarted = true;

    // Without key: should need key
    const result1 = g.tryOpenDoor(dx, dz);
    assert.ok(result1);
    assert.ok(result1.needsKey);
    assert.ok(!goldDoor.open);

    // With key: should open and consume key
    g.addToInventory('golden_key');
    const result2 = g.tryOpenDoor(dx, dz);
    assert.ok(result2);
    assert.ok(!result2.needsKey);
    assert.ok(goldDoor.open);
    assert.ok(!g.hasItem('golden_key'), 'key should be consumed');
  });
});

describe('game flow', () => {
  it('startGame sets state', () => {
    const g = makeGame();
    assert.ok(!g.gameStarted);
    assert.ok(g.startGame(1000));
    assert.ok(g.gameStarted);
    assert.equal(g.startTime, 1000);
    // Cannot start twice
    assert.ok(!g.startGame(2000));
  });

  it('checkWin detects exit proximity', () => {
    const g = makeGame();
    assert.ok(!g.checkWin(0, 0)); // far from exit
    assert.ok(g.checkWin(g.exitX, g.exitZ)); // at exit
    assert.ok(g.gameWon);
    // Cannot win twice
    assert.ok(!g.checkWin(g.exitX, g.exitZ));
  });

  it('getElapsedTime returns seconds', () => {
    const g = makeGame();
    g.startGame(1000);
    assert.equal(g.getElapsedTime(4500), '4'); // 3.5s rounds to 4
  });
});

describe('enemies', () => {
  function startCellCenter(g) {
    return { x: g.startCol * CELL + CELL / 2, z: g.startRow * CELL + CELL / 2 };
  }

  it('spawnEnemy adds an enemy to the list', () => {
    const g = makeGame();
    const idx = g.spawnEnemy('skeleton', 10, 20);
    assert.equal(idx, 0);
    assert.equal(g.enemies.length, 1);
    assert.equal(g.enemies[0].type, 'skeleton');
    assert.equal(g.enemies[0].wx, 10);
    assert.equal(g.enemies[0].wz, 20);
  });

  it('rooms mode: spawnEnemyInStartRoom places enemy in start room, not on player', () => {
    for (let i = 0; i < 30; i++) {
      const g = makeGame('rooms');
      const idx = g.spawnEnemyInStartRoom('skeleton');
      assert.ok(idx >= 0, `iteration ${i}: spawn failed`);
      const e = g.enemies[idx];

      const room = g.rooms[g.startRoomIdx];
      const cx = room.x1 * CELL;
      const cz = room.y1 * CELL;
      const ex = (room.x2 + 1) * CELL;
      const ez = (room.y2 + 1) * CELL;
      assert.ok(e.wx >= cx && e.wx <= ex && e.wz >= cz && e.wz <= ez,
        `iteration ${i}: enemy outside start room`);

      const { x: sx, z: sz } = startCellCenter(g);
      assert.ok(Math.hypot(e.wx - sx, e.wz - sz) > 0.1,
        `iteration ${i}: enemy spawned on player start cell`);
    }
  });

  it('classic mode: spawnEnemyInStartRoom places enemy near player start', () => {
    for (let i = 0; i < 10; i++) {
      const g = makeGame('classic');
      const idx = g.spawnEnemyInStartRoom('skeleton');
      assert.ok(idx >= 0, `iteration ${i}: spawn failed`);
      const e = g.enemies[idx];
      const { x: sx, z: sz } = startCellCenter(g);
      // Within a couple of cells of start
      assert.ok(Math.hypot(e.wx - sx, e.wz - sz) <= CELL * 2.1);
    }
  });

  it('player canMove is blocked by an enemy', () => {
    const g = makeGame();
    const { x: sx, z: sz } = startCellCenter(g);
    // Verify the space near start is initially clear
    assert.ok(g.canMove(sx, sz));
    g.spawnEnemy('skeleton', sx, sz);
    assert.ok(!g.canMove(sx + 0.1, sz + 0.1),
      'player should not be able to occupy the same spot as an enemy');
    // Far enough away, movement is fine
    assert.ok(g.canMove(sx + (ENEMY_RADIUS + PLAYER_RADIUS) + 0.5, sz));
  });

  it('canEnemyMoveTo blocks at walls', () => {
    const g = makeGame();
    // Find any wall cell in the maze
    let wr = -1, wc = -1;
    for (let r = 0; r < g.mazeH && wr < 0; r++) {
      for (let c = 0; c < g.mazeW; c++) {
        if (g.maze[r][c] === CELL_WALL) { wr = r; wc = c; break; }
      }
    }
    assert.ok(wr >= 0, 'expected at least one wall in the maze');
    const wx = wc * CELL + CELL / 2;
    const wz = wr * CELL + CELL / 2;
    // Far-away player so it doesn't interfere
    assert.ok(!g.canEnemyMoveTo(wx, wz, null, -1000, -1000));
  });

  it('canEnemyMoveTo blocks when the player is in the way', () => {
    const g = makeGame();
    const { x: sx, z: sz } = startCellCenter(g);
    // Open spot away from any walls: start cell itself
    assert.ok(g.canEnemyMoveTo(sx, sz, null, sx + 100, sz + 100));
    assert.ok(!g.canEnemyMoveTo(sx, sz, null, sx + 0.1, sz));
  });

  it('updateEnemies moves an enemy along its heading', () => {
    const g = makeGame();
    const { x: sx, z: sz } = startCellCenter(g);
    g.spawnEnemy('skeleton', sx, sz);
    const e = g.enemies[0];
    e.dirAngle = 0; // east (+x)
    e.nextTurnTime = 1e12; // never re-pick during this test
    const x0 = e.wx;
    // Player far away
    g.updateEnemies(0.1, 0, sx + 1000, sz + 1000);
    assert.ok(e.wx > x0, `enemy should have moved east; before=${x0} after=${e.wx}`);
    // And heading still preserved
    assert.equal(e.dirAngle, 0);
  });

  it('updateEnemies cannot push an enemy through the player', () => {
    const g = makeGame();
    const { x: sx, z: sz } = startCellCenter(g);
    g.spawnEnemy('skeleton', sx, sz);
    const e = g.enemies[0];
    e.dirAngle = 0; // east
    e.nextTurnTime = 1e12;
    // Place the player just east of the enemy, blocking forward motion
    const playerX = e.wx + ENEMY_RADIUS + PLAYER_RADIUS + 0.05;
    const playerZ = e.wz;
    const x0 = e.wx;
    for (let i = 0; i < 20; i++) {
      g.updateEnemies(0.1, i * 100, playerX, playerZ);
    }
    // Enemy should not have crossed past the player
    assert.ok(e.wx < playerX - ENEMY_RADIUS - PLAYER_RADIUS + 0.01,
      `enemy crossed player: enemy=${e.wx} player=${playerX}`);
    // It also should not have moved meaningfully east
    assert.ok(e.wx <= x0 + 0.05, `enemy moved east into the player: ${x0} -> ${e.wx}`);
  });
});

describe('key placement', () => {
  it('rooms mode: key is placed in a reachable non-exit room', () => {
    for (let i = 0; i < 30; i++) {
      const g = makeGame('rooms');
      const pos = g.findKeyPlacement();
      assert.ok(pos, `iteration ${i}: findKeyPlacement returned null`);

      // Must be reachable from start
      const dist = bfsFrom(g.maze, g.mazeH, g.mazeW, g.startRow, g.startCol);
      assert.ok(dist[pos.row][pos.col] >= 0,
        `iteration ${i}: key at (${pos.row},${pos.col}) is not reachable from start`);

      // Must not be in exit room
      if (g.exitRoomIdx >= 0) {
        const exitRoom = g.rooms[g.exitRoomIdx];
        const inExitRoom = pos.row >= exitRoom.y1 && pos.row <= exitRoom.y2 &&
                           pos.col >= exitRoom.x1 && pos.col <= exitRoom.x2;
        assert.ok(!inExitRoom,
          `iteration ${i}: key at (${pos.row},${pos.col}) is inside exit room`);
      }

      // Must not be on the exact start cell
      assert.ok(pos.row !== g.startRow || pos.col !== g.startCol,
        `iteration ${i}: key placed on start cell`);
    }
  });

  it('rooms mode: key prefers non-start rooms when available', () => {
    let nonStartCount = 0;
    const runs = 50;
    for (let i = 0; i < runs; i++) {
      const g = makeGame('rooms');
      const pos = g.findKeyPlacement();
      assert.ok(pos);
      // Check if key is NOT in start room
      if (g.startRoomIdx >= 0) {
        const startRoom = g.rooms[g.startRoomIdx];
        const inStartRoom = pos.row >= startRoom.y1 && pos.row <= startRoom.y2 &&
                            pos.col >= startRoom.x1 && pos.col <= startRoom.x2;
        if (!inStartRoom) nonStartCount++;
      }
    }
    // With typically 10+ rooms, key should almost never land in start room
    assert.ok(nonStartCount > runs * 0.8,
      `key was in non-start room only ${nonStartCount}/${runs} times`);
  });

  it('classic mode: key is placed in a reachable cell away from exit', () => {
    for (let i = 0; i < 20; i++) {
      const g = makeGame('classic');
      const pos = g.findKeyPlacement();
      assert.ok(pos, `iteration ${i}: findKeyPlacement returned null`);

      // Must be reachable
      const dist = bfsFrom(g.maze, g.mazeH, g.mazeW, g.startRow, g.startCol);
      assert.ok(dist[pos.row][pos.col] >= 0,
        `iteration ${i}: key at (${pos.row},${pos.col}) is not reachable`);

      // Must be on an open cell
      const cell = g.maze[pos.row][pos.col];
      assert.ok(cell === CELL_OPEN || cell === 2 /* CELL_START */,
        `iteration ${i}: key at (${pos.row},${pos.col}) is on cell type ${cell}`);

      // Must not be on exact start cell
      assert.ok(pos.row !== g.startRow || pos.col !== g.startCol,
        `iteration ${i}: key placed on start cell`);
    }
  });
});
