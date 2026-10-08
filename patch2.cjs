const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf-8');

// We will completely replace the LYRICS OVERLAY setup and the keyboard events.

const startLyrics = code.indexOf('// --- LYRICS OVERLAY ---');
const endLyrics = code.indexOf('// ---------------------------------------------------------------- keyboard');

const newLyrics = `
  // --- LYRICS OVERLAY ---
  const textCanvas = document.createElement('canvas');
  textCanvas.width = 2048;
  textCanvas.height = 2048; // Fixed size to prevent resize bugs
  const tCtx = textCanvas.getContext('2d');
  const textTexture = new THREE.CanvasTexture(textCanvas);
  textTexture.minFilter = THREE.LinearFilter;
  
  const lyricsState = { dumbest: false, girl: false, alive: false, stupid: false, high: false, smarter: false, science: false };
  let textMode = 2; // 1 = Solid, 2 = Mask

  const textMat = new THREE.ShaderMaterial({
    uniforms: {
      tText: { value: textTexture },
      uMode: { value: 0.0 },
      uColor: { value: new THREE.Color('#e01b24') }, // Punchy Red
      uAspect: { value: 1.0 }
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tText; uniform float uMode; uniform vec3 uColor; uniform float uAspect; varying vec2 vUv; void main() { if (uMode == 0.0) discard; vec2 uv = vec2((vUv.x - 0.5) * uAspect + 0.5, vUv.y); if(uv.x < 0.0 || uv.x > 1.0) discard; float textA = texture2D(tText, uv).r; float alpha = uMode == 1.0 ? textA : (1.0 - textA); if (alpha < 0.01) discard; gl_FragColor = vec4(uColor, alpha); }',
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
    if (lyricsState.science) lines.push("SCIENCE");
    if (lyricsState.stupid) lines.push("STUPID");
    if (lyricsState.high) lines.push("HIGH");
    if (lyricsState.smarter) lines.push("SMARTER");
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

`;

code = code.substring(0, startLyrics) + newLyrics + code.substring(endLyrics);

// Fix keydown
const startKeydown = code.indexOf("if (key === 'j') { lyricsState.dumbest = true;");
const endKeydown = code.indexOf("if (key === 'r') {");
const newKeydown = `
    const punchLyric = (prop) => { lyricsState[prop] = true; updateText(); env.bloom = Math.max(env.bloom, 0.4); env.shake = Math.max(env.shake, 0.2); };
    if (key === 'y') punchLyric('science');
    if (key === 'u') punchLyric('stupid');
    if (key === 'i') punchLyric('high');
    if (key === 'o') punchLyric('smarter');
    if (key === 'j') punchLyric('dumbest');
    if (key === 'k') punchLyric('girl');
    if (key === 'l') punchLyric('alive');
    if (key === 'm') { textMode = textMode === 1 ? 2 : 1; updateText(); flashStatus(textMode === 1 ? 'SOLID LYRICS' : 'MASK LYRICS'); }
`;
code = code.substring(0, startKeydown) + newKeydown + code.substring(endKeydown);

// Fix keyup
const startKeyup = code.indexOf("if (key === 'j') { lyricsState.dumbest = false;");
const endKeyup = code.indexOf("if (key === 'q') simulation.hold('implode', false);");
const newKeyup = `
    const releaseLyric = (prop) => { lyricsState[prop] = false; updateText(); };
    if (key === 'y') releaseLyric('science');
    if (key === 'u') releaseLyric('stupid');
    if (key === 'i') releaseLyric('high');
    if (key === 'o') releaseLyric('smarter');
    if (key === 'j') releaseLyric('dumbest');
    if (key === 'k') releaseLyric('girl');
    if (key === 'l') releaseLyric('alive');
`;
code = code.substring(0, startKeyup) + newKeyup + code.substring(endKeyup);

fs.writeFileSync('src/main.js', code, 'utf-8');
