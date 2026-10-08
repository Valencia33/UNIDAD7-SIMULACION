import * as THREE from 'three';
import './styles.css';
import { createSimulation } from './simulation/createSimulation.js';
import { PostFX } from './postFX.js';

let audioStarted = false;
const audioEl = document.createElement('audio');
audioEl.src = 'dumbest_girl_alive.mp3';
audioEl.loop = true;

const PRESET_NAMES = ['Networks', 'Crystalline', 'Spirals', 'Aggressive'];
const BASE_BLOOM = 0.1;

const state = { paletteIndex: 0 };

// Performer-driven envelopes. Nothing in here reads the audio.
const env = { glitch: 0, aberration: 0, invert: 0, flash: 0, bloom: 0, shake: 0 };
const zoom = { x: 1, v: 0 };            // sprung: punches in/out, then settles with a little bounce
const rot = { x: 0, v: 0, target: 0 };
const held = { glitch: false };

const spring = (s, target, k, c, dt) => {
  s.v += ((target - s.x) * k - s.v * c) * dt;
  s.x += s.v * dt;
};

function flashStatus(text) {
  if (document.getElementById('ui-layer')?.classList.contains('hidden')) return;
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(flashStatus.t);
  flashStatus.t = setTimeout(() => el.classList.remove('on'), 700);
}

async function main() {
  const mount = document.querySelector('#app');
  if (!mount) return;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  camera.position.set(0, 0, 1);

  let width = window.innerWidth;
  let height = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  mount.appendChild(renderer.domElement);

  const fx = new PostFX(renderer, width, height);
  const simulation = createSimulation({ scene, renderer, width, height });

  
  
  // --- LYRICS OVERLAY ---
  const textCanvas = document.createElement('canvas');
  textCanvas.width = 2048;
  textCanvas.height = 2048; // Fixed size to prevent resize bugs
  const tCtx = textCanvas.getContext('2d');
  const textTexture = new THREE.CanvasTexture(textCanvas);
  textTexture.minFilter = THREE.LinearFilter;
  
  const lyricsState = { dumbest: false, girl: false, alive: false, text: false, cry: false };
  let textMode = 2; // 1 = Solid, 2 = Mask

  const textMat = new THREE.ShaderMaterial({
    uniforms: {
      tText: { value: textTexture },
      uMode: { value: 0.0 },
      uColor: { value: new THREE.Color('#e01b24') }, // Punchy Red
      uAspect: { value: 1.0 }
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tText; uniform float uMode; uniform vec3 uColor; uniform float uAspect; varying vec2 vUv; void main() { if (uMode == 0.0) discard; vec2 uv = vec2((vUv.x - 0.5) * uAspect + 0.5, vUv.y); float textA = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? 0.0 : texture2D(tText, uv).r; float alpha = uMode == 1.0 ? textA : (1.0 - textA); if (alpha < 0.01) discard; gl_FragColor = vec4(uColor, alpha); }',
    transparent: true,
    depthTest: false
  });
  const textMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), textMat);
  textMesh.frustumCulled = false;
  textMesh.position.z = 0.5;
  scene.add(textMesh);

  function updateText() {
    tCtx.fillStyle = 'black';
    tCtx.fillRect(0, 0, textCanvas.width, textCanvas.height);
    tCtx.fillStyle = 'white';
    
    // Scale font size based on fixed height
    tCtx.font = '900 240px "Arial Black", Impact, sans-serif';
    tCtx.textAlign = 'center';
    tCtx.textBaseline = 'middle';
    
    let active = false;
    let lines = [];
    if (lyricsState.text) lines.push("TEXT");
    if (lyricsState.cry) lines.push("CRY");
    if (lyricsState.dumbest) lines.push("DUMBEST");
    if (lyricsState.girl) lines.push("GIRL");
    if (lyricsState.alive) lines.push("ALIVE");
    
    if (lines.length > 0) {
        active = true;
        const spacing = textCanvas.height / (lines.length + 1);
        for(let i=0; i<lines.length; i++) {
             tCtx.fillText(lines[i], textCanvas.width / 2, spacing * (i + 1));
        }
    }

    textTexture.needsUpdate = true;
    textMat.uniforms.uMode.value = active ? textMode : 0.0;
  }
  
  function resizeTextCanvas(w, h) {
    textMat.uniforms.uAspect.value = w / h; // Counteract the stretch in the shader instead of recreating canvas
    updateText();
  }
  resizeTextCanvas(width, height);

// ---------------------------------------------------------------- keyboard
  let inertia = false;

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === ' ') e.preventDefault();

    if (key === 'enter' && !audioStarted) {
      audioStarted = true;
      audioEl.play().catch((err) => console.error(err));
      document.getElementById('ui-layer')?.classList.add('hidden');
      document.documentElement.requestFullscreen?.().catch(() => {});
      flashStatus('PLAY');
    }
    if (key === 'h') document.getElementById('ui-layer')?.classList.toggle('hidden');
    if (key === 'p' && audioStarted) {
      if (audioEl.paused) { audioEl.play(); flashStatus('PLAY'); } else { audioEl.pause(); flashStatus('PAUSE'); }
    }
    if ((key === '0' || key === 'backspace') && audioStarted) {
      audioEl.currentTime = 0;
      if (audioEl.paused) audioEl.play();
      flashStatus('RESTART');
    }
    if (key === 'arrowleft' && audioStarted) {
      audioEl.currentTime = Math.max(0, audioEl.currentTime - 5);
      flashStatus('BACK 5s');
    }
    if (key === 'arrowright' && audioStarted) {
      audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + 5);
      flashStatus('FORWARD 5s');
    }

    // Physarum mutations (parameters glide to the new preset)
    const n = parseInt(key, 10);
    if (n >= 1 && n <= PRESET_NAMES.length) {
      simulation.setPoint(n - 1);
      env.aberration = Math.max(env.aberration, 0.012);
      env.flash = Math.max(env.flash, 0.2);
      flashStatus(PRESET_NAMES[n - 1]);
    }
    if (key === 'c') {
      state.paletteIndex += e.shiftKey ? -1 : 1;
      const name = simulation.setPalette(state.paletteIndex);
      env.flash = 0.6;
      env.bloom = Math.max(env.bloom, 0.3);
      flashStatus(name);
    }

    // Visual punches
    if (key === ' ') { held.glitch = true; env.glitch = 1; flashStatus('GLITCH'); }
    if (key === 'a') { zoom.x = 0.8; env.bloom = Math.max(env.bloom, 0.9); env.shake = Math.max(env.shake, 0.6); flashStatus('BASS PUNCH'); }
    if (key === 's') { env.invert = 1; flashStatus('INVERT'); }
    if (key === 'd') { env.aberration = 0.06; flashStatus('ABERRATION'); }

    // Physics punches: tap = pulse, hold = sustain. Each also kicks the camera a little.
    if (key === 'q') {
      simulation.pulse('implode'); simulation.hold('implode', true);
      zoom.x = Math.min(zoom.x, 0.92); env.shake = Math.max(env.shake, 0.3); flashStatus('IMPLODE');
    }
    if (key === 'w') {
      simulation.pulse('explode'); simulation.hold('explode', true);
      zoom.x = 1.1; env.aberration = Math.max(env.aberration, 0.025);
      env.bloom = Math.max(env.bloom, 0.5); env.shake = Math.max(env.shake, 0.5); flashStatus('EXPLODE');
    }
    if (key === 'e') {
      simulation.pulse('vortex'); simulation.hold('vortex', true);
      rot.target = 0.35; env.aberration = Math.max(env.aberration, 0.02); flashStatus('VORTEX');
    }
    
    
    const punchLyric = (prop) => { lyricsState[prop] = true; updateText(); env.bloom = Math.max(env.bloom, 0.4); env.shake = Math.max(env.shake, 0.2); };
    if (key === 't') punchLyric('text');
    if (key === 'y') punchLyric('cry');
    if (key === 'j') punchLyric('dumbest');
    if (key === 'k') punchLyric('girl');
    if (key === 'l') punchLyric('alive');
    if (key === 'm') { textMode = textMode === 1 ? 2 : 1; updateText(); flashStatus(textMode === 1 ? 'SOLID LYRICS' : 'MASK LYRICS'); }
if (key === 'r') {
      simulation.pulse('scatter');
      env.flash = Math.max(env.flash, 0.5); env.glitch = Math.max(env.glitch, 0.5); flashStatus('SCATTER');
    }

    // Sustained forces
    if (key === 'f') { simulation.setFlow(true); flashStatus('FLOW FIELD'); }
    if (key === 'v') {
      inertia = !inertia;
      simulation.setInertia(inertia);
      flashStatus(inertia ? 'INERTIA ON' : 'INERTIA OFF');
    }
  });

  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'f') simulation.setFlow(false);
    if (key === ' ') held.glitch = false;
    
    
    const releaseLyric = (prop) => { lyricsState[prop] = false; updateText(); };
    if (key === 't') releaseLyric('text');
    if (key === 'y') releaseLyric('cry');
    if (key === 'j') releaseLyric('dumbest');
    if (key === 'k') releaseLyric('girl');
    if (key === 'l') releaseLyric('alive');
if (key === 'q') simulation.hold('implode', false);
    if (key === 'w') simulation.hold('explode', false);
    if (key === 'e') { simulation.hold('vortex', false); rot.target = 0; }
  });

  // ---------------------------------------------------------------- pointer
  const toNDC = (e) => simulation.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
  let idleTimer;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 2000);
  };
  window.addEventListener('pointermove', (e) => { toNDC(e); wake(); });
  window.addEventListener('pointerdown', (e) => { if (e.button === 0) { toNDC(e); simulation.setLeader(true); flashStatus('LEADER'); } });
  window.addEventListener('pointerup', (e) => { if (e.button === 0) simulation.setLeader(false); });
  window.addEventListener('blur', () => simulation.setLeader(false));
  wake();

  // wheel = how far agents see; shift + wheel = how long the trail remembers
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    let delta = e.deltaY || e.deltaX;
    if (e.deltaMode === 1) delta *= 33;
    const notches = Math.max(-1.5, Math.min(1.5, -delta / 100));
    if (e.shiftKey) {
      flashStatus('MEMORY ' + (simulation.nudgeMemory(notches) * 100).toFixed(1) + '%');
    } else {
      flashStatus('SENSE ' + simulation.nudgeSense(notches).toFixed(2) + 'x');
    }
  }, { passive: false });

  // ---------------------------------------------------------------- resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    width = window.innerWidth;
    height = window.innerHeight;
    renderer.setSize(width, height);
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      
      resizeTextCanvas(width, height);
fx.setSize(width, height);
      simulation.resize(width, height);
    }, 200);
  });

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let elapsed = 0;

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    env.glitch = held.glitch ? 1 : Math.max(0, env.glitch - dt * 2.5);
    env.invert = Math.max(0, env.invert - dt * 3.0);
    env.aberration *= Math.exp(-dt * 6);
    env.flash *= Math.exp(-dt * 7);
    env.bloom *= Math.exp(-dt * 4);
    env.shake *= Math.exp(-dt * 8);
    spring(zoom, 1, 220, 14, dt);
    spring(rot, rot.target, 120, 12, dt);

    const p = fx.params;
    p.time = elapsed;
    p.bloom = BASE_BLOOM + env.bloom;
    p.glitch = env.glitch;
    p.zoom = zoom.x;
    p.rot = rot.x;
    p.aberration = env.aberration;
    p.invert = env.invert;
    p.flash = env.flash;
    p.shake.set((Math.random() - 0.5) * env.shake * 0.03, (Math.random() - 0.5) * env.shake * 0.03);

    simulation.stepSimulation(dt, elapsed);
    fx.render(scene, camera);
  }

  animate();
}

main();