// Tope de estilos en línea (UX7 sistema 6): el aspecto vive en CSS y en las
// utilidades de app/compartido.css. Este número solo puede bajar: si quitas
// estilos en línea, bájalo aquí también.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const TOPE = 87; // 2.12 (2026-11-21): 189 → 87, el valor real tras las fases 1 y 2 (1.5 lo había dejado en 189).
const raiz = new URL('..', import.meta.url).pathname;
const archivos = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? archivos(p) : p.endsWith('.tsx') ? [p] : []; });
const n = ['app', 'components'].flatMap((d) => archivos(join(raiz, d))).reduce((a, f) => a + (readFileSync(f, 'utf8').match(/style=\{\{/g) ?? []).length, 0);
if (n > TOPE) { console.error(`FALLA: ${n} estilos en línea (tope ${TOPE}). Usa una clase o una utilidad de compartido.css.`); process.exit(1); }
console.log(`estilos en línea: ${n} (tope ${TOPE})`);
