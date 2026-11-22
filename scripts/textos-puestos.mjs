// Puestos retirados (ADR-039 §8) no se mencionan en lo que ve el usuario (DP-08).
// Busca en el texto visible del panel; los comentarios de código no cuentan.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROHIBIDO = [/gerencia general/i, /poder de gerencia/i, /encargad[oa] de sucursal/i, /\bprofesor(a|es)?\b/i, /\bcajer[oa]\b/i, /due[ñn]a o due[ñn]o/i];
const RAICES = ['app', 'components', 'lib'];
const archivos = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? archivos(p) : /\.(tsx?|md)$/.test(n) ? [p] : []; });
const hallazgos = [];
for (const raiz of RAICES) for (const f of archivos(raiz)) {
  const lineas = readFileSync(f, 'utf8').split('\n');
  lineas.forEach((l, i) => {
    const sinComentario = l.replace(/\/\/.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '').replace(/^\s*\*.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (PROHIBIDO.some((re) => re.test(sinComentario))) hallazgos.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`);
  });
}
if (hallazgos.length) { console.error(`Textos de puestos retirados (${hallazgos.length}):\n${hallazgos.join('\n')}`); process.exit(1); }
console.log('textos de puestos: limpio');
