// .bbmodel (format 4 and 5) -> plain object. no three.js in here so it runs in node too

const FACES = ['north', 'east', 'south', 'west', 'up', 'down'];

/**
 * @param {object|string} input parsed JSON or JSON text of a .bbmodel file
 * @returns {object} { name, format, resolution, textures, bones, rootCubes, animations }
 */
export function parseBBModel(input) {
  const d = typeof input === 'string' ? JSON.parse(input) : input;
  if (!d || typeof d !== 'object' || !Array.isArray(d.elements)) {
    throw new Error('Not a Blockbench model: "elements" missing');
  }
  const meta = d.meta || {};
  const resolution = {
    width: d.resolution?.width || 16,
    height: d.resolution?.height || 16,
  };
  const projectBoxUv = !!meta.box_uv;

  const textures = (d.textures || []).map((t, i) => ({
    index: i,
    uuid: t.uuid || String(i),
    name: t.name || `texture_${i}`,
    src: t.source || null,
    path: t.relative_path || t.path || t.name || null,
    uvWidth: t.uv_width || resolution.width,
    uvHeight: t.uv_height || resolution.height,
    width: t.width || null,
    height: t.height || null,
    // most exporters skip textures named "-something", keep them but flag them
    hidden: String(t.name || '').startsWith('-'),
  }));
  const textureByUuid = new Map(textures.map((t) => [t.uuid, t.index]));
  // faces without a texture use the default one
  const defaultTexture = textures.length
    ? Math.max(0, (d.textures || []).findIndex((t) => t.use_as_default)) : null;

  // cubes only, locators / null objects / meshes are skipped for now
  const cubes = new Map();
  for (const e of d.elements) {
    if ((e.type || 'cube') !== 'cube') continue;
    const faces = {};
    for (const f of FACES) {
      // box uv cubes can come without "faces", the uvs come from uv_offset anyway
      const face = e.faces ? e.faces[f] : { uv: [0, 0, 0, 0] };
      if (!face) continue;
      let tex = face.texture;
      if (typeof tex === 'string') tex = textureByUuid.has(tex) ? textureByUuid.get(tex) : null;
      if (tex === undefined) tex = defaultTexture;   // null = face left empty on purpose
      if (tex === false) tex = null;
      faces[f] = {
        uv: (face.uv || [0, 0, 0, 0]).map(Number),
        texture: tex,
        rotation: Number(face.rotation || 0),
      };
    }
    cubes.set(e.uuid, {
      uuid: e.uuid,
      name: e.name || 'cube',
      from: e.from.map(Number),
      to: e.to.map(Number),
      origin: (e.origin || [0, 0, 0]).map(Number),
      rotation: (e.rotation || [0, 0, 0]).map(Number),
      inflate: Number(e.inflate || 0),
      boxUv: e.box_uv !== undefined ? !!e.box_uv : projectBoxUv,
      uvOffset: (e.uv_offset || [0, 0]).map(Number),
      mirrorUv: !!e.mirror_uv,
      visible: e.visibility !== false,
      faces,
    });
    if (cubes.get(e.uuid).boxUv) applyBoxUv(cubes.get(e.uuid));
  }

  // format 5 keeps group data in d.groups, the outliner only has uuids + children
  const groupData = new Map((d.groups || []).filter((g) => g && typeof g === 'object').map((g) => [g.uuid, g]));
  const bones = [];
  const bonesByUuid = new Map();
  const rootCubes = [];

  function walk(node, parent) {
    if (typeof node === 'string') {
      const c = cubes.get(node);
      if (!c) return;
      if (parent) parent.cubes.push(c);
      else rootCubes.push(c);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const g = { ...node, ...(groupData.get(node.uuid) || {}) };
    const bone = {
      uuid: g.uuid,
      name: String(g.name || 'bone'),
      origin: (g.origin || [0, 0, 0]).map(Number),
      rotation: (g.rotation || [0, 0, 0]).map(Number),
      visible: g.visibility !== false,
      parent: parent ? parent.uuid : null,
      children: [],
      cubes: [],
    };
    bones.push(bone);
    bonesByUuid.set(bone.uuid, bone);
    if (parent) parent.children.push(bone.uuid);
    for (const child of node.children || []) walk(child, bone);
  }
  for (const n of d.outliner || []) walk(n, null);

  // cubes missing from the outliner still belong to the model
  const listed = new Set([...bones.flatMap((b) => b.cubes), ...rootCubes].map((c) => c.uuid));
  for (const c of cubes.values()) if (!listed.has(c.uuid)) rootCubes.push(c);

  const animations = (d.animations || []).map((a) => parseAnimation(a, bonesByUuid));

  return {
    name: d.name || meta.model_format || 'model',
    format: meta.model_format || 'free',
    formatVersion: meta.format_version || null,
    resolution,
    textures,
    bones,
    rootCubes,
    animations,
  };
}

function parseAnimation(a, bonesByUuid) {
  const animators = {};
  for (const [key, an] of Object.entries(a.animators || {})) {
    if (an.type && an.type !== 'bone') continue;   // effects / camera animators are not supported
    const bone = bonesByUuid.get(key);
    const name = bone ? bone.name : an.name;
    if (!name) continue;
    const channels = { rotation: [], position: [], scale: [] };
    for (const kf of an.keyframes || []) {
      if (!channels[kf.channel]) continue;
      const points = (kf.data_points || []).map((p) => [p.x ?? 0, p.y ?? 0, p.z ?? 0].map(cleanValue));
      if (!points.length) continue;
      channels[kf.channel].push({
        time: Number(kf.time) || 0,
        interpolation: kf.interpolation || 'linear',
        points,
        bezier: {
          leftTime: (kf.bezier_left_time || [-0.1, -0.1, -0.1]).map(Number),
          leftValue: (kf.bezier_left_value || [0, 0, 0]).map(Number),
          rightTime: (kf.bezier_right_time || [0.1, 0.1, 0.1]).map(Number),
          rightValue: (kf.bezier_right_value || [0, 0, 0]).map(Number),
        },
      });
    }
    for (const ch of Object.values(channels)) ch.sort((x, y) => x.time - y.time);
    if (channels.rotation.length || channels.position.length || channels.scale.length) {
      animators[name] = { ...channels, global: !!an.rotation_global };
    }
  }
  return {
    name: a.name || 'animation',
    loop: a.loop || 'once',   // 'loop' | 'once' | 'hold'
    length: Number(a.length) || 0,
    override: !!a.override,
    snapping: Number(a.snapping) || 20,
    animators,
  };
}

// numbers stay numbers, molang stays a string and gets evaluated later
function cleanValue(v) {
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\n/g, '');
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

// box uv: face uvs from uv_offset and the floored cube size, same layout as blockbench
export function applyBoxUv(cube) {
  const size = [0, 1, 2].map((i) => Math.floor(cube.to[i] - cube.from[i] + 1e-7));
  const list = [
    { face: 'east', from: [0, size[2]], size: [size[2], size[1]] },
    { face: 'west', from: [size[2] + size[0], size[2]], size: [size[2], size[1]] },
    { face: 'up', from: [size[2] + size[0], size[2]], size: [-size[0], -size[2]] },
    { face: 'down', from: [size[2] + size[0] * 2, 0], size: [-size[0], size[2]] },
    { face: 'south', from: [size[2] * 2 + size[0], size[2]], size: [size[0], size[1]] },
    { face: 'north', from: [size[2], size[2]], size: [size[0], size[1]] },
  ];
  if (cube.mirrorUv) {
    for (const f of list) {
      f.from[0] += f.size[0];
      f.size[0] *= -1;
    }
    const east = { from: list[0].from.slice(), size: list[0].size.slice() };
    list[0].from = list[1].from.slice();
    list[0].size = list[1].size.slice();
    list[1].from = east.from;
    list[1].size = east.size;
  }
  for (const f of list) {
    const face = cube.faces[f.face];
    if (!face || face.texture === null) continue;
    face.uv = [
      f.from[0] + cube.uvOffset[0],
      f.from[1] + cube.uvOffset[1],
      f.from[0] + f.size[0] + cube.uvOffset[0],
      f.from[1] + f.size[1] + cube.uvOffset[1],
    ];
  }
}

export { FACES };
