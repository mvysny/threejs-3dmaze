import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, bfsFrom, CELL_START, CELL_EXIT, CELL_WALL, CELL_DOOR } from './mazegen.js';

/**
 * Find the grid coordinates of a cell with the given value.
 * Returns {r, c} or null.
 */
function findCell(m, value) {
  for (let r = 0; r < m.height; r++)
    for (let c = 0; c < m.width; c++)
      if (m.cells[r][c] === value) return { r, c };
  return null;
}

for (const mode of ['classic', 'rooms']) {
  describe(`${mode} generator`, () => {

    it('exit is reachable from start', () => {
      // Run several times since generation is random
      for (let i = 0; i < 20; i++) {
        const m = generateMaze(mode);

        const exit = findCell(m, CELL_EXIT);
        assert.notEqual(exit, null, `iteration ${i}: no exit cell found`);

        const dist = bfsFrom(m.cells, m.height, m.width, m.startRow, m.startCol);
        assert.notEqual(dist[exit.r][exit.c], -1,
          `iteration ${i}: exit at (${exit.r},${exit.c}) is not reachable from start (${m.startRow},${m.startCol})`);
      }
    });

    it('has exactly one start and one exit', () => {
      for (let i = 0; i < 10; i++) {
        const m = generateMaze(mode);
        let starts = 0, exits = 0;
        for (let r = 0; r < m.height; r++)
          for (let c = 0; c < m.width; c++) {
            if (m.cells[r][c] === CELL_START) starts++;
            if (m.cells[r][c] === CELL_EXIT) exits++;
          }
        assert.equal(starts, 1, `iteration ${i}: expected 1 start, got ${starts}`);
        assert.equal(exits, 1, `iteration ${i}: expected 1 exit, got ${exits}`);
      }
    });

  });
}

describe('rooms door validation', () => {
  it('doors must be 1-wide with wall supports on both sides', () => {
    for (let i = 0; i < 50; i++) {
      const m = generateMaze('rooms');

      for (const door of m.doors) {
        const { row, col, vertical } = door;

        if (vertical) {
          // Door blocks north/south — wall supports must be east and west
          const westOk = col > 0 && m.cells[row][col - 1] === CELL_WALL;
          const eastOk = col < m.width - 1 && m.cells[row][col + 1] === CELL_WALL;
          assert.ok(westOk && eastOk,
            `iteration ${i}: vertical door at (${row},${col}) missing wall supports (west=${westOk}, east=${eastOk})\n${m}`);
        } else {
          // Door blocks east/west — wall supports must be north and south
          const northOk = row > 0 && m.cells[row - 1][col] === CELL_WALL;
          const southOk = row < m.height - 1 && m.cells[row + 1][col] === CELL_WALL;
          assert.ok(northOk && southOk,
            `iteration ${i}: horizontal door at (${row},${col}) missing wall supports (north=${northOk}, south=${southOk})\n${m}`);
        }
      }

      // Also check: no two adjacent doors in same orientation (no wide door stretches)
      for (let r = 0; r < m.height; r++) {
        for (let c = 0; c < m.width; c++) {
          if (m.cells[r][c] !== CELL_DOOR) continue;
          // Check right neighbor
          if (c + 1 < m.width && m.cells[r][c + 1] === CELL_DOOR) {
            assert.fail(
              `iteration ${i}: adjacent doors at (${r},${c}) and (${r},${c + 1})\n${m}`);
          }
          // Check bottom neighbor
          if (r + 1 < m.height && m.cells[r + 1][c] === CELL_DOOR) {
            assert.fail(
              `iteration ${i}: adjacent doors at (${r},${c}) and (${r + 1},${c})\n${m}`);
          }
        }
      }
    }
  });
});
