# Art direction as a file: a proposal

A primitive beside palettes: a small composable document that says what
the art of a project is like, so that every asset made after it, by a
hand or an agent, belongs with the others. Research notes first, then
the design. Not built; a proposal. The name used here, `.bart`, the
Bible of Art, is a placeholder in the family's spirit.

## What the field does

**Art bibles.** Studios keep a document that fixes what must stay
constant across every asset: the thematic statement, the palette with
roles, line and outline treatment, silhouette rules, proportion and
scale, perspective, light direction and shadow treatment, surface and
rendering treatment (flat, banded, textured), level-of-detail rules,
technical budgets (triangle counts, canvas sizes, naming), and a
do-not-do list ([template](https://blog.makko.ai/art-bible-game-development/)).
Two pieces of advice there matter most for a document an agent will
read: keep it short ("two to five pages" for a small game), and prefer
examples to rules: "a single finished, approved asset resolves more
ambiguity than five pages of prose", and "if a line cannot be checked
by looking at an asset and answering yes or no, it is not finished."

**Design tokens.** The W3C Design Tokens format
([2025.10](https://www.designtokens.org/tr/drafts/format/)) is the
industry's JSON for design decisions: a token is `{"$value", "$type",
"$description"}`, groups nest and pass `$type` down, tokens alias each
other with `{group.token}`, composites (shadow, typography, border,
transition) are built from primitives, and themes are sets laid over a
base. It is the structural model to borrow: named, typed values, aliases
between them, groups, and layering. Our palette files are design tokens
for colour already.

**Context for agents.** The patterns that work for giving a model
standing context are the ones this repository already uses: a short
always-loaded core and longer references disclosed when needed
(skills), and project files that state conventions once (CLAUDE.md). An
art direction file is the same idea aimed at art: the project states its
look once, the agent reads it before drawing.

**No animation format has this.** Lottie, Rive and Spine carry assets,
never the direction behind them. The closest things are design systems
on the UI side, which is why the token format is the right borrow.

## The design

A `.bart` is JSON, small, and composable the way palettes are: a project
has one at its root, a set may have another that `extends` it, and an
asset may name the direction it follows.

```json
{
  "version": 1,
  "name": "harbour",
  "extends": ["../base.bart"],
  "about": "A cold harbour town at dusk: heavy shapes, few colours, one warm light in every scene.",
  "palette_refs": ["palettes/town.fart"],
  "roles": {"outline": "ink", "skin": "pale", "danger": "ember", "ground": "slate"},
  "scale": {"unit": "a tenth of a metre", "sizes": {"character": [12, 20], "prop": [4, 30], "building": [60, 200]}},
  "line": {"outline": 0.6, "where": "every closed shape; never inside a face"},
  "shapes": {"kinds": ["poly", "path", "circle"], "corners": "rounded by 0.5 on buildings, sharp on tools", "budget": {"character": 60, "prop": 30}},
  "light": {"light": [-1, -2, -3], "ambient": 0.4, "bands": 3, "shade": "one band darker on the side away from the light"},
  "motion": {"ease": "in-out", "idle": [0.8, 1.6], "names": ["idle", "walk", "hit", "die"]},
  "names": {"parts": "snake_case, left and right as _l and _r", "states": "a verb or a mood, never a number"},
  "references": [
    {"file": "ships/fighter.fart", "for": "the standard ship: its proportions, its outline, its thrust clip"},
    {"file": "props/crate.fart", "for": "how little a prop needs"}
  ],
  "rules": [
    {"say": "every asset links the town palette", "check": "palette_refs includes palettes/town.fart"},
    {"say": "no asset has more than three colours of its own", "check": "palette.length <= 3"},
    {"say": "characters stay under sixty shapes", "check": "shapes(character) <= 60"},
    {"say": "nothing is pure black; outlines are ink", "check": "no token with rgb [0,0,0,*]"}
  ],
  "avoid": ["gradients", "pure black", "a second light", "clips longer than two seconds"]
}
```

- **`about`** is the thematic statement, one paragraph: the only prose
  an agent needs every time.
- **`palette_refs` and `roles`** make colour a vocabulary: a role names
  the token an asset should use for a job, so "outline" is `ink` here
  and may be `char` in another project. New assets inherit the refs.
- **`scale`, `line`, `shapes`, `light`, `motion`, `names`** are the
  art-bible sections that have a number in them. Each is a default a
  new asset starts from (the studio's new-file dialog and `fart new`
  fill them in) and a thing a linter can check.
- **`references`** point at finished assets with a note on what to
  copy from each: the "one approved asset" rule, made explicit, and the
  cheapest context there is, since the agent can open exactly the file
  it needs.
- **`rules`** are yes-or-no, each with a `check` the linter runs; the
  `say` is for people and agents. Rules without a check are allowed,
  and are advice.
- **`avoid`** is the do-not-do list.
- **`extends`** layers directions the way the token format layers
  themes: later keys win, lists append, rules accumulate. A `classes`
  block (`{"character": {...}, "prop": {...}}`) overrides by asset
  class; an asset says which class it is in `meta.class`, or the folder
  name says it.

## Who reads it

- **Agents.** The skill's workflow gains a first step: read the
  project's `.bart` (the app's `get_direction` tool returns it merged,
  with `extends` resolved, a few hundred tokens). New assets take their
  palette refs, light, line and naming from it; references are opened
  as needed. The thematic statement goes into the app's chat system
  prompt, so Ask Claude designs in the project's voice without being
  told each time.
- **The validator.** `fart lint` (or `fart validate --direction`)
  runs the `check` of every rule and the numeric sections (budgets,
  line widths, token roles, names, clip lengths) and reports
  `direction.*` warnings: advisory, never a refusal, since direction is
  taste and the format is the contract.
- **Uranus.** With nothing open, the inspector shows the direction:
  the statement, the roles as swatches, the references as thumbnails
  that open on click. A new asset starts with the direction's defaults.
  Each asset's row and the project bar carry a quiet badge when a rule
  is broken. A **Direction** editor is the same inspector in edit mode;
  no new screen.
- **Generators.** `@fastart/make` reads the direction too, so
  `make.doc("character")` comes out with the right refs, light and
  names, and a generator that breaks a rule says so when it writes.

## What to keep out

- Prose beyond the statement and the notes on references. Everything
  else has a number or a list, so it can be checked and so it stays
  short; the art bible advice and the token format agree on this.
- Images. References are `.fart` files in the project, which the agent
  can read and the studio can draw; a mood board of PNGs is for people
  and lives beside the file, not in it.
- Rendering intent the format cannot express. A direction may say
  "three bands of shade" because `shade` exists; it may not ask for a
  bloom.

## Open questions

- The name. `.bart` keeps the family joke; `direction.json` is plainer.
- Whether `check` is a tiny expression language (as sketched) or a
  fixed list of named checks with arguments. The fixed list is safer
  and is what a validator can promise; start there.
- Whether a `.shart` scene should carry a direction of its own
  (atmosphere per scene) or only the project's. Probably only the
  project's, with `classes` for the rest.

## Sequence

1. The format: `spec/DIRECTION.md` as contract, `bart.schema.json`,
   two corpus cases, a merge in core, `get_direction` in Uranus, the
   skill's first step. Small.
2. `fart lint` with the fixed checks, and the badge in Uranus.
3. The inspector's Direction view and new-asset defaults; generators
   reading it.
