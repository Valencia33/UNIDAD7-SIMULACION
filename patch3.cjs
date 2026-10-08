const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf-8');

// 1. Fix fragment shader
code = code.replace(
  "if(uv.x < 0.0 || uv.x > 1.0) discard; float textA = texture2D(tText, uv).r;",
  "float textA = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? 0.0 : texture2D(tText, uv).r;"
);

// 2. Fix lyricsState
code = code.replace(
  "const lyricsState = { dumbest: false, girl: false, alive: false, stupid: false, high: false, smarter: false, science: false };",
  "const lyricsState = { dumbest: false, girl: false, alive: false, text: false, cry: false };"
);

// 3. Fix updateText lines
const oldLines = `    if (lyricsState.science) lines.push("SCIENCE");
    if (lyricsState.stupid) lines.push("STUPID");
    if (lyricsState.high) lines.push("HIGH");
    if (lyricsState.smarter) lines.push("SMARTER");
    if (lyricsState.dumbest) lines.push("DUMBEST");
    if (lyricsState.girl) lines.push("GIRL");
    if (lyricsState.alive) lines.push("ALIVE");`;

const newLines = `    if (lyricsState.text) lines.push("TEXT");
    if (lyricsState.cry) lines.push("CRY");
    if (lyricsState.dumbest) lines.push("DUMBEST");
    if (lyricsState.girl) lines.push("GIRL");
    if (lyricsState.alive) lines.push("ALIVE");`;
code = code.replace(oldLines, newLines);

// 4. Fix keydown
const oldKeydown = `    const punchLyric = (prop) => { lyricsState[prop] = true; updateText(); env.bloom = Math.max(env.bloom, 0.4); env.shake = Math.max(env.shake, 0.2); };
    if (key === 'y') punchLyric('science');
    if (key === 'u') punchLyric('stupid');
    if (key === 'i') punchLyric('high');
    if (key === 'o') punchLyric('smarter');
    if (key === 'j') punchLyric('dumbest');
    if (key === 'k') punchLyric('girl');
    if (key === 'l') punchLyric('alive');
    if (key === 'm') { textMode = textMode === 1 ? 2 : 1; updateText(); flashStatus(textMode === 1 ? 'SOLID LYRICS' : 'MASK LYRICS'); }`;

const newKeydown = `    const punchLyric = (prop) => { lyricsState[prop] = true; updateText(); env.bloom = Math.max(env.bloom, 0.4); env.shake = Math.max(env.shake, 0.2); };
    if (key === 't') punchLyric('text');
    if (key === 'y') punchLyric('cry');
    if (key === 'j') punchLyric('dumbest');
    if (key === 'k') punchLyric('girl');
    if (key === 'l') punchLyric('alive');
    if (key === 'm') { textMode = textMode === 1 ? 2 : 1; updateText(); flashStatus(textMode === 1 ? 'SOLID LYRICS' : 'MASK LYRICS'); }`;
code = code.replace(oldKeydown, newKeydown);

// 5. Fix keyup
const oldKeyup = `    const releaseLyric = (prop) => { lyricsState[prop] = false; updateText(); };
    if (key === 'y') releaseLyric('science');
    if (key === 'u') releaseLyric('stupid');
    if (key === 'i') releaseLyric('high');
    if (key === 'o') releaseLyric('smarter');
    if (key === 'j') releaseLyric('dumbest');
    if (key === 'k') releaseLyric('girl');
    if (key === 'l') releaseLyric('alive');`;

const newKeyup = `    const releaseLyric = (prop) => { lyricsState[prop] = false; updateText(); };
    if (key === 't') releaseLyric('text');
    if (key === 'y') releaseLyric('cry');
    if (key === 'j') releaseLyric('dumbest');
    if (key === 'k') releaseLyric('girl');
    if (key === 'l') releaseLyric('alive');`;
code = code.replace(oldKeyup, newKeyup);

fs.writeFileSync('src/main.js', code, 'utf-8');
console.log('patched');
