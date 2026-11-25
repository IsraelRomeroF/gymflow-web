// SIN COPIAS DE LO COMPARTIDO (auditoría 8, D-40, bloque 4.10). Los tokens,
// los estilos comunes y las piezas de diseño viven UNA vez en `@gymflow/ui`
// (repo hermano `gymflow-ui`, enlazado con `link:../gymflow-ui`). Antes eran
// ocho archivos espejo copiados a mano en el panel y el portal y comparados
// por huella (`scripts/tokens-iguales.mjs`, retirado). Esta prueba falla si:
//   - vuelve a aparecer una copia local en su ruta de antes;
//   - una pieza común se vuelve a definir aquí (otra `useCarga`, otro `Dialog`…);
//   - `app/globals.css` deja de empezar por tokens.css y compartido.css del paquete
//     (en ese orden: es la cascada de siempre);
//   - `package.json` deja de enlazar el paquete hermano.
// Para cambiar una pieza común: se edita en gymflow-ui, una vez.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const raiz = new URL('..', import.meta.url).pathname;
const ANTES = ['app/tokens.css', 'app/compartido.css', 'components/compartido.tsx', 'components/dialogo.tsx', 'components/campos.tsx', 'lib/carga.tsx', 'lib/format.ts', 'lib/formulario.ts'];
const PIEZAS = ['useCarga', 'EstadoCarga', 'useFormulario', 'CampoFecha', 'CampoHora', 'Dialog', 'Badge', 'Callout', 'ErrorCarga', 'Empty', 'Skeleton', 'IconTile', 'IconButton', 'Button', 'pesos', 'fijarZona'];
let mal = false;
const falla = (m) => { console.error(`FALLA: ${m}`); mal = true; };

for (const r of ANTES) if (existsSync(join(raiz, r))) falla(`${r} volvió a existir: lo compartido vive en @gymflow/ui (gymflow-ui/src), no se copia`);

const fuentes = (d) => !existsSync(d) ? [] : readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? fuentes(p) : /\.(tsx?|css)$/.test(n) ? [p] : [];
});
const definicion = new RegExp(`(?:function|const|class)\\s+(${PIEZAS.join('|')})\\b(?!\\w)`);
for (const f of ['app', 'components', 'lib', 'modules'].flatMap((d) => fuentes(join(raiz, d)))) {
  const texto = readFileSync(f, 'utf8');
  const m = f.endsWith('.css') ? null : texto.match(definicion);
  if (m) falla(`${f.slice(raiz.length)} define «${m[1]}», que es de @gymflow/ui: impórtalo de ahí`);
  if (f.endsWith('.css') && /--c-badge-h\s*:\s*24px; --c-badge-weight/.test(texto)) falla(`${f.slice(raiz.length)} parece una copia de compartido.css`);
}

const imports = [...readFileSync(join(raiz, 'app/globals.css'), 'utf8').matchAll(/^@import\s+'([^']+)';/gm)].map((m) => m[1]);
if (imports[0] !== '@gymflow/ui/tokens.css' || imports[1] !== '@gymflow/ui/compartido.css') {
  falla(`app/globals.css debe empezar con @import '@gymflow/ui/tokens.css'; y @import '@gymflow/ui/compartido.css'; (encontré: ${imports.slice(0, 2).join(', ') || 'nada'})`);
}
const dep = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).dependencies?.['@gymflow/ui'];
if (dep !== 'link:../gymflow-ui') falla(`package.json: "@gymflow/ui" debe ser "link:../gymflow-ui" (es ${dep ?? 'nada'})`);

if (mal) process.exit(1);
console.log(`lo compartido viene de @gymflow/ui: sin copias locales (${ANTES.length} rutas de antes vacías), globals.css lo importa primero`);
