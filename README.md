# Home Studio

Build your home in 3D, the way you'd build it in a life sim: draw walls, hang
doors and windows, run stairs upstairs, fill rooms with flooring — all under a
real sun that casts real shadows for any date and time you pick.

**Live**: https://djkim9031-research.github.io/home-studio/

## What it does

- **Home library** — create as many homes as you like; each keeps optional
  facts (dwelling type, garage, square footage, households, basement, floor
  count). Everything autosaves in your browser, and any home exports to a JSON
  file you can import on another machine.
- **House build mode**
  - **Walls**: pick height and thickness. Draw straight runs by dragging (they
    chain end-to-end, snap to 15° bearings, and weld to existing endpoints), or
    switch to Rectangle and type the room's length and width, choose which
    corner to anchor from, and click to drop the whole room. Paint any RGB color
    over a finish — paint, plaster, brick, or wood panel.
  - **Doors & windows**: set the size (windows take a sill height too), then
    slide along any wall — the distance from each end of the wall reads out
    live so you can hit the measurement you want. Depth always matches the
    wall. A few styles each, with more to come.
  - **Stairs**: width, run, one flight or a U-turn, open or closed risers,
    tread finish and color. They connect the floor you're on to the one above.
  - **Flooring**: once walls enclose an area, one click floors the whole room —
    oak, tile, carpet, or concrete, tinted any color. Rooms are bounded purely
    by the walls you draw, so a doorway gap keeps a space as one area; the same
    wall boundaries drive wall painting. Re-flooring an area replaces the old floor.
  - **Wallpaper**: paint one side of a wall at a time — click inside a room to
    paper its interior faces (partitions included), or click an outer face to
    paint the whole connected exterior shell. Inside and outside are separate
    groups, and a wall that runs from inside to outside is split at the wall it
    crosses so each part joins the right group. Paint, plaster, brick, wood
    panel, stripes, beadboard, or damask, tinted with quick swatches.
  - **Rooms**: click inside an enclosed area to name it; the label floats in
    the room with its square footage and can be renamed any time.
  - **Ceilings**: enclosed areas get an automatic flat ceiling that blocks the
    sun, so daylight only reaches the interior through your doors and windows.
    It hides when you look down into the room, so building stays unobstructed.
  - **Cutaway walls**: the walls between you and the room drop to sill height
    while the far ones stand, exactly like the sims games; a toggle keeps every
    wall at full height.
  - **Floors**: up to three stories plus a basement, with a selector to choose
    which one you're building.
  - **Views**: flip between a bird's-eye plan view and the three-quarter
    perspective, with a 1 ft × 1 ft reference grid you can toggle, and a live
    floor-plan minimap of the storey you're building.
- **Real sun and moon** — pick a date and time and watch the light: NOAA solar
  position, twilight, stars at night, shadow-mapped sunlight through your
  window openings, and a phase-correct moon — including the pale daytime moon
  whenever it's genuinely above the horizon.
- **Interior design mode** is on the toolbar but disabled for now — furniture
  arrives in a later pass.

Selected pieces are editable after placement (dimensions, style, finish,
color) from the panel on the right, which lists everything you've placed by
category.

## Development

```
npm install
npm run dev            # http://localhost:5173
npm run build:single   # self-contained docs/index.html for GitHub Pages
```

Vite + TypeScript + three.js. No backend: homes live in localStorage and JSON
files.
