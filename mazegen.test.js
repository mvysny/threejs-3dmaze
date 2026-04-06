import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, bfsFrom, CELL_START, CELL_EXIT } from './mazegen.js';

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
