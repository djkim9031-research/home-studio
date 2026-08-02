# Home Studio

A browser-based interior-design studio for real homes. Recreate a house in 3D
from its floor plan, then design inside it.

- **House library** — describe each home (household, pets, size, stories,
  basement, garage, dwelling type) and keep several on file; houses export and
  import as portable JSON.
- **Floor-plan ingestion** — upload a plan as an image or PDF, calibrate it
  against one known dimension, then trace the walls; the traced plan extrudes
  into a walkable 3D shell with door and window openings.
- **Matterport reference** — paste a tour link and the walkthrough docks beside
  the model for measuring and cross-checking while you trace.
- Orbit, plan, and first-person walking views; per-story visibility; floor-plan
  underlay toggle.

## Run

```bash
npm install
npm run dev
```

`npm run build:single` produces a fully self-contained `dist-single/index.html`;
the same build is served from `docs/` via GitHub Pages.

Built with Vite, TypeScript, and three.js. All layout math runs in inches with
a single inches→meters conversion at the scene boundary.
