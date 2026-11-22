// Archivos ESPEJO entre el panel y el portal (UX 2026-10-08; auditoría 8, fase 1.5): deben ser idénticos.
//   app/tokens.css            colores, alturas, movimiento
//   app/compartido.css        estilos de los componentes compartidos (y de los campos de fecha y hora)
//   components/compartido.tsx Badge, Callout, ErrorCarga, Empty, Skeleton, IconTile, IconButton
//   components/dialogo.tsx    Dialog: en document.body, teclado y foco; en el portal, la hoja inferior (26-03, 26-14)
//   components/campos.tsx     CampoFecha y CampoHora: día/mes/año y hora de 24 sin depender del equipo (26-06, D26-02)
//   lib/carga.tsx             useCarga y EstadoCarga: cargas con sus tres estados (26-01)
//   lib/format.ts             pesos, fechas y horas en la zona del gimnasio (26-06)
//   lib/formulario.ts         useFormulario: errores por campo y el foco al primero (26-02)
// En local compara con el repo hermano; en CI (sin hermano) compara con la huella guardada aquí.
// Para cambiar uno: edítalo, cópialo al otro repo y actualiza su huella en los DOS scripts.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
const HUELLAS = {
  'app/tokens.css': '0d00376c30c7aff0',
  'app/compartido.css': '6002317557fe4cee',
  'components/compartido.tsx': 'baac107126195b0f',
  'components/dialogo.tsx': '1a236e2971e98658',
  'components/campos.tsx': 'dc9ee9fd72a6b4a1',
  'lib/carga.tsx': 'b356a37773b9bcf3',
  'lib/format.ts': '7137b8cf4def9382',
  'lib/formulario.ts': 'b8b8b804ffc3bee6',
};
// El hermano se deduce de la carpeta, no del nombre del paquete (`@gymflow/portal` nunca era 'gymflow-portal',
// así que el portal se comparaba consigo mismo).
const otro = new URL('..', import.meta.url).pathname.replace(/\/$/, '').endsWith('gymflow-portal') ? 'gymflow-web' : 'gymflow-portal';
let mal = false;
for (const [ruta, huella] of Object.entries(HUELLAS)) {
  const aqui = readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
  const h = createHash('sha256').update(aqui).digest('hex').slice(0, 16);
  const hermano = new URL(`../../${otro}/${ruta}`, import.meta.url);
  if (existsSync(hermano) && readFileSync(hermano, 'utf8') !== aqui) { console.error(`FALLA: ${ruta} difiere del repo hermano (${otro})`); mal = true; }
  if (h !== huella) { console.error(`FALLA: ${ruta} cambió (huella ${h}); cópialo al repo hermano y actualiza su huella en ambos scripts`); mal = true; }
}
if (mal) process.exit(1);
console.log(`piezas compartidas (${Object.keys(HUELLAS).length} archivos espejo): iguales`);
