// keyframe sampling (same math as the blockbench preview) and a small mixer:
// one looping base animation plus one-shot overlays on top
import { evalMolang } from './molang.js';

const EPSILON = 1 / 1200;

function value(kf, axis, point, time, ctx) {
  const p = kf.points[Math.min(point, kf.points.length - 1)];
  const v = p[axis];
  return typeof v === 'number' ? v : evalMolang(v, { ...ctx, anim_time: time });
}

// same as three's SplineCurve.getPoint(t).y, blockbench uses that for catmullrom
function splineY(ys, t) {
  const p = (ys.length - 1) * t;
  const i = Math.floor(p);
  const w = p - i;
  const p0 = ys[i === 0 ? i : i - 1];
  const p1 = ys[i];
  const p2 = ys[i > ys.length - 2 ? ys.length - 1 : i + 1];
  const p3 = ys[i > ys.length - 3 ? ys.length - 1 : i + 2];
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = w * w;
  const t3 = w * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * w + p1;
}

function bezierY(x0, y0, x1, y1, x2, y2, x3, y3, x) {
  // blockbench samples 200 points and takes the closest one
  let best = y0;
  let diff = Infinity;
  for (let i = 0; i <= 200; i++) {
    const t = i / 200, u = 1 - t;
    const px = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
    const d = Math.abs(px - x);
    if (d < diff) {
      diff = d;
      best = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
    }
  }
  return best;
}

/**
 * Value of a channel at `time` (seconds), null if it has no keyframes.
 * kfs must be sorted by time, anim is { loop, length }.
 */
export function sampleChannel(kfs, time, anim, ctx = {}) {
  if (!kfs || !kfs.length) return null;
  let before = null, after = null, beforeTime = 0, afterTime = 0;
  for (const kf of kfs) {
    if (kf.time < time) {
      if (!before || kf.time > beforeTime) {
        before = kf;
        beforeTime = kf.time;
      }
    } else if (!after || kf.time < afterTime) {
      after = kf;
      afterTime = kf.time;
    }
  }
  if (anim.loop === 'loop' && kfs.length >= 2) {   // wrap around
    if (!before) {
      before = kfs[kfs.length - 1];
      beforeTime = before.time - anim.length;
    }
    if (!after) {
      after = kfs[0];
      afterTime = after.time + anim.length;
    }
  }
  const pick = (kf, point) => [0, 1, 2].map((a) => value(kf, a, point, time, ctx));
  if (before && Math.abs(beforeTime - time) < EPSILON) return pick(before, 1);
  if (after && Math.abs(afterTime - time) < EPSILON) return pick(after, 0);
  if (before && before.interpolation === 'step') return pick(before, 1);
  if (before && !after) return pick(before, 1);
  if (after && !before) return pick(after, 0);

  const alpha = (time - beforeTime) / (afterTime - beforeTime || 1);
  const ip0 = before.interpolation, ip1 = after.interpolation;

  if (ip0 === 'linear' && (ip1 === 'linear' || ip1 === 'step')) {
    return [0, 1, 2].map((a) => {
      const v0 = value(before, a, 1, time, ctx), v1 = value(after, a, 0, time, ctx);
      return v0 + (v1 - v0) * alpha;
    });
  }
  if (ip0 === 'catmullrom' || ip1 === 'catmullrom') {
    const idx = kfs.indexOf(before);
    let beforePlus = kfs[idx - 1];
    let afterPlus = kfs[idx + 2];
    if (anim.loop === 'loop' && kfs.length >= 3) {
      if (!beforePlus) beforePlus = kfs[kfs.length - 2];
      if (!afterPlus) afterPlus = kfs[1];
    }
    return [0, 1, 2].map((a) => {
      const ys = [];
      const usePlusBefore = beforePlus && before.points.length === 1;
      if (usePlusBefore) ys.push(value(beforePlus, a, 1, time, ctx));
      ys.push(value(before, a, 1, time, ctx));
      ys.push(value(after, a, 0, time, ctx));
      if (afterPlus && after.points.length === 1) ys.push(value(afterPlus, a, 0, time, ctx));
      return splineY(ys, (alpha + (usePlusBefore ? 1 : 0)) / (ys.length - 1));
    });
  }
  if (ip0 === 'bezier' || ip1 === 'bezier') {
    const gap = afterTime - beforeTime;
    return [0, 1, 2].map((a) => {
      const v0 = value(before, a, 1, time, ctx), v1 = value(after, a, 0, time, ctx);
      const hb = Math.min(Math.max(before.bezier.rightTime[a] || 0, 0), gap);
      const ha = Math.min(Math.max(after.bezier.leftTime[a] || 0, -gap), 0);
      return bezierY(beforeTime, v0, beforeTime + hb, v0 + (before.bezier.rightValue[a] || 0),
        afterTime + ha, v1 + (after.bezier.leftValue[a] || 0), afterTime, v1, time);
    });
  }
  return [0, 1, 2].map((a) => {
    const v0 = value(before, a, 1, time, ctx), v1 = value(after, a, 0, time, ctx);
    return v0 + (v1 - v0) * alpha;
  });
}

/**
 * rig: Map<boneName, { position, rotation, scale, rest }>
 * rotation gets added to the rest rotation, position is added too, scale multiplies
 */
export class AnimationMixer {
  constructor(model, rig) {
    this.model = model;
    this.rig = rig;
    this.byName = new Map(model.animations.map((a) => [a.name, a]));
    this.base = null;       // { anim, time, speed }
    this.overlays = [];     // [{ anim, time, speed, onEnd }]
    this.lifeTime = 0;
    this.paused = false;
    this.speed = 1;
  }

  get names() {
    return [...this.byName.keys()];
  }

  play(name, { speed = 1, restart = true } = {}) {
    const anim = this.byName.get(name);
    if (!anim) return false;
    if (!restart && this.base?.anim === anim) return true;
    this.base = { anim, time: 0, speed };
    return true;
  }

  // overlays with override=true replace the base on the bones they animate
  playOnce(name, { speed = 1, onEnd } = {}) {
    const anim = this.byName.get(name);
    if (!anim) return false;
    this.overlays = this.overlays.filter((o) => o.anim !== anim);
    this.overlays.push({ anim, time: 0, speed, onEnd });
    return true;
  }

  stop(name) {
    if (!name) {
      this.base = null;
      this.overlays = [];
    } else {
      if (this.base?.anim.name === name) this.base = null;
      this.overlays = this.overlays.filter((o) => o.anim.name !== name);
    }
    this.apply();
  }

  update(dt) {
    if (!this.paused) {
      const step = dt * this.speed;
      this.lifeTime += step;
      if (this.base) this.base.time = advance(this.base.anim, this.base.time + step * this.base.speed);
      const ended = [];
      for (const o of this.overlays) {
        const t = o.time + step * o.speed;
        if (o.anim.loop === 'once' && t >= o.anim.length) ended.push(o);
        o.time = advance(o.anim, t);
      }
      if (ended.length) {
        this.overlays = this.overlays.filter((o) => !ended.includes(o));
        for (const o of ended) o.onEnd?.(o.anim.name);
      }
    }
    this.apply();
  }

  apply() {
    for (const b of this.rig.values()) reset(b);
    const ctx = { life_time: this.lifeTime };
    if (this.base) this.applyAnim(this.base.anim, this.base.time, ctx, false);
    for (const o of this.overlays) this.applyAnim(o.anim, o.time, ctx, o.anim.override);
  }

  applyAnim(anim, time, ctx, override) {
    for (const [boneName, ch] of Object.entries(anim.animators)) {
      const b = this.rig.get(boneName);
      if (!b) continue;
      if (override) reset(b);
      const r = sampleChannel(ch.rotation, time, anim, ctx);
      if (r) {
        b.rotation.x += r[0] * DEG;
        b.rotation.y += r[1] * DEG;
        b.rotation.z += r[2] * DEG;
      }
      const p = sampleChannel(ch.position, time, anim, ctx);
      if (p) {
        b.position.x += p[0];
        b.position.y += p[1];
        b.position.z += p[2];
      }
      const s = sampleChannel(ch.scale, time, anim, ctx);
      if (s) {
        b.scale.x *= s[0] || 0.00001;
        b.scale.y *= s[1] || 0.00001;
        b.scale.z *= s[2] || 0.00001;
      }
    }
  }
}

const DEG = Math.PI / 180;

function advance(anim, t) {
  if (anim.length <= 0) return 0;
  if (anim.loop === 'loop') return t % anim.length;
  return Math.min(t, anim.length);
}

function reset(b) {
  b.position.x = b.rest.position.x;
  b.position.y = b.rest.position.y;
  b.position.z = b.rest.position.z;
  b.rotation.x = b.rest.rotation.x;
  b.rotation.y = b.rest.rotation.y;
  b.rotation.z = b.rest.rotation.z;
  b.scale.x = b.rest.scale.x;
  b.scale.y = b.rest.scale.y;
  b.scale.z = b.rest.scale.z;
}
