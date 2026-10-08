// Simula un servido completo a varias alturas y comprueba las tres consecuencias del modelo.
import assert from 'node:assert';
import { pour, grade, FINGER } from './modelo.js';

const serve = h => { const g = { level: 0, foam: 0 }; while (!pour(g, h, 1 / 60)); return g; };

for (const h of [0.1, 0.3, 0.45, 0.6, 0.8, 1, 1.5, 2.5]) {
  const g = serve(h);
  console.log(`altura ${h.toFixed(2)} → ${(g.foam / FINGER).toFixed(1)} dedos de espuma → ${grade(g.foam)}`);
}
assert.equal(grade(serve(0.2).foam), 'plana');
assert.equal(grade(serve(0.6).foam), 'perfecta');
assert.equal(grade(serve(1.5).foam), 'espumosa');
console.log('ok');
