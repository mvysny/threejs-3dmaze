# Dungeon Maze

A first-person 3D dungeon crawler built with Three.js. Navigate through procedurally generated mazes, open doors, and find the green exit to escape.

Two generator modes are available:
- **Rooms & Corridors** — rectangular rooms connected by L-shaped corridors via minimum spanning tree
- **Classic Maze** — recursive backtracker producing long winding passages

## Running the game

Serve the project directory over HTTP and open `3dmaze.html` in a browser. For example:

```sh
npx serve .
```

Then visit `http://localhost:3000/3dmaze.html`.

### Controls

- **WASD** — move
- **Arrow keys** — look around
- **Space** — open doors
- **M** — toggle minimap

## Running tests

Tests use the Node.js built-in test runner (no dependencies required, Node 18+):

```sh
node --test mazegen.test.js
```
