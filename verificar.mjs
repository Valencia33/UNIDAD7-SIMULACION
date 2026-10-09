// Simula un servido completo a varias alturas y comprueba las tres consecuencias del modelo.
import assert from 'node:assert';
import { pour, grade, emitir, FINGER, FULL } from './src/modelo.js';
import { createFluid } from './src/fluido.js';

const serve = h => { const g = { level: 0, foam: 0 }; while (!pour(g, h, 1 / 60)); return g; };

for (const h of [0.1, 0.3, 0.45, 0.6, 0.8, 1, 1.5, 2.5]) {
  const g = serve(h);
  console.log(`altura ${h.toFixed(2)} → ${(g.foam / FINGER).toFixed(1)} dedos de espuma → ${grade(g.foam)}`);
}
assert.equal(grade(serve(0.2).foam), 'plana');
assert.equal(grade(serve(0.6).foam), 'perfecta');
assert.equal(grade(serve(1.5).foam), 'espumosa');

// El fluido de partículas cumple la misma regla: se sirve en un vaso rectangular y se califica al llenarse.
const vaso = [{ x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0.4, y: 1 }, { x: 0, y: 1 }];
function serveFluid(h) {
  const f = createFluid([{ loops: [vaso], top: 1 }], { x0: -1, x1: 1.4, y0: -0.05, y1: 3 }), acc = { beer: 0, foam: 0 };
  for (let t = 0; t < 10; t += 1 / 60) {
    const out = emitir(acc, h, 1 / 60, f.cap[0]);
    for (let k = 0; k < out.beer + out.foam; k++) f.emit(0.2 + (Math.random() - 0.5) * 0.08, 1 + h, 0, -1, k >= out.beer);
    f.update(1 / 60);
    const inside = f.beer[0] + f.foam[0];
    if (inside / f.cap[0] >= FULL) return { verdict: grade(f.foam[0] / f.cap[0]), inside: inside / f.n, secs: t };
  }
  assert.fail(`desde ${h} el vaso nunca se llenó`);
}
for (const [h, expected] of [[0.2, 'plana'], [0.6, 'perfecta'], [1.5, 'espumosa']]) {
  const r = serveFluid(h);
  console.log(`fluido, altura ${h} → ${r.verdict} en ${r.secs.toFixed(1)} s (${Math.round(r.inside * 100)} % de las gotas ya dentro del vaso)`);
  assert.equal(r.verdict, expected);
  assert.ok(r.inside > 0.8, 'se está saliendo demasiada cerveza del vaso');
}
console.log('ok');
