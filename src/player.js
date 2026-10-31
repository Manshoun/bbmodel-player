/**
 *   const player = new BBModelPlayer(document.querySelector('#stage'));
 *   await player.load('models/knight.bbmodel');
 *   player.play('idle');
 *   player.playOnce('wave');
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { parseBBModel } from './parse.js';
import { buildModel } from './build.js';
import { AnimationMixer } from './animate.js';

const UNIT = 1 / 16;   // 16 Blockbench pixels = 1 block = 1 three.js unit

const VIEWS = {
  // models face north (-Z); "front" looks at their face from slightly right and above
  front: new THREE.Vector3(0.55, 0.35, -1),
  back: new THREE.Vector3(-0.55, 0.35, 1),
  left: new THREE.Vector3(-1, 0.3, -0.2),
  right: new THREE.Vector3(1, 0.3, -0.2),
  top: new THREE.Vector3(0.01, 1, -0.01),
};

export class BBModelPlayer extends EventTarget {
  /**
   * @param {HTMLElement} container element to render into (canvas fills it)
   * @param {object} options { background, autoRotate, controls (orbit), view, pixelRatio, antialias,
   *   zoom: true | false | 'click' (default, wheel only zooms after a click into the player) }
   */
  constructor(container, options = {}) {
    super();
    this.container = container;
    this.options = { background: null, autoRotate: false, controls: true, zoom: 'click', view: 'front', ...options };
    this.renderer = new THREE.WebGLRenderer({ antialias: options.antialias ?? true, alpha: true, preserveDrawingBuffer: !!options.preserveDrawingBuffer });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.pixelRatio ?? 2));
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.setBackground(this.options.background);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 500);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.enablePan = false;
    this.orbit.enabled = this.options.controls;
    this.orbit.autoRotate = this.options.autoRotate;
    this.orbit.autoRotateSpeed = 1.5;
    this.setZoom(this.options.zoom);
    this._userMoved = false;   // re-frame on resize until the user moves the camera
    this.orbit.addEventListener('start', () => (this._userMoved = true));

    this.model = null;
    this.built = null;
    this.mixer = null;
    this.clock = new THREE.Clock();
    this.visible = true;
    this._raf = 0;

    this._resize = new ResizeObserver(() => this.resize());
    this._resize.observe(container);
    // only animate players that are on screen
    this._io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible) this._loop();
    });
    this._io.observe(container);
    this.resize();
    this._loop();
  }

  /**
   * Load a model. source: URL string, File/Blob, already-parsed JSON object or JSON text.
   * @returns {Promise<string[]>} animation names
   */
  async load(source, { textureBase } = {}) {
    let json, base = textureBase;
    if (typeof source === 'string' && !source.trimStart().startsWith('{')) {
      const url = new URL(source, document.baseURI).href;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load ${source} (${res.status})`);
      json = await res.json();
      base = base || url;
    } else if (source instanceof Blob) {
      json = JSON.parse(await source.text());
    } else {
      json = typeof source === 'string' ? JSON.parse(source) : source;
    }
    const model = parseBBModel(json);
    const built = buildModel(model, { textureBase: base });
    await built.ready;

    this.clear();
    this.model = model;
    this.built = built;
    built.root.scale.setScalar(UNIT);
    this.scene.add(built.root);
    this.mixer = new AnimationMixer(model, built.rig);
    this.mixer.apply();
    this._userMoved = false;
    this.frame();
    this.dispatchEvent(new CustomEvent('load', { detail: { name: model.name, animations: this.animations } }));
    return this.animations;
  }

  /** names of all animations in the loaded model */
  get animations() {
    return this.mixer ? this.mixer.names : [];
  }

  /** play as the base animation (replaces the current one) */
  play(name, opts) {
    return !!this.mixer?.play(name, opts);
  }

  /** play once on top of the base animation, then return to it */
  playOnce(name, opts = {}) {
    return !!this.mixer?.playOnce(name, {
      ...opts,
      onEnd: (n) => {
        opts.onEnd?.(n);
        this.dispatchEvent(new CustomEvent('animationend', { detail: { name: n } }));
      },
    });
  }

  stop(name) {
    this.mixer?.stop(name);
  }

  pause() {
    if (this.mixer) this.mixer.paused = true;
  }

  resume() {
    if (this.mixer) this.mixer.paused = false;
  }

  get paused() {
    return !!this.mixer?.paused;
  }

  set speed(v) {
    if (this.mixer) this.mixer.speed = v;
  }

  get speed() {
    return this.mixer ? this.mixer.speed : 1;
  }

  setBackground(color) {
    this.scene.background = color && color !== 'transparent' ? new THREE.Color(color) : null;
  }

  setAutoRotate(on) {
    this.orbit.autoRotate = !!on;
  }

  // true, false or 'click'
  setZoom(mode) {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this._zoomOn);
    el.removeEventListener('pointerleave', this._zoomOff);
    if (mode === 'click') {
      this._zoomOn = () => (this.orbit.enableZoom = true);
      this._zoomOff = () => (this.orbit.enableZoom = false);
      el.addEventListener('pointerdown', this._zoomOn);
      el.addEventListener('pointerleave', this._zoomOff);
      this.orbit.enableZoom = false;
    } else {
      this.orbit.enableZoom = !!mode;
    }
  }

  /** Point the camera at the whole model. view: 'front' | 'back' | 'left' | 'right' | 'top' */
  frame(view = this.options.view) {
    if (!this.built) return;
    this.options.view = view;
    const box = new THREE.Box3().setFromObject(this.built.root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const aspect = this.container.clientWidth > 0 && this.container.clientHeight > 0 ? this.camera.aspect : 1;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const depth = Math.max(size.x, size.z);
    // fit height and width with some headroom for big moves
    const dist = Math.max((size.y * 0.5) / Math.tan(vfov / 2), (depth * 0.5) / Math.tan(hfov / 2)) * 1.45 + depth * 0.5;
    const dir = (VIEWS[view] || VIEWS.front).clone().normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.orbit.target.copy(center);
    this.orbit.minDistance = dist * 0.3;
    this.orbit.maxDistance = dist * 4;
    this.orbit.update();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this._userMoved) this.frame();
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** PNG data URL of the current frame */
  screenshot() {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  clear() {
    if (this.built) {
      this.scene.remove(this.built.root);
      this.built.dispose();
    }
    this.built = null;
    this.model = null;
    this.mixer = null;
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._resize.disconnect();
    this._io.disconnect();
    this.clear();
    this.orbit.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  _loop() {
    cancelAnimationFrame(this._raf);
    const tick = () => {
      if (!this.visible) return;
      this._raf = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this.mixer?.update(dt);
      this.orbit.update();
      this.render();
    };
    this.clock.getDelta();
    this._raf = requestAnimationFrame(tick);
  }
}
