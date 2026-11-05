# Cube Hollow

A cozy 2.5D village-building game. You are a small cube with no eyes, hopping
around a hand-crafted-feeling world of terraced hills, wind-swept grass and
polygonal trees — building your own comfy corner of the valley.

Built with [three.js](https://threejs.org) (r170), no build step, no
dependencies beyond the vendored three.js module. Runs on any device,
including iPad and other touch devices.

**Play:** https://ardy03851-bit.github.io/cube-hollow/

## Features

- Fixed isometric camera — the point of view never changes, just like the
  classic cozy references
- Advanced procedural terrain: domain-warped height, irregular hand-cut
  terraces, ridged cliff outcrops, carved rivers and winding dirt trails
- Everything sways with the wind — grass tufts shear, and every bush part
  (each blob!) moves on its own phase
- 12 buildable block types: grass, dirt, stone, wood, plank, roof, window,
  door, fence, lantern, path, flower — place and remove on a 1 m grid
- Day/night cycle with color-graded sky, moving sun with real cast shadows,
  fog, fireflies at night
- Water with foam, drifting motes, hop/squash character animation
- World auto-saves to your browser (localStorage)

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | WASD / arrows | left joystick |
| Place block | Space | ✓ button |
| Remove block | X / Backspace | ✕ button |
| Cycle block type | 1-9, Q/E | tap hotbar |

## Development

Everything is plain ES modules — just serve the folder statically:

```bash
python3 tools/dev_server.py   # or any static file server
```

Project layout:

- `src/worldgen.js` — seeded procedural terrain (simplex/fbm noise)
- `src/chunk.js` — chunk meshing, props, instanced grass
- `src/wind.js` — GPU wind animation (onBeforeCompile shader patching)
- `src/build.js` — building system + save
- `src/main.js` — renderer, camera, day/night, chunk streaming

## License

MIT
