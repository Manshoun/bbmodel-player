/**
 * <bbmodel-player src="model.bbmodel" animation="idle" controls auto-rotate></bbmodel-player>
 *
 * Attributes
 *   src          URL of the .bbmodel file
 *   animation    base animation to loop (default: "idle", else the first looping animation)
 *   controls     show the control bar (animation picker, pause, speed, reset view)
 *   auto-rotate  slowly turn the model
 *   background   CSS color, default transparent
 *   view         front | back | left | right | top (camera start position)
 *   zoom         "click" (default: wheel zooms only after clicking into the player), "always" or "none"
 *   no-zoom      same as zoom="none"
 *   static       no mouse interaction at all
 *   speed        playback speed, default 1
 *
 * Methods: load(src|File|object), play(name), playOnce(name), pause(), resume(), screenshot()
 * Events:  load, error, animationstart, animationend
 * Styling: set width/height on the element; --bbmp-accent, --bbmp-bar-bg, --bbmp-text for the control bar.
 */
import { BBModelPlayer } from './player.js';

const STYLE = `
  :host { display: block; position: relative; width: 300px; height: 380px; contain: content;
          --bbmp-accent: #7fd36b; --bbmp-bar-bg: rgba(16, 18, 22, .78); --bbmp-text: #e9ecef; }
  :host([hidden]) { display: none; }
  .stage { position: absolute; inset: 0; }
  .msg { position: absolute; inset: 0; display: grid; place-items: center; font: 13px/1.4 system-ui, sans-serif;
         color: var(--bbmp-text); opacity: .7; pointer-events: none; text-align: center; padding: 1em; }
  .bar { position: absolute; left: 8px; right: 8px; bottom: 8px; display: flex; gap: 6px; align-items: center;
         padding: 6px; border-radius: 8px; background: var(--bbmp-bar-bg); color: var(--bbmp-text);
         font: 12px/1 system-ui, sans-serif; backdrop-filter: blur(4px); }
  .bar[hidden] { display: none; }
  select, button { font: inherit; color: inherit; background: rgba(255, 255, 255, .08); border: 1px solid rgba(255, 255, 255, .14);
                   border-radius: 6px; padding: 5px 7px; cursor: pointer; }
  select { flex: 1; min-width: 0; }
  select option { color: #111; }
  button:hover, select:hover { border-color: var(--bbmp-accent); }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--bbmp-accent); outline-offset: 1px; }
`;

export class BBModelPlayerElement extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'animation', 'auto-rotate', 'background', 'controls', 'speed', 'view', 'zoom', 'no-zoom', 'static'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="stage" part="stage"></div>
      <div class="msg" part="message"></div>
      <div class="bar" part="controls" hidden>
        <select aria-label="Animation"></select>
        <button class="pause" type="button" aria-label="Pause">❚❚</button>
        <button class="speed" type="button" aria-label="Playback speed">1x</button>
        <button class="reset" type="button" aria-label="Reset view">⟲</button>
      </div>`;
    this.$stage = root.querySelector('.stage');
    this.$msg = root.querySelector('.msg');
    this.$bar = root.querySelector('.bar');
    this.$select = root.querySelector('select');
    this.$pause = root.querySelector('.pause');
    this.$speed = root.querySelector('.speed');
    this.$reset = root.querySelector('.reset');
    this.player = null;
    this._loading = 0;

    this.$select.addEventListener('change', () => this._choose(this.$select.value));
    this.$pause.addEventListener('click', () => (this.player?.paused ? this.resume() : this.pause()));
    this.$speed.addEventListener('click', () => {
      const steps = [1, 0.5, 0.25, 2];
      const next = steps[(steps.indexOf(this.player?.speed ?? 1) + 1) % steps.length];
      this.setAttribute('speed', String(next));
    });
    this.$reset.addEventListener('click', () => {
      if (!this.player) return;
      this.player._userMoved = false;
      this.player.frame(this.getAttribute('view') || 'front');
    });
  }

  connectedCallback() {
    if (!this.player) {
      this.player = new BBModelPlayer(this.$stage, {
        background: this.getAttribute('background'),
        autoRotate: this.hasAttribute('auto-rotate'),
        controls: !this.hasAttribute('static'),
        zoom: this._zoomMode(),
        view: this.getAttribute('view') || 'front',
      });
      this.player.addEventListener('animationend', (e) => {
        const base = this.player?.mixer?.base?.anim.name;
        if (base) this.$select.value = base;
        this.dispatchEvent(new CustomEvent('animationend', { detail: e.detail }));
      });
    }
    this.$bar.hidden = !this.hasAttribute('controls');
    if (this.getAttribute('src') && !this.player.model) this.load(this.getAttribute('src'));
  }

  disconnectedCallback() {
    // keep the player alive while the element is only moved in the DOM
    queueMicrotask(() => {
      if (!this.isConnected && this.player) {
        this.player.dispose();
        this.player = null;
      }
    });
  }

  attributeChangedCallback(name, oldValue, value) {
    if (!this.player || oldValue === value) return;
    switch (name) {
      case 'src':
        if (value) this.load(value);
        break;
      case 'animation':
        if (value) this._choose(value);
        break;
      case 'auto-rotate':
        this.player.setAutoRotate(value !== null);
        break;
      case 'background':
        this.player.setBackground(value);
        break;
      case 'controls':
        this.$bar.hidden = value === null;
        break;
      case 'speed':
        this.player.speed = Number(value) || 1;
        this.$speed.textContent = `${this.player.speed}x`;
        break;
      case 'view':
        this.player.frame(value || 'front');
        break;
      case 'zoom':
      case 'no-zoom':
        this.player.setZoom(this._zoomMode());
        break;
      case 'static':
        this.player.orbit.enabled = value === null;
        break;
    }
  }

  async load(source) {
    const ticket = ++this._loading;
    this.$msg.textContent = 'Loading...';
    try {
      const names = await this.player.load(source);
      if (ticket !== this._loading) return names;
      this.$msg.textContent = '';
      this._fillSelect(names);
      const wanted = this.getAttribute('animation');
      const base = (wanted && names.includes(wanted) && wanted)
        || (names.includes('idle') && 'idle')
        || this.player.model.animations.find((a) => a.loop === 'loop')?.name;
      if (base) this._choose(base);
      if (this.hasAttribute('speed')) this.player.speed = Number(this.getAttribute('speed')) || 1;
      this.dispatchEvent(new CustomEvent('load', { detail: { name: this.player.model.name, animations: names } }));
      return names;
    } catch (err) {
      if (ticket === this._loading) {
        this.$msg.textContent = `Could not load model: ${err.message}`;
        this.dispatchEvent(new CustomEvent('error', { detail: err }));
      }
      throw err;
    }
  }

  play(name) {
    return this._choose(name);
  }

  playOnce(name) {
    return this.player?.playOnce(name);
  }

  pause() {
    this.player?.pause();
    this.$pause.textContent = '▶';
    this.$pause.setAttribute('aria-label', 'Play');
  }

  resume() {
    this.player?.resume();
    this.$pause.textContent = '❚❚';
    this.$pause.setAttribute('aria-label', 'Pause');
  }

  screenshot() {
    return this.player?.screenshot();
  }

  get animations() {
    return this.player?.animations || [];
  }

  _zoomMode() {
    if (this.hasAttribute('no-zoom')) return false;
    const z = this.getAttribute('zoom');
    return z === 'always' ? true : z === 'none' ? false : 'click';
  }

  // loops become the base, everything else plays once on top
  _choose(name) {
    const anim = this.player?.model?.animations.find((a) => a.name === name);
    if (!anim) return false;
    // hold animations never end, so release them when something else is picked
    for (const o of this.player.mixer.overlays) if (o.anim.loop === 'hold' && o.anim !== anim) this.player.stop(o.anim.name);
    if (anim.loop === 'loop') this.player.play(name);
    else this.player.playOnce(name);
    this.$select.value = name;
    this.dispatchEvent(new CustomEvent('animationstart', { detail: { name, loop: anim.loop } }));
    return true;
  }

  _fillSelect(names) {
    this.$select.replaceChildren(...names.map((n) => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      return o;
    }));
    this.$select.disabled = !names.length;
  }
}

export function defineElement(tag = 'bbmodel-player') {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) customElements.define(tag, BBModelPlayerElement);
}
