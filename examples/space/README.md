# space

A top-down space set, made to exercise the whole format. Open the folder
in the studio (or `make serve DIR=examples/space` for a browser) and it
is a project.

Ships point up: the nose is at negative y, and a game that flies them
adds its own heading.

| file | what it shows |
| --- | --- |
| `palettes/hull.fart` | the slots every file names: hull, trim, glass, flame, rock, ore… |
| `palettes/pirate.fart`, `palettes/alliance.fart` | the same slots in other colours: a swap, for `apply_palette` at load |
| `ships/fighter.fart` | wings and engines riding a hull, flames that come and go with the state, a throttled `thrust` loop, `bank_left`/`bank_right` |
| `ships/cruiser.fart` | turrets parented to the hull with barrels parented to the turrets, muzzle anchors, a `sweep` that turns them |
| `ships/drone.fart` | a two-bone arm with a chain (`arm`, reaching with `arm_b/tip`) and a `grab` clip |
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

Anchors are where a game hooks in: `nose`, `gun_l`/`gun_r`, `exhaust_*`,
`muzzle`, `tip`, `dock_n`… Query them through the part's world transform
and they follow the pose.

`generate.mjs` wrote these files (`node examples/space/generate.mjs`
from the repo root); edit them in the studio or regenerate, as you like.
