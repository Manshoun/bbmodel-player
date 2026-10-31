// parsed model -> three.js objects. cube geometry and uvs follow blockbench's cube.js
import * as THREE from 'three';

// BoxGeometry face order (px, nx, py, ny, pz, nz)
const BOX_FACES = ['east', 'west', 'up', 'down', 'south', 'north'];
const DEG = Math.PI / 180;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
// minecraft style shading: top 1.0, north/south 0.8, east/west 0.6, bottom 0.5
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float glow;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vec4 c = texture2D(map, vUv);
    if (c.a < 0.05) discard;
    vec3 n = normalize(vNormal);
    float up = n.y > 0.0 ? 1.0 : 0.5;
    float shade = n.x * n.x * 0.6 + n.z * n.z * 0.8 + n.y * n.y * up;
    gl_FragColor = vec4(c.rgb * mix(shade, 1.0, glow), c.a);
    #include <colorspace_fragment>
  }
`;

/**
 * @param {object} model result of parseBBModel()
 * @param {object} opts { textureBase, hiddenBones }
 * @returns {{ root, rig, bones, textures, ready, dispose }}
 */
export function buildModel(model, opts = {}) {
  const hidden = opts.hiddenBones || ((n) => n === 'shadow' || n === 'hitbox');
  const loads = [];
  const textures = model.textures.map((t) => {
    const tex = new THREE.Texture();
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const url = t.src || (opts.textureBase && t.path ? new URL(t.path.split(/[\\/]/).pop(), opts.textureBase).href : null);
    if (url) {
      loads.push(new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          tex.image = img;
          tex.needsUpdate = true;
          resolve();
        };
        img.onerror = () => resolve();   // missing texture, just render without it
        img.src = url;
      }));
    }
    return tex;
  });
  const materialCache = new Map();
  const material = (texIndex, glow) => {
    const key = `${texIndex}:${glow ? 1 : 0}`;
    if (!materialCache.has(key)) {
      materialCache.set(key, new THREE.ShaderMaterial({
        uniforms: { map: { value: textures[texIndex] }, glow: { value: glow ? 1 : 0 } },
        vertexShader,
        fragmentShader,
        side: THREE.FrontSide,
      }));
    }
    return materialCache.get(key);
  };
  const invisible = new THREE.MeshBasicMaterial({ visible: false });

  const root = new THREE.Group();
  root.name = model.name;
  const objects = new Map();   // uuid -> Object3D
  const bones = new Map();     // name -> Object3D
  const rig = new Map();       // name -> { position, rotation, scale, rest }

  const addCubes = (parentObj, parentOrigin, cubes, glow) => {
    for (const c of cubes) {
      if (!c.visible) continue;
      const mesh = makeCube(c, parentOrigin, model, textures, (i) => material(i, glow), invisible);
      if (mesh) parentObj.add(mesh);
    }
  };

  for (const b of model.bones) {
    const g = new THREE.Group();
    g.name = b.name;
    g.rotation.order = 'ZYX';
    const parent = b.parent ? model.bones.find((x) => x.uuid === b.parent) : null;
    const po = parent ? parent.origin : [0, 0, 0];
    g.position.set(b.origin[0] - po[0], b.origin[1] - po[1], b.origin[2] - po[2]);
    g.rotation.set(b.rotation[0] * DEG, b.rotation[1] * DEG, b.rotation[2] * DEG);
    g.visible = b.visible && !hidden(b.name);
    objects.set(b.uuid, g);
    if (!bones.has(b.name)) bones.set(b.name, g);
    (parent ? objects.get(parent.uuid) : root).add(g);
    const glow = isGlow(b, model);
    addCubes(g, b.origin, b.cubes, glow);
    if (!rig.has(b.name)) {
      rig.set(b.name, {
        position: g.position, rotation: g.rotation, scale: g.scale,
        rest: { position: g.position.clone(), rotation: g.rotation.clone(), scale: g.scale.clone() },
      });
    }
  }
  addCubes(root, [0, 0, 0], model.rootCubes, false);

  const ready = Promise.all(loads).then(() => undefined);
  return {
    root,
    rig,
    bones,
    textures,
    ready,
    dispose() {
      root.traverse((o) => o.geometry?.dispose());
      for (const m of materialCache.values()) m.dispose();
      invisible.dispose();
      for (const t of textures) t.dispose();
    },
  };
}

// glow_ bones (and their children) are full bright
function isGlow(bone, model) {
  for (let b = bone; b; b = b.parent ? model.bones.find((x) => x.uuid === b.parent) : null) {
    if (/^glow_/i.test(b.name)) return true;
  }
  return false;
}

function makeCube(c, parentOrigin, model, textures, mat, invisible) {
  const from = c.from.slice(), to = c.to.slice();
  for (let i = 0; i < 3; i++) {
    const half = (c.to[i] - c.from[i]) / 2;
    const center = c.from[i] + half;
    from[i] = center - (half + c.inflate);
    to[i] = center + (half + c.inflate);
    if (from[i] === to[i]) to[i] += 0.001;
  }
  const size = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const geo = new THREE.BoxGeometry(Math.abs(size[0]), Math.abs(size[1]), Math.abs(size[2]));
  geo.translate((from[0] + to[0]) / 2 - c.origin[0], (from[1] + to[1]) / 2 - c.origin[1], (from[2] + to[2]) / 2 - c.origin[2]);

  const uv = geo.attributes.uv;
  const materials = [];
  BOX_FACES.forEach((name, index) => {
    const face = c.faces[name];
    if (!face || face.texture === null || !textures[face.texture]) {
      materials.push(invisible);
      return;
    }
    const t = model.textures[face.texture];
    const pw = t.uvWidth || model.resolution.width;
    const ph = t.uvHeight || model.resolution.height;
    let u = face.uv.slice();
    if (c.boxUv) {   // inset by 1/64 px against bleeding, same as blockbench
      for (let si = 0; si < 2; si++) {
        const m = u[si] > u[si + 2] ? -1 / 64 : 1 / 64;
        u[si] += m;
        u[si + 2] -= m;
      }
    }
    let arr = [
      [u[0] / pw, 1 - u[1] / ph],
      [u[2] / pw, 1 - u[1] / ph],
      [u[0] / pw, 1 - u[3] / ph],
      [u[2] / pw, 1 - u[3] / ph],
    ];
    for (let rot = face.rotation; rot > 0; rot -= 90) {
      const a = arr[0];
      arr = [arr[2], a, arr[3], arr[1]];
    }
    for (let k = 0; k < 4; k++) uv.setXY(index * 4 + k, arr[k][0], arr[k][1]);
    materials.push(mat(face.texture));
  });
  uv.needsUpdate = true;

  const mesh = new THREE.Mesh(geo, materials);
  mesh.name = c.name;
  mesh.rotation.order = 'ZYX';
  mesh.position.set(c.origin[0] - parentOrigin[0], c.origin[1] - parentOrigin[1], c.origin[2] - parentOrigin[2]);
  mesh.rotation.set(c.rotation[0] * DEG, c.rotation[1] * DEG, c.rotation[2] * DEG);
  return mesh;
}
