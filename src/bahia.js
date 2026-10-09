// BAHÍA — Servida como se merece. Escena, interacción y física de la lata.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { emitir, grade, FULL } from './modelo.js';
import { createFluid, MOUTH } from './fluido.js';
import { createBeach, waveReach, SHORE, WAKES } from './playa.js';
import { createActor } from './personaje.js';
import { createSound } from './sonido.js';

const POUR_TILT = 2.0; // inclinación de la lata al servir (rad)
const GAP = 0.06;      // aire a cada lado de la lata dentro de la palabra
const CORNER = Math.PI / 3; // en el contorno de las letras, un giro mayor a 60° es esquina y se queda filoso
const BEVEL = 3;       // bisel de las letras, en unidades del FBX (la palabra mide ~256 de alto)

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
document.body.prepend(renderer.domElement);
const canvas = renderer.domElement;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 3000);
const fill = new THREE.DirectionalLight(0xffe2c0, 1.5); fill.position.set(1, 2, 5); scene.add(fill); // luz suave de frente: el sol está detrás
const beach = createBeach(scene, renderer, camera);

const [gltf, logo, canTex] = await Promise.all([
  new GLTFLoader().loadAsync('models/lata.glb'),
  new FBXLoader().loadAsync('models/logo-bahia.fbx'),
  new THREE.TextureLoader().loadAsync('textures/lata-bahia.webp'),
]);

// Gotas de condensación: un mapa de normales hecho a mano (medias esferas) para el vidrio y la lata
function condensation(size = 512, count = 1400) {
  const h = new Float32Array(size * size);
  for (let i = 0; i < count; i++) {
    const r = 1.5 + Math.random() ** 3 * 10, cx = Math.random() * size, cy = Math.random() * size;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = (x * x + y * y) / (r * r);
      if (d > 1) continue;
      const k = ((Math.floor(cy + y) + size) % size) * size + (Math.floor(cx + x) + size) % size;
      h[k] = Math.max(h[k], Math.sqrt(1 - d) * r);
    }
  }
  const at = (x, y) => h[((y + size) % size) * size + (x + size) % size];
  const img = new ImageData(size, size), n = new THREE.Vector3();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    n.set(at(x - 1, y) - at(x + 1, y), at(x, y - 1) - at(x, y + 1), 2).normalize();
    img.data.set([(n.x * .5 + .5) * 255, (n.y * .5 + .5) * 255, (n.z * .5 + .5) * 255, 255], (y * size + x) * 4);
  }
  const c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const drops = condensation();

// ---- Logo: cada letra se reconstruye desde el contorno de su cara frontal ----
// El FBX es muy liviano (la B tiene curvas de 8 tramos), así que se redondean las curvas
// y se vuelve a extruir con un bisel pequeño. Las esquinas quedan filosas.
function soften(L, iterations = 4) { // Chaikin: cada vértice suave se parte en dos, a 1/4 de sus vecinos
  const turn = (a, v, b) => { const u = v.clone().sub(a), w = b.clone().sub(v); return Math.abs(Math.atan2(u.cross(w), u.dot(w))); };
  let pts = L.map((v, i) => ({ v, hard: turn(L.at(i - 1), v, L[(i + 1) % L.length]) > CORNER }));
  for (let k = 0; k < iterations; k++) pts = pts.flatMap(({ v, hard }, i) => hard ? [{ v, hard }]
    : [{ v: v.clone().lerp(pts.at(i - 1).v, 0.25) }, { v: v.clone().lerp(pts[(i + 1) % pts.length].v, 0.25) }]);
  return pts.map(q => q.v);
}
function letters(geo) {
  const p = geo.attributes.position, { min, max } = geo.boundingBox;
  const key = i => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)}`;
  const edges = new Set(), next = new Map();
  for (let t = 0; t < p.count; t += 3)
    if ([0, 1, 2].every(k => p.getZ(t + k) > max.z - 1e-3)) for (let k = 0; k < 3; k++) edges.add(key(t + k) + '|' + key(t + (k + 1) % 3));
  for (const e of edges) { const [a, b] = e.split('|'); if (!edges.has(b + '|' + a)) next.set(a, b); } // arista sin gemela = contorno
  const loops = [], seen = new Set();
  for (const s of next.keys()) {
    if (seen.has(s)) continue;
    const L = [];
    for (let c = s; !seen.has(c); c = next.get(c)) { seen.add(c); L.push(new THREE.Vector2(...c.split(',').map(Number))); }
    loops.push(soften(L));
  }
  const inside = (q, L) => L.reduce((c, a, i) => { const b = L[(i + 1) % L.length];
    return (a.y > q.y) !== (b.y > q.y) && q.x < a.x + (b.x - a.x) * (q.y - a.y) / (b.y - a.y) ? !c : c; }, false);
  return loops.filter(L => !loops.some(M => M !== L && inside(L[0], M))).map(L => { // contornos externos; los de adentro son huecos
    const shape = new THREE.Shape(L), holes = loops.filter(M => M !== L && inside(M[0], L));
    shape.holes = holes.map(M => new THREE.Path(M));
    const g = new THREE.ExtrudeGeometry(shape, { depth: max.z - min.z - 2 * BEVEL, bevelThickness: BEVEL, bevelSize: BEVEL, bevelOffset: -BEVEL, bevelSegments: 3 });
    const smooth = toCreasedNormals(g.translate(0, 0, min.z + BEVEL), THREE.MathUtils.degToRad(10)); // suaviza las curvas, no las caras ni el bisel
    smooth.userData.loops = [L, ...holes]; // el contorno también es el vaso del fluido
    return smooth;
  });
}
function boxUV(g) { // UV por proyección de caja, para las gotas del vidrio
  const n = g.attributes.normal, pos = g.attributes.position.array, uv = new Float32Array(n.count * 2);
  for (let i = 0; i < n.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), [x, y, z] = pos.subarray(i * 3, i * 3 + 3);
    uv.set(az >= ax && az >= ay ? [x, y] : ax >= ay ? [z, y] : [x, z], i * 2);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
// El líquido es la misma letra encogida un poco hacia adentro, para que quede dentro del vidrio
function inset(geo, d) {
  const g = geo.clone(), p = g.attributes.position, nrm = g.attributes.normal, dirs = new Map();
  const key = i => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i), nk = `${nrm.getX(i).toFixed(2)},${nrm.getY(i).toFixed(2)},${nrm.getZ(i).toFixed(2)}`;
    if (!dirs.has(k)) dirs.set(k, new Map());
    dirs.get(k).set(nk, new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)));
  }
  const off = new Map([...dirs].map(([k, m]) => [k, [...m.values()].reduce((a, b) => a.add(b), new THREE.Vector3()).normalize().multiplyScalar(d)]));
  const moved = [];
  for (let i = 0; i < p.count; i++) { const o = off.get(key(i)); moved.push([p.getX(i) - o.x, p.getY(i) - o.y, p.getZ(i) - o.z]); }
  moved.forEach((v, i) => p.setXYZ(i, ...v));
  return g;
}

logo.updateMatrixWorld(true);
let logoGeo; logo.traverse(n => { if (n.isMesh) logoGeo = n.geometry.clone().applyMatrix4(n.matrixWorld); });
logoGeo.computeBoundingBox();
const pieces = letters(logoGeo).map(g => {
  const { min, max } = logoGeo.boundingBox, unit = 1 / (max.y - min.y);
  g.translate(0, -min.y, -(min.z + max.z) / 2).scale(unit, unit, unit);
  g.userData.loops.forEach(L => L.forEach(v => v.set(v.x * unit, (v.y - min.y) * unit)));
  boxUV(g); g.computeBoundingBox();
  return g;
}).sort((a, b) => a.boundingBox.min.x - b.boundingBox.min.x);
const iIdx = pieces.reduce((m, g, i) => (g.boundingBox.max.x - g.boundingBox.min.x < pieces[m].boundingBox.max.x - pieces[m].boundingBox.min.x ? i : m), 0);

// ---- Vidrio con dispersión: separa la luz del sol en colores ----
const dropsGlass = drops.clone(); dropsGlass.repeat.set(3, 3);
const glassMat = new THREE.MeshPhysicalMaterial({ roughness: 0.02, transmission: 1, thickness: 0.3, ior: 1.5, dispersion: 8,
  attenuationColor: 0xffb347, attenuationDistance: 0.6, clearcoat: 1, iridescence: 0.3, iridescenceIOR: 1.3,
  normalMap: dropsGlass, normalScale: new THREE.Vector2(0.2, 0.2) }); // vidrio frío: gotas que desvían la luz
// El líquido de cada letra se pinta donde el campo del fluido (las gotas de fluido.js, ya difuminadas) dice que hay cerveza.
// La espuma es la franja de arriba: la cerveza quieta (rojo) que tiene aire libre a menos de uFoamH por encima.
// La máscara dice dónde hay vidrio: bajo el hueco de la B o la A, o bajo el travesaño de la H, no hay superficie y no hay espuma.
const worldVert = `varying vec3 vW; varying vec3 vN;
    void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`;
const liquidMat = () => new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { ...fieldU, uTime: { value: 0 }, uShine: { value: 0 }, uFoamH: { value: 0 } },
  vertexShader: worldVert,
  fragmentShader: `uniform sampler2D uField, uMask; uniform vec4 uRegion; uniform float uTime,uShine,uFoamH; varying vec3 vW; varying vec3 vN;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    void main(){
      vec2 uv = (vW.xy - uRegion.xy) * uRegion.zw;
      vec4 fl = texture2D(uField, uv);
      if (fl.r + fl.g < 1.4) discard; // verde: el chorro que todavía cae dentro del vaso, se ve como cerveza
      float head = 0., prev = fl.r;
      if (uFoamH > .004 && fl.r > 1.4) for (int k = 1; k <= 8; k++) { // sube buscando la superficie
        vec2 q = uv + vec2(0., uFoamH * uRegion.w * float(k) / 8.);
        if (texture2D(uMask, q).r < .5) break;
        float f = texture2D(uField, q).r;
        if (f < 1.4) { head = 1. - smoothstep(.75, 1., (float(k - 1) + (prev - 1.4) / max(prev - f, 1e-3)) / 8.); break; }
        prev = f;
      }
      vec3 col = mix(vec3(.85,.42,.03), vec3(1.,.72,.16), smoothstep(-.1,1.,vW.y));
      vec2 q = vec2(vW.x*30., vW.y*30. - uTime*2.5), id = floor(q), f = fract(q)-.5;  // burbuja fina que sube
      float r = hash(id); f.x += (r-.5)*.6;
      col += (r > .82 ? smoothstep(.12,.05,length(f)) : 0.) * vec3(1.,.9,.6) * .9;
      col = mix(col, vec3(1.,.96,.88) * (.9 + .1*hash(floor(vW.xy*90.))), head); // espuma
      if (!gl_FrontFacing) col *= .9;
      gl_FragColor = vec4(col*(.8 + .2*max(vN.y,0.))*(1.6 + uShine), 1.);  // servido perfecto: la letra se enciende
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

// ---- La lata (tu rig) es la Í; la anilla abierta hace de tilde ----
const can = new THREE.Group(); can.add(gltf.scene);
gltf.scene.rotation.x = -Math.PI / 2; // el GLB viene con Z hacia arriba
can.rotation.y = -Math.PI / 2;        // la etiqueta se repite dos veces, así que el frente sigue a la vista; la anilla queda de perfil
                                      // y al levantarse se inclina hacia la derecha como la tilde de la Í, con el hueco del lado que sirve
can.updateMatrixWorld(true);
// Una sola textura: la etiqueta a la izquierda y el gris del aluminio (tapa, anilla) a la derecha
canTex.flipY = false; canTex.colorSpace = THREE.SRGBColorSpace; canTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const dropsCan = drops.clone(); dropsCan.repeat.set(3, 4);
const label = new THREE.MeshPhysicalMaterial({ map: canTex, metalness: 0.15, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08,
  normalMap: dropsCan, normalScale: new THREE.Vector2(0.35, 0.35), side: THREE.DoubleSide }); // tinta sobre metal: el brillo lo da el barniz, no el color
const alu = new THREE.MeshPhysicalMaterial({ map: canTex, metalness: 1, roughness: 0.22, side: THREE.DoubleSide });
can.traverse(n => {
  if (!n.isMesh) return;
  n.frustumCulled = false; n.castShadow = true;
  n.material = n.material.name === 'Cerveza' ? label : alu;
});
const canBox = new THREE.Box3().setFromObject(can), canSize = canBox.getSize(new THREE.Vector3());
const CAN_H = 1, s = CAN_H / canSize.y, CAN_W = canSize.x * s;
can.scale.setScalar(s);
can.position.set(-(canBox.min.x + canBox.max.x) / 2 * s, -canBox.min.y * s - CAN_H / 2, -(canBox.min.z + canBox.max.z) / 2 * s);
const pivot = new THREE.Group(), actor = new THREE.Group(); // el actor se aplasta, se estira y gira apoyado en la base de la lata
actor.position.y = -CAN_H / 2; can.position.y += CAN_H / 2;
pivot.add(actor); actor.add(can); scene.add(pivot);
const hit = new THREE.Mesh(new THREE.BoxGeometry(CAN_W, CAN_H, CAN_W), new THREE.MeshBasicMaterial({ visible: false }));
pivot.add(hit);
const mouthLocal = new THREE.Vector3(-0.09, CAN_H / 2, 0); // el hueco que abre la tapa, no el centro

const bone = n => can.getObjectByName(n);
const DEF = ['DEF_01', 'DEF_02', 'DEF_03', 'DEF_04', 'DEF_05'].map(bone);
const defBase = DEF[0].position.clone(), SEG = DEF[1].position.y - DEF[0].position.y;
function bend(a) { // curva total "a" repartida en los 5 segmentos del rig
  const p = defBase.clone();
  DEF.forEach((b, i) => {
    const th = a * (i + 1) / DEF.length;
    b.position.copy(p); b.rotation.set(th, 0, 0);
    p.z += Math.sin(th) * SEG; p.y += Math.cos(th) * SEG;
  });
}
// Abrir: la anilla sube (su punta empuja hacia abajo) y la tapa se hunde dentro de la lata
const opener = bone('DEF_opener'), openerRest = opener.rotation.x, OPEN_ANGLE = 0.9;
const lid = bone('DEF_lid'), lidRest = lid.rotation.x, LID_ANGLE = 1.3;

// ---- Composición: B A H [lata] A, la última A se corre para darle espacio a la lata ----
const prev = pieces[iIdx - 1].boundingBox, next = pieces[iIdx + 1].boundingBox;
const shift = CAN_W + 2 * GAP - (next.min.x - prev.max.x);
const x0 = pieces[0].boundingBox.min.x, x1 = pieces.at(-1).boundingBox.max.x + shift, center = -(x0 + x1) / 2;
const home = new THREE.Vector3(prev.max.x + GAP + CAN_W / 2 + center, CAN_H / 2, 0);
pivot.position.copy(home);

// ---- La cerveza es un fluido de partículas en el plano de la palabra (fluido.js) ----
// Las gotas se pintan como manchas suaves en una textura (el "campo"); el líquido se dibuja donde el campo pasa un umbral.
const region = { x0: x0 + center - 1, x1: x1 + center + 1, y0: -0.05, y1: 3 }; // donde puede haber cerveza
const FIELD_W = 1024, FIELD_H = Math.round(FIELD_W * (region.y1 - region.y0) / (region.x1 - region.x0)), SPLAT = 0.05;
const field = new THREE.WebGLRenderTarget(FIELD_W, FIELD_H, { type: THREE.HalfFloatType, depthBuffer: false }), fieldTmp = field.clone();
const mask = new THREE.WebGLRenderTarget(FIELD_W, FIELD_H, { depthBuffer: false }); // dentro de los vasos y sobre sus bocas = blanco
// difuminado gaussiano en dos pasadas: las gotas se funden en un solo cuerpo de líquido, sin grumos
const blur = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: { tMap: { value: null }, uStep: { value: new THREE.Vector2() } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `uniform sampler2D tMap; uniform vec2 uStep; varying vec2 vUv;
    void main(){
      gl_FragColor = texture2D(tMap, vUv) * .227
        + (texture2D(tMap, vUv + uStep * 1.385) + texture2D(tMap, vUv - uStep * 1.385)) * .316
        + (texture2D(tMap, vUv + uStep * 3.231) + texture2D(tMap, vUv - uStep * 3.231)) * .070;
    }`,
}));
const fieldU = { uField: { value: field.texture }, uMask: { value: mask.texture }, uRegion: { value: new THREE.Vector4(region.x0, region.y0, 1 / (region.x1 - region.x0), 1 / (region.y1 - region.y0)) } };

const glasses = [];
pieces.forEach((geo, i) => {
  if (i === iIdx) return;
  const { min, max } = geo.boundingBox, group = new THREE.Group(), liquid = new THREE.Mesh(inset(geo, 0.02), liquidMat());
  group.position.x = center + (i > iIdx ? shift : 0);
  const glass = new THREE.Mesh(geo, glassMat); glass.castShadow = true;
  group.add(liquid, glass); scene.add(group);
  glasses.push({ u: liquid.material.uniforms, h: max.y - min.y, cx: group.position.x + (min.x + max.x) / 2,
    x0: group.position.x + min.x, x1: group.position.x + max.x, done: false, perfect: false,
    loops: geo.userData.loops.map(L => L.map(v => ({ x: v.x + group.position.x, y: v.y }))) });
});
const front = pieces[0].boundingBox.max.z;
beach.setWord(glasses.map(g => [g.x0, g.x1]), front);

// ---- Huella de cada letra en la arena: donde el vidrio baja más que el agua que sube, frena la ola ----
// La A y la H se apoyan en dos patas (el agua pasa por debajo de su arco); la B apoya solo parte de su panza.
// La forma de la estela de cada una se ajusta en WAKES (playa.js).
const WATER = 0.04, NAMES = ['B', 'A', 'H', 'A'];
function footprint(loops, a, b) { // tramos de x donde lo más bajo del contorno queda bajo el agua
  const out = [];
  for (let x = a, start = null; x <= b + 0.004; x += 0.004) {
    let low = Infinity;
    for (const L of loops) L.forEach((q, i) => { const r = L[(i + 1) % L.length];
      if (q.x !== r.x && (q.x - x) * (r.x - x) <= 0) low = Math.min(low, q.y + (r.y - q.y) * (x - q.x) / (r.x - q.x)); });
    if (low < WATER && x <= b && start === null) start = x;
    if ((low >= WATER || x > b) && start !== null) { out.push([start, Math.min(x, b)]); start = null; }
  }
  return out;
}
{
  const feet = [], arches = [];
  glasses.forEach((g, k) => {
    const w = WAKES[NAMES[k]], f = footprint(g.loops, g.x0, g.x1);
    f.forEach(([a, b]) => feet.push({ x0: a, x1: b, length: w.length, curve: w.curve }));
    for (let i = 1; i < f.length; i++) arches.push({ x0: f[i - 1][1], x1: f[i][0], jet: w.jet });
  });
  beach.setFeet(feet, arches);
}

const fluid = createFluid(glasses.map(g => ({ loops: g.loops, top: g.h })), region);
const CAP = fluid.cap.reduce((a, b) => a + b) / fluid.cap.length; // gotas que llenan un vaso
const splatGeo = new THREE.BufferGeometry();
splatGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fluid.X.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
splatGeo.setAttribute('kind', new THREE.BufferAttribute(new Float32Array(fluid.X.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
splatGeo.setAttribute('vel', new THREE.BufferAttribute(new Float32Array(fluid.X.length * 2), 2).setUsage(THREE.DynamicDrawUsage));
// la cerveza suelta se estira en la dirección en que cae (como un desenfoque de movimiento): las gotas seguidas forman un chorro continuo
const splats = new THREE.Points(splatGeo, new THREE.ShaderMaterial({
  uniforms: { uSize: { value: 2 * SPLAT * FIELD_W / (region.x1 - region.x0) } },
  vertexShader: `attribute vec3 kind; attribute vec2 vel; varying vec3 vK; varying vec2 vDir; varying float vLen; uniform float uSize;
    void main(){
      vK = kind; vLen = 1. + min(length(vel) * .3, 2.); vDir = length(vel) > 1e-4 ? normalize(vec2(vel.x, -vel.y)) : vec2(1., 0.);
      gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize = uSize * vLen;
    }`,
  fragmentShader: `varying vec3 vK; varying vec2 vDir; varying float vLen;
    void main(){
      vec2 p = (gl_PointCoord*2.-1.) * vLen;
      float a = dot(p, vDir) / vLen, b = dot(p, vec2(-vDir.y, vDir.x)), r2 = a*a + b*b;
      if (r2 > 1.) discard;
      gl_FragColor = vec4(vK*(1.-r2)*(1.-r2), 1.);
    }`,
  blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
}));
splats.frustumCulled = false;
const fieldScene = new THREE.Scene().add(splats), fieldCam = new THREE.OrthographicCamera(region.x0, region.x1, region.y1, region.y0, -1, 1);
{ // la máscara se pinta una vez: el interior de cada letra y el aire encima de su boca
  const maskScene = new THREE.Scene(), white = new THREE.MeshBasicMaterial();
  for (const g of glasses) {
    const v2 = L => L.map(q => new THREE.Vector2(q.x, q.y)), shape = new THREE.Shape(v2(g.loops[0]));
    shape.holes = g.loops.slice(1).map(L => new THREE.Path(v2(L)));
    maskScene.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), white));
    g.loops.forEach(L => L.forEach((a, i) => {
      const b = L[(i + 1) % L.length];
      if (a.y < g.h - MOUTH || b.y < g.h - MOUTH || a.x === b.x) return;
      const box = new THREE.PlaneGeometry(Math.abs(b.x - a.x), g.h + 0.5 - Math.min(a.y, b.y));
      maskScene.add(new THREE.Mesh(box.translate((a.x + b.x) / 2, (g.h + 0.5 + Math.min(a.y, b.y)) / 2, 0), white));
    }));
  }
  renderer.setRenderTarget(mask); renderer.render(maskScene, fieldCam); renderer.setRenderTarget(null);
}
// lo que está fuera de los vasos (chorro, rebose, charcos) va en una lámina justo delante de las letras (canal azul):
// cerveza traslúcida, más dorada donde es delgada y más ámbar donde es gruesa, con un brillo suave en el borde
const spill = new THREE.Mesh(new THREE.PlaneGeometry(region.x1 - region.x0, region.y1 - region.y0).translate((region.x0 + region.x1) / 2, (region.y0 + region.y1) / 2, front + 0.01),
  new THREE.ShaderMaterial({ uniforms: fieldU, vertexShader: worldVert, transparent: true, depthWrite: false,
    fragmentShader: `uniform sampler2D uField; uniform vec4 uRegion; varying vec3 vW;
      void main(){
        vec2 uv = (vW.xy - uRegion.xy) * uRegion.zw, e = vec2(3./${FIELD_W}., 0.);
        float d = texture2D(uField, uv).b, a = smoothstep(.45, 1.4, d); // donde es delgada se transparenta
        if (a < .01) discard;
        float gx = texture2D(uField, uv + e).b - texture2D(uField, uv - e).b, gy = texture2D(uField, uv + e.yx).b - texture2D(uField, uv - e.yx).b;
        vec3 n = normalize(vec3(-gx, -gy, 1.5));
        vec3 col = mix(vec3(.95,.58,.1), vec3(.75,.36,.03), smoothstep(.6, 2.5, d)) * 1.15; // fuera del vidrio ámbar, la cerveza se ve más oscura
        col += pow(max(dot(n, normalize(vec3(-.4,.7,1.))), 0.), 24.) * vec3(1.,.9,.7) * .35;
        gl_FragColor = vec4(col, a * .9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` }));
spill.userData.noDepth = true; // no tapa la profundidad de campo
scene.add(spill);

const camBase = new THREE.Vector3(), camLook = new THREE.Vector3(0, 0.95, 0); // donde mira la cámara sobria
function fit() {
  const aspect = innerWidth / innerHeight, tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(1.6 / tan, (x1 - x0) * 1.3 / 2 / (tan * aspect));
  camera.aspect = aspect; camera.position.set(0, 0.7, dist); camera.lookAt(camLook); camBase.copy(camera.position);
  camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); beach.setSize(innerWidth, innerHeight);
}
addEventListener('resize', fit); fit();
{ // el sol asoma justo detrás de la H: su luz atraviesa el vidrio y se abre en colores
  const d = camera.position.z, h = glasses[2];
  beach.setSun(Math.atan(0.15 / d) + 0.01, Math.atan(-h.cx / d));
}

// ---- Interacción ----
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p = new THREE.Vector3();
const target = new THREE.Vector3(), grab = new THREE.Vector3();
let opened = false, open = 0, drag = false;
const sound = createSound(), acting = createActor(sound), hover = new THREE.Vector3(1e3, 0, 0);
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => sound.start(), { capture: true }); // el navegador solo deja sonar tras un toque
function setRay(e) { ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1); ray.setFromCamera(ndc, camera); }
canvas.addEventListener('pointerdown', e => {
  setRay(e);
  if (!ray.intersectObject(hit).length) return;
  if (!opened) { opened = true; sound.canOpen(pivot.position.x); return; }
  drag = true; canvas.setPointerCapture(e.pointerId);
  ray.ray.intersectPlane(plane, p); grab.copy(pivot.position).sub(p); target.copy(pivot.position);
});
canvas.addEventListener('pointermove', e => {
  setRay(e);
  ray.ray.intersectPlane(plane, hover);
  if (drag) { target.copy(hover).add(grab); target.y = Math.max(target.y, CAN_H / 2); }
  canvas.style.cursor = drag ? 'grabbing' : ray.intersectObject(hit).length ? (opened ? 'grab' : 'pointer') : '';
});
canvas.addEventListener('pointerup', () => drag = false);
canvas.addEventListener('pointerleave', () => hover.set(1e3, 0, 0));

// ---- Física: resortes (cap. 3) para posición, inclinación y flexión de la lata ----
const vel = new THREE.Vector3(), poured = { beer: 0, foam: 0 };
let tilt = 0, tiltV = 0, bendA = 0, bendV = 0, served = 0, drainAt = 0, lastReach = 0, fizz = 0, gulpAt = 0, splatAt = 0, landed = 0;
// Cada cerveza que se toman suma: la borrachera (0..1) crece rápido al principio y cada vez más despacio
let beers = 0, drunk = 0, drinking = false;
const DRUNK_PER = 8; // cervezas para llegar a ~63 % de borrachera
// la lata se inclina sobre cualquier letra, aunque ya esté llena: si se pasa, se rebosa
const overGlass = (gx, gy) => glasses.some(g => gx > g.x0 && gx < g.x1 && gy > g.h + 0.02);
const spring = (x, v, goal, k, c, dt) => v + (k * (goal - x) - c * v) * dt;

// Sin textos: el veredicto se ve en la letra. Plana o espumosa se queda así; perfecta destella y queda encendida.
function evaluate(g, foam) {
  g.done = true;
  if (grade(foam) === 'perfecta') { g.perfect = true; g.u.uShine.value = 2.5; acting.trigger('celebrar'); }
  sound.done(g.perfect, g.cx);
  if (++served === glasses.length) drainAt = clock.getElapsed() + 4; // la palabra servida se queda un rato y se vacía: otra ronda
}

const clock = new THREE.Timer(), v2 = new THREE.Vector3();
renderer.setAnimationLoop(time => {
  clock.update(time);
  const dt = Math.min(clock.getDelta(), 1 / 30), t = clock.getElapsed();
  const goal = drag ? target : home;

  vel.addScaledVector(v2.subVectors(goal, pivot.position), 140 * dt).multiplyScalar(1 - 16 * dt);
  pivot.position.addScaledVector(vel, dt);

  const mx = goal.x - Math.sin(POUR_TILT) * CAN_H / 2, my = goal.y + Math.cos(POUR_TILT) * CAN_H / 2;
  tiltV = spring(tilt, tiltV, drag && opened && overGlass(mx, my) ? POUR_TILT : 0, 60, 11, dt); tilt += tiltV * dt;
  pivot.rotation.z = tilt;
  bendV = spring(bendA, bendV, THREE.MathUtils.clamp(-vel.x * 0.12, -0.5, 0.5), 90, 7, dt); bendA += bendV * dt;
  // personalidad: cuando nadie la toca y está en su sitio, actúa (personaje.js)
  const idle = !drag && Math.abs(tilt) < 0.3 && pivot.position.distanceTo(home) < 0.1;
  const empty = glasses.filter(g => !g.done).sort((a, b) => Math.abs(a.cx - home.x) - Math.abs(b.cx - home.x))[0];
  const act = acting.update({ t, dt, idle, opened, served, drunk, dir: empty ? Math.sign(empty.cx - home.x) : 0,
    near: THREE.MathUtils.clamp(1 - hover.distanceTo(pivot.position) / 0.9, 0, 1), toward: THREE.MathUtils.clamp((hover.x - pivot.position.x) / 0.6, -1, 1) });
  actor.position.y = -CAN_H / 2 + act.y; actor.scale.set(1 - act.sq / 2, 1 + act.sq, 1 - act.sq / 2); actor.rotation.set(act.fwd, act.spin, act.lean);
  bend(bendA + act.bend);
  open += ((opened ? 1 : 0) - open) * Math.min(1, 8 * dt);
  opener.rotation.x = openerRest + open * OPEN_ANGLE + act.tab;
  lid.rotation.x = lidRest + Math.min(1, open * 1.5) * LID_ANGLE; // la tapa cede un poco antes de que la anilla llegue arriba
  opener.scale.setScalar(1 + 0.35 * open); // tilde un poco más grande para que se lea

  const pouring = opened && tilt > 1.6;
  let fill = null, mouthX = pivot.position.x;
  if (pouring) { // sale cerveza por la boca: la altura decide cuánta es espuma (modelo.js)
    pivot.updateMatrixWorld();
    const m = pivot.localToWorld(mouthLocal.clone()), out = emitir(poured, m.y - 1, dt, CAP);
    const k = glasses.findIndex(g => m.x > g.x0 && m.x < g.x1); // dónde cae: el tono del vaso sube a medida que se llena
    mouthX = m.x;
    if (k >= 0) { fill = Math.min(1, (fluid.beer[k] + fluid.foam[k]) / fluid.cap[k]); fizz = Math.max(fizz, Math.min(1, 0.3 + 3 * fluid.foam[k] / fluid.cap[k])); }
    const ax = -Math.sin(tilt), ay = Math.cos(tilt); // hacia donde apunta la boca
    const count = out.beer + out.foam;
    for (let k = 0; k < count; k++) { // repartidas a lo ancho del hueco y a lo largo de lo que avanza el chorro en este cuadro
      const side = (Math.random() - 0.5) * 0.05, along = 1.5 * dt * k / count;
      fluid.emit(m.x - ay * side + ax * along, m.y + ax * side + ay * along, vel.x + ax * 1.5, vel.y + ay * 1.5, k >= out.beer);
    }
  }

  // cuando la ola golpea la cara de atrás de las letras, la cerveza de adentro se mece
  const reach = waveReach(t), edge = SHORE + reach;
  const standing = pivot.position.y < CAN_H / 2 + 0.05 && Math.abs(tilt) < 0.2;
  if (lastReach + SHORE < -front && edge >= -front) {
    fluid.kick(1); sound.slosh();
    sound.waveHit(THREE.MathUtils.clamp((reach - lastReach) / dt / 2.5, 0.5, 1));
    if (standing) acting.trigger('susto');
  }
  beach.setCan(pivot.position.x, CAN_W / 2, standing);
  fizz = Math.max(0, fizz - 0.12 * dt);
  sound.update({ reach, rising: reach > lastReach, pour: pouring ? 1 : 0, fill, x: mouthX, fizz });
  lastReach = reach;

  fluid.update(dt);
  glasses.forEach((g, k) => { // lleno: la lata se endereza sola
    if (!g.done && (fluid.beer[k] + fluid.foam[k]) / fluid.cap[k] >= FULL) evaluate(g, fluid.foam[k] / fluid.cap[k]);
  });
  landed += fluid.takeLanded();
  if (t > splatAt && landed) { sound.splat(landed, 0); landed = 0; splatAt = t + 0.08; } // la cerveza que cae a la arena
  if (drainAt && t > drainAt) { // se la toman desde arriba: un sorbo, tragos y un "aaah" al final
    if (!drinking) { drinking = true; sound.sip(0); gulpAt = t + 0.35; }
    if (t > gulpAt) { gulpAt = t + 0.42; sound.gulp(glasses[Math.floor(Math.random() * glasses.length)].cx); }
    glasses.forEach((g, k) => { beers += fluid.drain(k, Math.ceil(fluid.cap[k] * 0.3 * dt)) / fluid.cap[k]; });
    if (glasses.every((g, k) => !fluid.beer[k] && !fluid.foam[k])) {
      glasses.forEach(g => Object.assign(g, { done: false, perfect: false })); served = drainAt = 0; drinking = false; sound.ahh();
    }
  }

  // borracho: la cámara se mece y se ladea, la imagen ondula y se ve doble (playa.js) y entra la cumbia (sonido.js)
  drunk += ((1 - Math.exp(-beers / DRUNK_PER)) - drunk) * Math.min(1, 0.6 * dt);
  camera.position.copy(camBase).add(v2.set(Math.sin(t * 0.7) * 0.25, Math.sin(t * 1.1) * 0.08, 0).multiplyScalar(drunk));
  camera.lookAt(camLook.x + Math.sin(t * 0.5) * 0.2 * drunk, camLook.y + Math.sin(t * 0.9) * 0.05 * drunk, 0);
  camera.rotateZ(Math.sin(t * 0.6) * 0.06 * drunk);
  beach.setDrunk(drunk); sound.setDrunk(drunk);

  glasses.forEach((g, k) => {
    g.u.uTime.value = t;
    g.u.uShine.value += ((g.perfect ? 0.6 : 0) - g.u.uShine.value) * Math.min(1, 2 * dt);
    g.u.uFoamH.value += (fluid.foam[k] / fluid.cap[k] * g.h - g.u.uFoamH.value) * Math.min(1, 4 * dt); // grosor de la espuma
  });

  // las gotas al campo: rojo = dentro de un vaso, azul = cerveza suelta (que se desvanece al filtrarse en la arena)
  const pos = splatGeo.attributes.position.array, kind = splatGeo.attributes.kind.array, sv = splatGeo.attributes.vel.array;
  for (let i = 0; i < fluid.n; i++) {
    const inGlass = fluid.CUP[i] >= 0, vx = fluid.VX[i] / fluid.STEP, vy = fluid.VY[i] / fluid.STEP;
    const falling = Math.min(1, Math.max(0, (Math.hypot(vx, vy) - 0.5) / 1.5)); // el chorro sigue visible dentro del vaso hasta la superficie
    pos[i * 3] = fluid.X[i]; pos[i * 3 + 1] = fluid.Y[i];
    kind[i * 3] = inGlass ? 1 - falling : 0; kind[i * 3 + 1] = inGlass ? 2.5 * falling : 0; kind[i * 3 + 2] = inGlass ? 0 : 1 - fluid.AGE[i] / fluid.SINK;
    sv[i * 2] = vx; sv[i * 2 + 1] = vy;
  }
  splatGeo.setDrawRange(0, fluid.n);
  splatGeo.attributes.position.needsUpdate = splatGeo.attributes.kind.needsUpdate = splatGeo.attributes.vel.needsUpdate = true;
  renderer.setRenderTarget(field); renderer.render(fieldScene, fieldCam);
  blur.material.uniforms.tMap.value = field.texture; blur.material.uniforms.uStep.value.set(2 / FIELD_W, 0);
  renderer.setRenderTarget(fieldTmp); blur.render(renderer);
  blur.material.uniforms.tMap.value = fieldTmp.texture; blur.material.uniforms.uStep.value.set(0, 2 / FIELD_H);
  renderer.setRenderTarget(field); blur.render(renderer);
  renderer.setRenderTarget(null);

  beach.render(t, reach);
});
