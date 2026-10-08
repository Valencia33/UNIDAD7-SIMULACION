const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf-8');

const insertPoint1 = code.indexOf('// ---------------------------------------------------------------- keyboard');
const setupCode = `
  // --- LYRICS OVERLAY ---
  const textCanvas = document.createElement('canvas');
  const tCtx = textCanvas.getContext('2d');
  const textTexture = new THREE.CanvasTexture(textCanvas);
  textTexture.minFilter = THREE.LinearFilter;
  
  const lyricsState = { dumbest: false, girl: false, alive: false };
  let textMode = 2; // 1 = Solid, 2 = Mask

  const textMat = new THREE.ShaderMaterial({
    uniforms: {
      tText: { value: textTexture },
      uMode: { value: 0.0 },
      uColor: { value: new THREE.Color('#e01b24') } // Punchy Red
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tText; uniform float uMode; uniform vec3 uColor; varying vec2 vUv; void main() { if (uMode == 0.0) discard; float textA = texture2D(tText, vUv).r; float alpha = uMode == 1.0 ? textA : (1.0 - textA); if (alpha < 0.01) discard; gl_FragColor = vec4(uColor, alpha); }',
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
    
    const fontSize = Math.floor(textCanvas.height * 0.28);
    tCtx.font = '900 ' + fontSize + 'px "Arial Black", Impact, sans-serif';
    tCtx.textAlign = 'center';
    tCtx.textBaseline = 'middle';
    
    if (lyricsState.dumbest) tCtx.fillText('DUMBEST', textCanvas.width / 2, textCanvas.height * 0.23);
    if (lyricsState.girl) tCtx.fillText('GIRL', textCanvas.width / 2, textCanvas.height * 0.50);
    if (lyricsState.alive) tCtx.fillText('ALIVE', textCanvas.width / 2, textCanvas.height * 0.77);

    textTexture.needsUpdate = true;
    const anyActive = lyricsState.dumbest || lyricsState.girl || lyricsState.alive;
    textMat.uniforms.uMode.value = anyActive ? textMode : 0.0;
  }
  
  function resizeTextCanvas(w, h) {
    textCanvas.width = 2048;
    textCanvas.height = Math.floor(2048 * (h / w));
    updateText();
  }
  resizeTextCanvas(width, height);

`;
code = code.slice(0, insertPoint1) + setupCode + code.slice(insertPoint1);

const insertPoint2 = code.indexOf("if (key === 'r') {");
const keydownCode = `
    if (key === 'j') { lyricsState.dumbest = true; updateText(); env.bloom = Math.max(env.bloom, 0.4); env.shake = Math.max(env.shake, 0.2); }
    if (key === 'k') { lyricsState.girl = true; updateText(); env.bloom = Math.max(env.bloom, 0.4); env.shake = Math.max(env.shake, 0.2); }
    if (key === 'l') { lyricsState.alive = true; updateText(); env.bloom = Math.max(env.bloom, 0.4); env.shake = Math.max(env.shake, 0.2); }
    if (key === 'm') { textMode = textMode === 1 ? 2 : 1; updateText(); flashStatus(textMode === 1 ? 'SOLID LYRICS' : 'MASK LYRICS'); }
`;
code = code.slice(0, insertPoint2) + keydownCode + code.slice(insertPoint2);

const insertPoint3 = code.indexOf("if (key === 'q') simulation.hold('implode', false);");
const keyupCode = `
    if (key === 'j') { lyricsState.dumbest = false; updateText(); }
    if (key === 'k') { lyricsState.girl = false; updateText(); }
    if (key === 'l') { lyricsState.alive = false; updateText(); }
`;
code = code.slice(0, insertPoint3) + keyupCode + code.slice(insertPoint3);

const insertPoint4 = code.indexOf('fx.setSize(width, height);');
const resizeCode = `
      resizeTextCanvas(width, height);
`;
code = code.slice(0, insertPoint4) + resizeCode + code.slice(insertPoint4);

fs.writeFileSync('src/main.js', code, 'utf-8');
console.log('patched');
