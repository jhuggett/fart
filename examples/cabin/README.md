# examples/cabin

A sample project for textures (format 1.5): every texture is a drawing
of the project, tiled.

    textures/planks.fart     boards and gaps over an 8 by 8 cell, a knots state
    textures/cobbles.fart    stones on mortar over a 6 by 6 cell
    palettes/height.fart     the planks drawing as a height map (greys)
    palettes/stone_height.fart
    crate.fart               a 3D box, box mapped with planks; a lid with explicit uvs
    cabin.fart               the hut from the corpus, walls in planks, floor in cobbles, posed collision
    floor.fart               a 2D poly and circle filled with planks, placed and turned

`camp.shart` is a 3D scene: the cabin open, a lantern hung from the
lamp's socket (swinging), two crates stacked inside, the pistol lying on
the table mid-cock, and a yard of crates. Open the `examples` folder in
Uranus (the scene reaches into `../lantern` and `../pistol`).

Ways to see it:

    make serve DIR=examples                    # Uranus in a browser: cabin/camp.shart opens the scene screen; crate and cabin the model screen
    npx fart validate examples/cabin           # refs resolve, maps read
    npx fart bake --textures /tmp/cabin --px 128 examples/cabin/cabin.fart   # the maps as PNGs
    npx fart project examples/cabin/cabin.fart --view left --view top       # 2D views; textured faces carry a mapping
    npx fart gltf examples/cabin/crate.fart    # a .glb with the colour map embedded (Blender, three.js)
    odin run loaders/odin/examples/raylib_spin -- examples/cabin/crate.fart # textured in raylib
