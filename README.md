# UNIDAD 7 — BAHÍA: servida como se merece

[App desplegada](https://valencia33.github.io/UNIDAD7-SIMULACION/)

```bash
npm install
npm run dev        # abre la pieza en http://localhost:5173
npm run verificar  # simula servidos a varias alturas y comprueba el modelo
```

- `src/modelo.js`: reglas del servido (altura → espuma) y sus parámetros.
- `src/fluido.js`: la cerveza como fluido de partículas (relajación de doble densidad); cada letra es un vaso abierto por arriba. Un vaso quieto se duerme (`SLEEP_V`, `SLEEP_AFTER`) y solo se recalcula cuando algo lo toca.
- `src/bahia.js`: escena, lata con rig, interacción y resortes. La lata choca con la arena y con el vidrio (`CLEAR`), se inclina según dónde cae el chorro (`landing`) y el vaso brilla cuando se sirve a la altura justa.
- `src/playa.js`: atardecer, mar y arena con desplazamiento, olas que chocan con las letras (forma de cada estela en `WAKES`), montoncitos de arena contra la base de las letras, hechos con el mismo piso (`moundH`), salpicaduras y posprocesado.
- `src/personaje.js`: la personalidad de la lata: acciones para invitar a agarrarla y reacciones (susto, celebración).
- `src/sonido.js`: todo el sonido, sintetizado con Web Audio (sin archivos), y una cumbia original que entra por capas a medida que la borrachera sube. La tecla M silencia.

Cada ronda que se toman suma cervezas: la imagen se ve cada vez más borracha (playa.js, `uDrunk`) y la cumbia suma instrumentos. `DRUNK_PER` en bahia.js decide qué tan rápido.
