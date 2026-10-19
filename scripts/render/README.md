# scripts/render

The Blender scene and tools behind the Slips feed module's images in `public/hardware/feed/`.
Read `docs/rendering.md` first: the camera, the lights, what each render holds, the rules and the recipes.

- `build.py`, `geo.py`, `parts.py`, `env.npz`: the scene (run inside Blender)
- `render-all.sh`, `render-head.sh`: every layer, or only the head unit and the drive
- `post.py`, `deckpost.py`, `deck.py`, `pack.py`, `compare.py`: renders to page assets
- `checks/`: Playwright checks against the sandbox (`npm run sandbox`)

Outputs (`out/`, `layers/`, `deck/`) are ignored by git.
