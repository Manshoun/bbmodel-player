# bbmodel-player

Play Blockbench `.bbmodel` files (the model and its animations) on any website.
One script tag, one HTML element. No build step, no conversion, no server code.

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/bbmodel-player/dist/bbmodel-player.js"></script>

<bbmodel-player src="knight.bbmodel" animation="idle" controls></bbmodel-player>
```

The model renders with Minecraft style shading and sharp pixel textures and loops its idle animation.
With `controls` visitors can switch animations, pause, change the speed and reset the view.

[Demo](https://manshoun.github.io/bbmodel-player/): drop any `.bbmodel` onto the page, it stays in your browser.

## Why

Most Minecraft models (entities, NPCs, furniture, items) are made in Blockbench. To show them on a website
you usually need screenshots, GIFs or videos. bbmodel-player reads the project file directly, so you get
the actual model: you can turn it, it moves, and it stays sharp at any size.

Useful for model shops, portfolios, plugin and mod pages, server websites and wikis.

## Install

From a CDN (three.js included, about 130 KB gzipped):

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/bbmodel-player/dist/bbmodel-player.js"></script>
```

There is also a classic script build, `dist/bbmodel-player.iife.js`, which exposes `window.BBModelPlayerLib`.

From npm, using your own three.js (about 13 KB gzipped):

```sh
npm install bbmodel-player three
```

```js
import 'bbmodel-player'; // registers <bbmodel-player>
```

## The element

```html
<bbmodel-player
  src="models/blacksmith.bbmodel"
  animation="idle"
  controls
  auto-rotate
  background="#1b1f24"
  style="width: 400px; height: 500px"></bbmodel-player>
```

| Attribute     | Description |
|---------------|-------------|
| `src`         | URL of the `.bbmodel` file. Changing it loads the new model. |
| `animation`   | Animation to start with. Defaults to `idle`, otherwise the first looping animation. |
| `controls`    | Show the control bar (animation picker, pause, speed, reset view). |
| `auto-rotate` | Slowly turn the model. |
| `background`  | Any CSS color. Transparent by default. |
| `view`        | Camera start position: `front` (default), `back`, `left`, `right`, `top`. |
| `zoom`        | `click` (default): the mouse wheel only zooms after a click into the player, so the page still scrolls normally. Or `always` / `none`. |
| `static`      | No mouse interaction at all. Good for galleries and thumbnails. |
| `speed`       | Playback speed, default `1`. |

Size it like any block element (default 300 x 380 px). Players that are scrolled out of view stop
rendering, so pages with lots of them stay fast.

Methods:

- `load(source)` loads a URL, a `File`/`Blob` or parsed JSON
- `play(name)` starts an animation (loops become the base, everything else plays once on top)
- `playOnce(name)`, `pause()`, `resume()`
- `screenshot()` returns a PNG data URL

The `animations` property lists the animation names.

Events: `load` (`detail.animations`), `error`, `animationstart` (`detail.name`, `detail.loop`), `animationend` (`detail.name`).

```js
const el = document.querySelector('bbmodel-player');
el.addEventListener('load', (e) => console.log(e.detail.animations));
el.play('wave');
```

The control bar can be styled with `--bbmp-accent`, `--bbmp-bar-bg` and `--bbmp-text`, or through
`::part(controls)`, `::part(stage)` and `::part(message)`.

### Looping and one-shot animations

Animations set to *loop* in Blockbench become the base animation. Animations set to *play once* run
on top of it and hand back to the base when they end, so an NPC can wave while it keeps breathing.
*Hold* animations stay on their last frame until something else is picked. A one-shot with *Override*
enabled replaces the base on every bone it animates.

## JavaScript API

```js
import { BBModelPlayer } from 'bbmodel-player';

const player = new BBModelPlayer(document.querySelector('#stage'), { autoRotate: true });
await player.load('knight.bbmodel'); // URL, File/Blob, parsed JSON or JSON text
player.play('walk');                 // looping base animation
player.playOnce('attack');           // one-shot on top, then back to walk
player.speed = 0.5;
player.frame('left');                // move the camera
```

Options: `background`, `autoRotate`, `controls` (orbit), `zoom` (`true`, `false` or `'click'`),
`view`, `pixelRatio`, `antialias`, `preserveDrawingBuffer`.

The lower level parts are exported as well if you want to use your own scene:

| Export | |
|--------|---|
| `parseBBModel(json)` | `.bbmodel` to a plain object (bones, cubes, textures, animations). No three.js, works in Node. |
| `buildModel(parsed, { textureBase })` | Plain object to a three.js `Group` plus a rig for animation. |
| `AnimationMixer` | Base loop plus one-shot overlays on that rig. |
| `sampleChannel`, `evalMolang` | Keyframe sampling and the Molang evaluator. |

## Supported

- Generic, Bedrock entity, Modded entity and GeckoLib projects, `.bbmodel` format 4 and 5
- Cubes with per-face UV or box UV (mirrored too), face rotation, inflate, cube and bone rotation
- Embedded textures, textures next to the model file, multiple textures, per-texture UV size
- Rotation, position and scale keyframes with linear, catmull-rom, step and bezier interpolation,
  keyframes with two data points, loop / once / hold
- Molang in keyframes (`math.*`, `query.anim_time`, `query.life_time`, variables)
- Bones named `glow_*` render full bright, bones named `hitbox` or `shadow` are hidden

Pivots and interpolation use the same math as the Blockbench preview, so models look and move like they do in the editor.

Not supported yet: mesh elements, locators and null objects, particle and sound keyframes, animated textures.
Pull requests are welcome.

## Development

```sh
npm install
npm run dev   # rebuilds dist/ and docs/lib/ on change
npm test
```

Serve `docs/` with any static server to work on the demo page.

## License

MIT. Renders with [three.js](https://threejs.org) (MIT). Not affiliated with Blockbench or Mojang.
