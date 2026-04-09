import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, CELL_OPEN, CELL_WALL, CELL_DOOR } from './mazegen.js';
import { GameState, CELL, WALL_H, INVENTORY_SIZE, ITEM_DEFS } from './game.js';

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
    assert.deepEqual(picked, [0]);
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
  it('tryOpenDoor opens nearest door', () => {
    const g = makeGame();
    if (g.doors.length === 0) return; // classic mode may not have doors
    const door = g.doors[0];
    const dx = door.col * CELL + CELL / 2;
    const dz = door.row * CELL + CELL / 2;
    g.gameStarted = true;
    const idx = g.tryOpenDoor(dx, dz);
    assert.ok(idx >= 0);
    assert.ok(g.doors[idx].open);
  });

  it('updateDoors slides open door up', () => {
    const g = makeGame();
    if (g.doors.length === 0) return;
    g.gameStarted = true;
    const door = g.doors[0];
    const dx = door.col * CELL + CELL / 2;
    const dz = door.row * CELL + CELL / 2;
    g.tryOpenDoor(dx, dz);
    g.setDoorOpenTime(0, 0);

    // Simulate several frames
    for (let i = 0; i < 60; i++) {
      g.updateDoors(1 / 15, 1000, 0, 0); // player far away
    }
    assert.ok(door.slideY > 0, 'door should have slid up');
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
