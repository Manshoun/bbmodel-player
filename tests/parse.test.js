import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBBModel } from '../src/parse.js';

const cube = (uuid, extra = {}) => ({
  uuid, name: uuid, type: 'cube', from: [0, 0, 0], to: [4, 8, 2], origin: [0, 0, 0],
  faces: Object.fromEntries(['north', 'east', 'south', 'west', 'up', 'down'].map((f) => [f, { uv: [0, 0, 4, 8], texture: 0 }])),
  ...extra,
});

test('format 5: group data lives in "groups", the outliner only holds uuids', () => {
  const m = parseBBModel({
    meta: { format_version: '5.0', model_format: 'free' },
    resolution: { width: 32, height: 32 },
    textures: [{ uuid: 't0', name: 'skin.png' }],
    elements: [cube('c1'), cube('c2')],
    groups: [
      { uuid: 'g1', name: 'body', origin: [0, 12, 0] },
      { uuid: 'g2', name: 'head', origin: [0, 24, 0], rotation: [0, 0, 5] },
    ],
    outliner: [{ uuid: 'g1', children: ['c1', { uuid: 'g2', children: ['c2'] }] }],
  });
  assert.deepEqual(m.bones.map((b) => b.name), ['body', 'head']);
  assert.equal(m.bones[1].parent, 'g1');
  assert.deepEqual(m.bones[1].rotation, [0, 0, 5]);
  assert.equal(m.bones[0].cubes[0].uuid, 'c1');
  assert.equal(m.bones[1].cubes[0].uuid, 'c2');
  assert.equal(m.textures[0].uvWidth, 32);
});

test('format 4: full group objects inside the outliner', () => {
  const m = parseBBModel({
    meta: { format_version: '4.10' },
    elements: [cube('c1'), cube('loose')],
    outliner: [{ uuid: 'g1', name: 'arm', origin: [5, 22, 0], children: ['c1'] }],
  });
  assert.equal(m.bones[0].name, 'arm');
  assert.deepEqual(m.bones[0].origin, [5, 22, 0]);
  // cubes missing from the outliner still belong to the model
  assert.deepEqual(m.rootCubes.map((c) => c.uuid), ['loose']);
});

test('texture references by uuid, null faces stay empty', () => {
  const c = cube('c1');
  c.faces.north.texture = 'tex-b';
  c.faces.up.texture = null;
  const m = parseBBModel({ textures: [{ uuid: 'tex-a' }, { uuid: 'tex-b' }], elements: [c], outliner: ['c1'] });
  const faces = m.rootCubes[0].faces;
  assert.equal(faces.north.texture, 1);
  assert.equal(faces.up.texture, null);
  assert.equal(faces.east.texture, 0);
});

test('box UV derives face UVs from uv_offset, even without a "faces" object', () => {
  const m = parseBBModel({
    meta: { box_uv: true },
    resolution: { width: 64, height: 64 },
    textures: [{ uuid: 't' }],
    elements: [{ uuid: 'c', type: 'cube', from: [-4, 0, -2], to: [4, 12, 2], uv_offset: [16, 16] }],
    outliner: ['c'],
  });
  const f = m.rootCubes[0].faces;
  // 8x12x4 at 16,16 = minecraft body layout
  assert.deepEqual(f.north.uv, [20, 20, 28, 32]);
  assert.deepEqual(f.east.uv, [16, 20, 20, 32]);
  assert.deepEqual(f.up.uv, [28, 20, 20, 16]);
  assert.deepEqual(f.down.uv, [36, 16, 28, 20]);
  assert.equal(f.north.texture, 0);
});

test('mirrored box UV swaps east and west', () => {
  const m = parseBBModel({
    meta: { box_uv: true },
    textures: [{ uuid: 't' }],
    elements: [{ uuid: 'c', type: 'cube', from: [0, 0, 0], to: [4, 12, 4], uv_offset: [0, 16], mirror_uv: true }],
    outliner: ['c'],
  });
  const f = m.rootCubes[0].faces;
  assert.deepEqual(f.east.uv, [12, 20, 8, 32]);
  assert.deepEqual(f.west.uv, [4, 20, 0, 32]);
});

test('animations map bone uuids to names and keep Molang strings', () => {
  const m = parseBBModel({
    elements: [cube('c1')],
    outliner: [{ uuid: 'g1', name: 'head', children: ['c1'] }],
    animations: [{
      name: 'idle', loop: 'loop', length: 2,
      animators: {
        g1: { name: 'head', type: 'bone', keyframes: [
          { channel: 'rotation', time: 1, data_points: [{ x: 'math.sin(q.anim_time * 90) * 5', y: '0', z: 2 }] },
          { channel: 'rotation', time: 0, data_points: [{ x: 0, y: 0, z: 0 }] },
        ] },
        effects: { name: 'Effects', type: 'effect', keyframes: [] },
      },
    }],
  });
  const a = m.animations[0];
  assert.equal(a.loop, 'loop');
  assert.deepEqual(Object.keys(a.animators), ['head']);
  const kfs = a.animators.head.rotation;
  assert.deepEqual(kfs.map((k) => k.time), [0, 1]);   // sorted
  assert.deepEqual(kfs[1].points[0], ['math.sin(q.anim_time * 90) * 5', 0, 2]);
});

test('rejects files that are not Blockbench models', () => {
  assert.throws(() => parseBBModel({ hello: 'world' }), /Not a Blockbench model/);
});
