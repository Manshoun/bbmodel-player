import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleChannel, AnimationMixer } from '../src/animate.js';
import { evalMolang } from '../src/molang.js';

const kf = (time, x, interpolation = 'linear') => ({ time, interpolation, points: [[x, 0, 0]] });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('linear interpolation between two keyframes', () => {
  const kfs = [kf(0, 0), kf(1, 10)];
  close(sampleChannel(kfs, 0.5, { loop: 'once', length: 1 })[0], 5);
  close(sampleChannel(kfs, 0.25, { loop: 'once', length: 1 })[0], 2.5);
});

test('holds the last value after the end of a non-looping animation', () => {
  const kfs = [kf(0, 0), kf(1, 10)];
  close(sampleChannel(kfs, 3, { loop: 'once', length: 1 })[0], 10);
});

test('step keeps the previous value until the next keyframe', () => {
  const kfs = [kf(0, 0, 'step'), kf(1, 10)];
  close(sampleChannel(kfs, 0.99, { loop: 'once', length: 1 })[0], 0);
  close(sampleChannel(kfs, 1, { loop: 'once', length: 1 })[0], 10);
});

test('looping animations wrap from the last keyframe back to the first', () => {
  const kfs = [kf(0.5, 0), kf(1.5, 10)];
  const anim = { loop: 'loop', length: 2 };
  // between 1.5 (10) and 2.5 (= 0.5 of the next loop, 0)
  close(sampleChannel(kfs, 2.0 % 2, anim)[0], 5);
});

test('catmull-rom passes through its keyframes and is smooth in between', () => {
  const kfs = [kf(0, 0, 'catmullrom'), kf(1, 10, 'catmullrom'), kf(2, 0, 'catmullrom')];
  const anim = { loop: 'once', length: 2 };
  close(sampleChannel(kfs, 1, anim)[0], 10);
  const mid = sampleChannel(kfs, 0.5, anim)[0];
  assert.ok(mid > 5 && mid < 10, `curve should bulge above the straight line, got ${mid}`);
});

test('keyframes with two data points jump from pre to post value', () => {
  const kfs = [kf(0, 0), { time: 1, interpolation: 'linear', points: [[10, 0, 0], [-10, 0, 0]] }, kf(2, -10)];
  const anim = { loop: 'once', length: 2 };
  close(sampleChannel(kfs, 0.5, anim)[0], 5);     // towards the pre value
  close(sampleChannel(kfs, 1.5, anim)[0], -10);   // continues from the post value
});

test('Molang values are evaluated at the sample time', () => {
  const kfs = [{ time: 0, interpolation: 'linear', points: [['math.sin(q.anim_time * 90) * 4', 0, 0]] }];
  close(sampleChannel(kfs, 1, { loop: 'once', length: 2 })[0], 4);
});

test('Molang: arithmetic, math in degrees, ternary, variables', () => {
  close(evalMolang('1 + 2 * 3'), 7);
  close(evalMolang('math.cos(180)'), -1);
  close(evalMolang('query.anim_time > 1 ? 5 : -5', { anim_time: 2 }), 5);
  close(evalMolang('v.speed * 2', { variables: { speed: 3 } }), 6);
  close(evalMolang('this is not molang ('), 0);
});

function rig(...names) {
  const v = () => ({ x: 0, y: 0, z: 0 });
  return new Map(names.map((n) => [n, {
    position: v(), rotation: v(), scale: { x: 1, y: 1, z: 1 },
    rest: { position: v(), rotation: v(), scale: { x: 1, y: 1, z: 1 } },
  }]));
}
const channel = (rotation) => ({ rotation, position: [], scale: [] });

test('mixer: one-shot with override owns its bones, then hands back to the loop', () => {
  const model = {
    animations: [
      { name: 'idle', loop: 'loop', length: 1, override: false, animators: { arm: channel([kf(0, 10), kf(1, 10)]) } },
      { name: 'wave', loop: 'once', length: 0.5, override: true, animators: { arm: channel([kf(0, 90), kf(0.5, 90)]) } },
    ],
  };
  const r = rig('arm');
  const mixer = new AnimationMixer(model, r);
  mixer.play('idle');
  mixer.update(0.1);
  close(r.get('arm').rotation.x, (10 * Math.PI) / 180);

  let ended = null;
  mixer.playOnce('wave', { onEnd: (n) => (ended = n) });
  mixer.update(0.1);
  close(r.get('arm').rotation.x, (90 * Math.PI) / 180);   // not 100: override replaces the idle pose

  mixer.update(0.5);
  assert.equal(ended, 'wave');
  close(r.get('arm').rotation.x, (10 * Math.PI) / 180);
});
