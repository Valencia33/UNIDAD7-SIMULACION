// Fluido 2D por partículas: "relajación de doble densidad" (Clavet, Beaudoin y Poulin, 2005).
// Vive en el plano de la palabra (x, y). Cada letra es un vaso abierto solo por arriba:
// su forma decide por dónde entra, cómo corre y por dónde se rebosa la cerveza.
// No usa three.js, así se puede probar en node: npm run verificar

export const STEP = 1 / 240;  // paso fijo de la simulación (s)
export const H = 0.07;        // radio de interacción entre partículas (alturas de letra)
export const AREA = 0.00085;  // área que ocupa una partícula en reposo: define cuántas llenan una letra
export const G = 25;          // gravedad (alturas de letra / s²)
const REST = 2.2, K = 0.008, K_NEAR = 0.02; // densidad de reposo, presión y presión cercana (tensión superficial)
const SIGMA = 0.25;           // viscosidad
export const MOUTH = 0.07;           // la boca del vaso: todo borde a menos de esta distancia de arriba está abierto (la B recibe también por lo alto de su curva)
const WALL = 0.02, R = 0.012; // grosor del vidrio y radio de una partícula dentro del vaso
const R_OUT = 0.004;          // por fuera es más delgada: así escurre por las ranuras entre letras
const SINK = 1.6;             // segundos que dura la cerveza suelta quieta (charco, ranura) antes de filtrarse
const VMAX = 0.06;            // velocidad máxima por paso, para que nada atraviese el vidrio
const MAX = 4000;
// Un vaso quieto se duerme: sus gotas dejan de calcularse hasta que algo lo toca (chorro, ola, trago).
// Así el costo depende de lo que se mueve, no de cuánta cerveza hay servida.
const SLEEP_V = 0.45;         // velocidad media (alturas de letra / s) bajo la cual el vaso se considera quieto
const SLEEP_AFTER = 0.6;      // segundos quieto y sin recibir cerveza antes de dormirse

// cups: [{ loops: [[{x, y}, ...], ...], top }]  (contorno exterior y huecos de cada letra)
// bounds: { x0, x1, y0, y1 } región donde existe el fluido; lo que sale de ahí desaparece
export function createFluid(cups, bounds) {
  const X = new Float32Array(MAX), Y = new Float32Array(MAX), PX = new Float32Array(MAX), PY = new Float32Array(MAX);
  const VX = new Float32Array(MAX), VY = new Float32Array(MAX), AGE = new Float32Array(MAX);
  const FOAM = new Uint8Array(MAX), CUP = new Int8Array(MAX);
  const FRESH = new Uint8Array(MAX); // recién salida de la lata: cae sola, sin empujar ni pegarse, hasta que toca algo
  const beer = new Int32Array(cups.length), foam = new Int32Array(cups.length);
  const awake = new Uint8Array(cups.length).fill(1), calm = new Float32Array(cups.length), entered = new Uint8Array(cups.length), speed2 = new Float32Array(cups.length);
  const asleep = i => CUP[i] >= 0 && !awake[CUP[i]];
  let n = 0, acc = 0, landed = 0; // landed: gotas que acaban de caer a la arena (para el sonido)

  // ---- Campo de distancia con signo: negativo dentro de una letra, positivo fuera ----
  // Lo más alto de cada letra no es pared: es la boca del vaso.
  const CELL = 0.008, MARGIN = 0.15;
  const bx0 = Math.min(...cups.flatMap(c => c.loops[0].map(p => p.x))) - MARGIN, by0 = -MARGIN;
  const bx1 = Math.max(...cups.flatMap(c => c.loops[0].map(p => p.x))) + MARGIN, by1 = Math.max(...cups.map(c => c.top)) + MARGIN;
  const SW = Math.ceil((bx1 - bx0) / CELL) + 1, SH = Math.ceil((by1 - by0) / CELL) + 1;
  const sd = new Float32Array(SW * SH).fill(MARGIN), id = new Int8Array(SW * SH).fill(-1);
  const segDist = (x, y, ax, ay, bx, by) => {
    const ex = bx - ax, ey = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
    return Math.hypot(x - ax - ex * t, y - ay - ey * t);
  };
  const inside = (x, y, loops) => loops.reduce((c, L) => L.reduce((c, a, i) => {
    const b = L[(i + 1) % L.length];
    return (a.y > y) !== (b.y > y) && x < a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y) ? !c : c;
  }, c), false);
  const cap = cups.map((c, k) => {
    const edges = c.loops.flatMap(L => L.map((a, i) => [a.x, a.y, L[(i + 1) % L.length].x, L[(i + 1) % L.length].y]));
    const open = e => e[1] > c.top - MOUTH && e[3] > c.top - MOUTH, walls = edges.filter(e => !open(e));
    const low = Math.min(...edges.filter(open).flatMap(e => [e[1], e[3]])); // lo más bajo de la boca: hasta ahí se puede llenar
    const xs = c.loops[0].map(p => p.x), i0 = Math.max(0, Math.floor((Math.min(...xs) - MARGIN - bx0) / CELL)), i1 = Math.min(SW - 1, Math.ceil((Math.max(...xs) + MARGIN - bx0) / CELL));
    let room = 0;
    for (let j = 0; j < SH; j++) for (let i = i0; i <= i1; i++) {
      const x = bx0 + i * CELL, y = by0 + j * CELL;
      let d = MARGIN; for (const w of walls) d = Math.min(d, segDist(x, y, ...w));
      const s = inside(x, y, c.loops) ? -d : d;
      if (s < sd[j * SW + i]) { sd[j * SW + i] = s; if (s < 0) id[j * SW + i] = k; }
      if (s < -(WALL + R) && y < low) room++;
    }
    return Math.round(room * CELL * CELL / AREA); // partículas que llenan esta letra
  });
  const sdf = (x, y) => {
    const gx = (x - bx0) / CELL, gy = (y - by0) / CELL;
    if (gx < 0 || gy < 0 || gx >= SW - 1 || gy >= SH - 1) return MARGIN;
    const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, k = j * SW + i;
    return (sd[k] * (1 - fx) + sd[k + 1] * fx) * (1 - fy) + (sd[k + SW] * (1 - fx) + sd[k + SW + 1] * fx) * fy;
  };
  const cupAt = (x, y) => {
    const i = Math.round((x - bx0) / CELL), j = Math.round((y - by0) / CELL);
    return i < 0 || j < 0 || i >= SW || j >= SH ? -1 : id[j * SW + i];
  };

  // ---- Rejilla de vecinos (celdas del tamaño de H) ----
  const cols = Math.ceil((bounds.x1 - bounds.x0) / H), rows = Math.ceil((bounds.y1 - bounds.y0) / H);
  const start = new Int32Array(cols * rows + 1), cellOf = new Int32Array(MAX), sorted = new Int32Array(MAX);
  const cell = i => Math.min(rows - 1, Math.max(0, ((Y[i] - bounds.y0) / H) | 0)) * cols + Math.min(cols - 1, Math.max(0, ((X[i] - bounds.x0) / H) | 0));
  function buildGrid() {
    start.fill(0);
    for (let i = 0; i < n; i++) start[(cellOf[i] = cell(i)) + 1]++;
    for (let c = 0; c < cols * rows; c++) start[c + 1] += start[c];
    const fill = start.slice(0, -1);
    for (let i = 0; i < n; i++) sorted[fill[cellOf[i]]++] = i;
  }
  const NB = new Int32Array(256), NQ = new Float32Array(256), NX = new Float32Array(256), NY = new Float32Array(256);
  function neighbors(i) { // llena NB/NQ/NX/NY con los vecinos a menos de H; devuelve cuántos
    let m = 0;
    const c = cellOf[i], cx = c % cols, cy = (c / cols) | 0;
    for (let gy = Math.max(0, cy - 1); gy <= Math.min(rows - 1, cy + 1); gy++)
      for (let gx = Math.max(0, cx - 1); gx <= Math.min(cols - 1, cx + 1); gx++)
        for (let s = start[gy * cols + gx], e = start[gy * cols + gx + 1]; s < e && m < 256; s++) {
          const j = sorted[s]; if (j === i || FRESH[j]) continue;
          const dx = X[j] - X[i], dy = Y[j] - Y[i], r2 = dx * dx + dy * dy;
          if (r2 >= H * H || r2 < 1e-12) continue;
          const r = Math.sqrt(r2);
          NB[m] = j; NQ[m] = 1 - r / H; NX[m] = dx / r; NY[m] = dy / r; m++;
        }
    return m;
  }

  function remove(i) {
    n--;
    X[i] = X[n]; Y[i] = Y[n]; PX[i] = PX[n]; PY[i] = PY[n]; VX[i] = VX[n]; VY[i] = VY[n];
    AGE[i] = AGE[n]; FOAM[i] = FOAM[n]; CUP[i] = CUP[n]; FRESH[i] = FRESH[n];
  }

  function step() {
    // 1. gravedad y predicción (velocidades en alturas de letra por paso)
    for (let i = 0; i < n; i++) {
      if (asleep(i)) { PX[i] = X[i]; PY[i] = Y[i]; continue; }
      VY[i] -= G * STEP * STEP;
      const v2 = VX[i] * VX[i] + VY[i] * VY[i]; if (v2 > VMAX * VMAX) { const k = VMAX / Math.sqrt(v2); VX[i] *= k; VY[i] *= k; }
      PX[i] = X[i]; PY[i] = Y[i]; X[i] += VX[i]; Y[i] += VY[i];
    }
    // 2. relajación de doble densidad: presión (no se comprime), presión cercana (no se pega ni se apila)
    //    y viscosidad (frena a los vecinos que se acercan), todo como desplazamientos
    buildGrid();
    for (let i = 0; i < n; i++) {
      if (asleep(i)) continue; // dormida: no empuja, pero sus vecinas despiertas sí la sienten
      const m = neighbors(i);
      if (FRESH[i]) { for (let k = 0; k < m; k++) if (NQ[k] > 0.5) { FRESH[i] = 0; break; } continue; } // el chorro llega al líquido
      let rho = 0, near = 0;
      for (let k = 0; k < m; k++) { const q = NQ[k]; rho += q * q; near += q * q * q; }
      const P = K * (rho - REST), PN = K_NEAR * near;
      let dx = 0, dy = 0;
      for (let k = 0; k < m; k++) {
        const q = NQ[k], j = NB[k], u = (VX[i] - VX[j]) * NX[k] + (VY[i] - VY[j]) * NY[k];
        const D = (P * q + PN * q * q + (u > 0 ? SIGMA * q * u : 0)) * 0.5;
        if (!asleep(j)) { X[j] += D * NX[k]; Y[j] += D * NY[k]; }
        dx -= D * NX[k]; dy -= D * NY[k];
      }
      X[i] += dx; Y[i] += dy;
    }
    // 4. vidrio, boca de cada vaso, arena
    beer.fill(0); foam.fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let c = CUP[i];
      if (asleep(i)) { (FOAM[i] ? foam : beer)[c]++; continue; }
      const s = sdf(X[i], Y[i]);
      if (c < 0 && s < -(WALL + R)) { const k = cupAt(X[i], Y[i]); if (k >= 0) { CUP[i] = c = k; FRESH[i] = 0; entered[k] = 1; awake[k] = 1; } } // entró por la boca: lo despierta
      if (c >= 0 && (Y[i] > cups[c].top || s > 0)) CUP[i] = c = -1; // salió por la boca: se rebosa
      const lim = c >= 0 ? -(WALL + R) : R_OUT;
      if (c >= 0 ? s > lim : s < lim) { // empuja fuera de la pared, en la dirección del campo
        const e = CELL, gx = sdf(X[i] + e, Y[i]) - sdf(X[i] - e, Y[i]), gy = sdf(X[i], Y[i] + e) - sdf(X[i], Y[i] - e), g = Math.sqrt(gx * gx + gy * gy) || 1;
        X[i] -= (s - lim) * gx / g; Y[i] -= (s - lim) * gy / g; FRESH[i] = 0;
      }
      if (Y[i] < R) { if (PY[i] > R + 0.004) landed++; Y[i] = R; X[i] = PX[i] + (X[i] - PX[i]) * 0.7; FRESH[i] = 0; } // arena: frena
      if (c < 0 && (Y[i] < R + 0.01 || VX[i] * VX[i] + VY[i] * VY[i] < (0.2 * STEP) ** 2)) AGE[i] += STEP; // en la arena o quieta
      if (AGE[i] > SINK || X[i] < bounds.x0 || X[i] > bounds.x1 || Y[i] > bounds.y1 + 2) { remove(i); continue; }
      if (c >= 0) (FOAM[i] ? foam : beer)[c]++;
    }
    // 5. la velocidad es lo que de verdad se movió
    speed2.fill(0);
    for (let i = 0; i < n; i++) {
      VX[i] = X[i] - PX[i]; VY[i] = Y[i] - PY[i];
      if (CUP[i] >= 0) speed2[CUP[i]] += VX[i] * VX[i] + VY[i] * VY[i];
    }
    // 6. dormir los vasos quietos
    for (let c = 0; c < cups.length; c++) {
      if (!awake[c]) continue;
      const count = beer[c] + foam[c], quiet = !entered[c] && (!count || speed2[c] / count < (SLEEP_V * STEP) ** 2);
      calm[c] = quiet ? calm[c] + STEP : 0;
      if (calm[c] > SLEEP_AFTER) awake[c] = 0;
    }
    entered.fill(0);
  }

  return {
    X, Y, VX, VY, FOAM, CUP, AGE, beer, foam, cap, awake, SINK, STEP,
    get n() { return n; },
    takeLanded() { const k = landed; landed = 0; return k; },
    emit(x, y, vx, vy, isFoam) { // velocidad en alturas de letra por segundo
      if (n >= MAX) return;
      X[n] = x + (Math.random() - 0.5) * R; Y[n] = y + (Math.random() - 0.5) * R;
      VX[n] = vx * STEP; VY[n] = vy * STEP; AGE[n] = 0; FOAM[n] = isFoam ? 1 : 0; CUP[n] = -1; FRESH[n] = 1; n++;
    },
    update(dt) { acc = Math.min(acc + dt, 8 * STEP); while (acc >= STEP) { step(); acc -= STEP; } },
    kick(strength) { // la ola despierta todos los vasos
      awake.fill(1); calm.fill(0);
      for (let i = 0; i < n; i++) if (CUP[i] >= 0) { VX[i] += (Math.random() - 0.5) * strength * STEP; VY[i] += strength * 0.5 * STEP; }
    },
    drain(c, count) { // se toma desde arriba; devuelve cuántas gotas se tomó
      const top = []; for (let i = 0; i < n; i++) if (CUP[i] === c) top.push(i);
      const gone = top.sort((a, b) => Y[b] - Y[a]).slice(0, count).sort((a, b) => b - a);
      gone.forEach(remove);
      return gone.length;
    },
  };
}
