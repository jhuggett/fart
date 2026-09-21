# space

`scenes/patrol.shart` places the set as a scene (a Scene Hierarchy of
Art): the station spinning with a fighter docked at its north socket, a
wing of three fighters as a turned group with a laser bolt hung from
the lead's gun, the cruiser with a missile on its muzzle, a pirate
raider recoloured by its palette, drones, a group of tumbling rocks, a
bobbing crate, an explosion mid-boom. Open it on the shelf, press play;
`npx fart flatten examples/space/scenes/patrol.shart --t 0.5` lists the
seventeen instances placed.

Hulls wear `textures/plating.fart` (seams and rivets over a 6 by 6 cell)
and rocks `textures/craters.fart`, laid on by the generator: textures are
drawings, tiled (format 1.5). Uranus paints them; a game gets the
pattern coordinates and rasterises the drawing itself, or takes the PNGs
from `fart bake --textures`.

A top-down space set, made to exercise the whole format. Open the folder
in the studio (or `make serve DIR=examples/space` for a browser) and it
is a project.

Ships point up: the nose is at negative y, and a game that flies them
adds its own heading.

| file | what it shows |
| --- | --- |
| `palettes/hull.fart` | the slots every file names: hull, trim, glass, flame, rock, ore… |
| `palettes/pirate.fart`, `palettes/alliance.fart` | the same slots in other colours: a swap, for `apply_palette` at load |
| `ships/fighter.fart` | wings and engines riding a hull, flames that come and go with the state, a throttled `thrust` loop, `bank_left`/`bank_right` with a back-out curve; the right engine is drawn `like` the left and mirrored, its flame riding along |
| `ships/cruiser.fart` | turrets parented to the hull with barrels parented to the turrets, muzzle anchors, a `sweep` that turns them |
| `ships/drone.fart` | a two-bone arm with a chain (`arm`, reaching with `arm_b/tip`), a pinned target in `reach_l`, a `grab` clip with a `grab` event |
| `structures/station.fart` | a ring that `spin`s with docks (and their anchors) riding it, a `blink` done with membership and `step` |
| `rocks/asteroid_*.fart` | lumpy polys with craters and ore, a slow `tumble` |
| `projectiles/laser.fart`, `projectiles/missile.fart` | small things with a `tip` anchor; the missile's flame flickers |
| `effects/explosion.fart` | `boom`: scale does the growing, membership ends the core |
| `pickups/crate.fart` | `bob`: an offset going up and down |

Every art file links `../palettes/hull.fart` and owns no colours of its
own, so recolouring the set is editing one file. To make the pirate
fleet, a game lays `pirate.fart` over any of them at load:

    red, _ := fastart.load_bytes(pirate_bytes)
    fastart.apply_palette(&fighter, red.palette[:])

Anchors are where a game hooks in: `nose`, `gun_l`/`gun_r`, `exhaust`,
`muzzle`, `tip`, `dock_n`… Query them through the part's world transform
and they follow the pose. Most carry a direction (`angle`), so attaching
a thing to them turns it the right way. `glow`, `flame` and `flame_core`
are emissive slots for games with lighting.

`generate.mjs` wrote these files (`node examples/space/generate.mjs`
from the repo root); edit them in the studio or regenerate, as you like.
