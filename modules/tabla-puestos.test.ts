/**
 * LA TABLA PUESTO × SECCIÓN, ESCRITA (27-10; bloque 1.17b).
 *
 * `registro.test.ts` comprueba que la puerta y el menú digan lo mismo y que
 * el registro no se separe del núcleo. Esta prueba fija el RESULTADO: qué ve
 * cada puesto en cada sección el día que entra por primera vez (sin que el
 * dueño le haya liberado ni quitado nada) y qué ve con todas las llaves.
 *
 * Si alguien mueve un permiso de puesto en el núcleo, cambia una llave o
 * agrega una sección, esta tabla deja de coincidir y hay que venir a decir,
 * renglón por renglón, que el cambio es el que se quería. Eso es lo que no
 * había el día del defecto 27-06.
 *
 *   pasa    · la ve en el menú y entra
 *   llave   · su puesto la trae, pero el dueño no se la ha liberado
 *   no      · su puesto no la ve («Tu rol no ve esta pantalla»)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '@gymflow/core';
import { SECCIONES, menuPara, respuestaDePuerta, type Mirada } from './registro.ts';

type Nucleo = {
  ROLE_PERMISSIONS: Record<string, readonly string[]>;
  LOCKABLE_SECTIONS: ReadonlyArray<{ key: string; defaultOpen?: boolean }>;
  lockedPermissions: (unlocked: readonly string[], roleKeys: readonly string[]) => ReadonlySet<string>;
};
const nucleo: Nucleo = core;

const PUESTOS = ['OWNER', 'MANAGER', 'RECEPTION', 'COACH'] as const;
type Celda = 'pasa' | 'llave' | 'no';

//                      sección             dueña    gerente  recepción coach
const TABLA: ReadonlyArray<readonly [string, Celda, Celda, Celda, Celda]> = [
  ['/panel',           'pasa',  'pasa',  'pasa',  'pasa'],
  ['/caja',            'pasa',  'pasa',  'pasa',  'no'],
  ['/estacion',        'no',    'pasa',  'pasa',  'no'],
  ['/punto-de-venta',  'no',    'pasa',  'pasa',  'no'],
  ['/socios',          'no',    'pasa',  'pasa',  'pasa'],
  ['/altas',           'no',    'pasa',  'pasa',  'no'],
  ['/prospectos',      'no',    'pasa',  'pasa',  'no'],
  ['/mensajes',        'no',    'pasa',  'pasa',  'no'],
  ['/clases',          'no',    'pasa',  'pasa',  'pasa'],
  ['/rutinas',         'no',    'pasa',  'no',    'pasa'],
  ['/acceso',          'no',    'pasa',  'pasa',  'no'],
  ['/precios',         'pasa',  'pasa',  'pasa',  'pasa'],
  ['/tablero',         'pasa',  'llave', 'no',    'no'],
  ['/movimientos',     'pasa',  'llave', 'no',    'no'],
  ['/retencion',       'no',    'llave', 'llave', 'no'],
  ['/planes',          'pasa',  'llave', 'llave', 'llave'],
  ['/productos',       'no',    'llave', 'no',    'no'],
  ['/personal',        'pasa',  'llave', 'no',    'no'],
  ['/importar',        'no',    'llave', 'no',    'no'],
  ['/sucursales',      'pasa',  'llave', 'no',    'no'],
  ['/modulos',         'pasa',  'llave', 'no',    'no'],
  // Lo que el gimnasio le paga a GymFlow: solo de su dueño, sin llave que la libere (D-37; 3.12).
  ['/cuenta-gymflow',  'pasa',  'no',    'no',    'no'],
  ['/autorizaciones',  'pasa',  'no',    'no',    'no'],
  ['/bitacora',        'pasa',  'llave', 'no',    'no'],
  ['/biometria',       'pasa',  'llave', 'no',    'no'],
  // La dueña lee los textos legales y firma el aviso de privacidad (3.7, D-25).
  ['/consentimientos', 'pasa',  'llave', 'llave', 'no'],
];

/** La sesión que arma la API para ese puesto: sus permisos menos lo que la llave cierra. */
function mirada(rol: string, liberadas: readonly string[]): Mirada {
  const fuera = nucleo.lockedPermissions(liberadas, [rol]);
  const permisos = new Set((nucleo.ROLE_PERMISSIONS[rol] ?? []).filter((p) => !fuera.has(p)));
  return { can: (p) => permisos.has(p), activo: () => true, roles: [rol], liberadas: rol === 'OWNER' ? null : liberadas };
}

const celda = (r: string): Celda => (r === 'pasa' ? 'pasa' : r === 'llave' ? 'llave' : 'no');

test('la tabla tiene un renglón por sección del registro, en su orden', () => {
  assert.deepEqual(TABLA.map((f) => f[0]), SECCIONES.map((s) => s.href));
});

test('el primer día (sin nada liberado): lo que ve cada puesto en cada sección', () => {
  const real = SECCIONES.map((s) => [s.href, ...PUESTOS.map((p) => celda(respuestaDePuerta(s, mirada(p, []))))]);
  assert.deepEqual(real, TABLA.map((f) => [...f]));
});

test('con todas las llaves: «llave» pasa a «pasa» y nada más cambia', () => {
  const todas = nucleo.LOCKABLE_SECTIONS.filter((s) => !s.defaultOpen).map((s) => s.key);
  const real = SECCIONES.map((s) => [s.href, ...PUESTOS.map((p) => celda(respuestaDePuerta(s, mirada(p, todas))))]);
  assert.deepEqual(real, TABLA.map((f) => f.map((c) => (c === 'llave' ? 'pasa' : c))));
});

test('el menú de cada puesto es exactamente su columna «pasa»', () => {
  PUESTOS.forEach((p, i) => {
    assert.deepEqual(menuPara(mirada(p, [])).map((s) => s.href), TABLA.filter((f) => f[i + 1] === 'pasa').map((f) => f[0]), p);
  });
});

test('una sección sin su módulo no la ve nadie, ni la dueña', () => {
  for (const p of PUESTOS) {
    const m: Mirada = { ...mirada(p, []), activo: () => false };
    assert.deepEqual(menuPara(m).map((s) => s.href), [], p);
  }
});

// ── EL MENÚ POR TAREA (bloque 2.1; 1-02, DA-22) ──────────────────────────────
// La tabla de arriba dice QUÉ ve cada puesto y no cambió. Esto fija CÓMO se
// acomoda: grupos por tarea para la gerencia y lista plana para los demás.
import { MENU_PLANO, MENU_POR_TAREA, MI_GIMNASIO, barraInferior, menuAcomodado } from './registro.ts';

const todasLasLlaves = nucleo.LOCKABLE_SECTIONS.filter((s) => !s.defaultOpen).map((s) => s.key);
const rutasDe = (gs: ReturnType<typeof menuAcomodado>) => gs.flatMap((g) => g.secciones.map((s) => s.href));

// «Mi gimnasio» (2.12): Sucursales y Módulos son UNA entrada del menú, que lleva a `/gimnasio` (o a `/modulos` si solo ve Módulos).
const comoEnElMenu = (hrefs: string[]) => {
  const suyas = hrefs.filter((h) => (MI_GIMNASIO.de as readonly string[]).includes(h));
  const resto = hrefs.filter((h) => !suyas.includes(h));
  return suyas.length === 0 ? resto : [...resto, suyas.includes('/sucursales') ? '/gimnasio' : '/modulos'];
};

test('acomodar el menú no agrega ni quita nada: son las secciones de `menuPara`, una vez cada una, con Sucursales y Módulos juntas en «Mi gimnasio»', () => {
  for (const p of PUESTOS) for (const llaves of [[], todasLasLlaves, ['sucursales'], ['modulos']]) {
    const m = mirada(p, llaves);
    assert.deepEqual([...rutasDe(menuAcomodado(m))].sort(), comoEnElMenu(menuPara(m).map((s) => s.href)).sort(), `${p} con ${llaves.join(',') || 'nada'}`);
  }
});

test('«Mi gimnasio» es una entrada: lleva a Datos si ve Sucursales, a Módulos si solo ve Módulos, y queda marcada en sus tres rutas', () => {
  const entrada = (llaves: readonly string[]) => menuAcomodado(mirada('MANAGER', llaves)).flatMap((g) => g.secciones).filter((s) => s.etiqueta === 'Mi gimnasio');
  assert.deepEqual(entrada(todasLasLlaves).map((s) => [s.href, s.rutas]), [['/gimnasio', ['/gimnasio', '/sucursales', '/modulos']]]);
  assert.deepEqual(entrada(['sucursales']).map((s) => s.href), ['/gimnasio']);
  assert.deepEqual(entrada(['modulos']).map((s) => s.href), ['/modulos']);
  assert.deepEqual(entrada([]), []);
  // Ya no hay renglones «Sucursales» ni «Módulos» en el menú de nadie.
  for (const p of PUESTOS) assert.deepEqual(menuAcomodado(mirada(p, todasLasLlaves)).flatMap((g) => g.secciones).filter((s) => s.etiqueta === 'Sucursales' || s.etiqueta === 'Módulos'), [], p);
});

test('el gerente con todo liberado: Inicio suelto y cinco grupos por tarea, de seis renglones como mucho', () => {
  const grupos = menuAcomodado(mirada('MANAGER', todasLasLlaves));
  assert.deepEqual(grupos.map((g) => [g.titulo, g.secciones.map((s) => s.href)]), [
    [null, ['/panel']],
    ['Mostrador', ['/socios', '/caja', '/punto-de-venta', '/altas', '/estacion', '/acceso']],
    ['Clases y crecimiento', ['/clases', '/rutinas', '/prospectos', '/retencion', '/mensajes']],
    ['Dinero', ['/tablero', '/movimientos', '/precios', '/planes', '/productos']],
    ['Gimnasio', ['/personal', '/gimnasio', '/importar', '/consentimientos']],
    ['Control', ['/bitacora', '/biometria']],
  ]);
  for (const g of grupos) assert.ok(g.secciones.length <= 6, `${g.titulo} tiene ${g.secciones.length}`);
});

test('el gerente el primer día (sin nada liberado) solo ve los grupos que tienen algo (de Dinero, la Lista de precios)', () => {
  assert.deepEqual(menuAcomodado(mirada('MANAGER', [])).map((g) => g.titulo), [null, 'Mostrador', 'Clases y crecimiento', 'Dinero']);
});

test('recepción, coach y dueña: una lista plana, sin título, en el orden en que se usa', () => {
  const plano = (p: string, llaves: readonly string[] = []) => {
    const g = menuAcomodado(mirada(p, llaves));
    assert.equal(g.length, 1, p);
    assert.equal(g[0]!.titulo, null, p);
    return g[0]!.secciones;
  };
  assert.deepEqual(plano('RECEPTION').map((s) => s.href), ['/panel', '/socios', '/caja', '/punto-de-venta', '/clases', '/altas', '/prospectos', '/mensajes', '/precios', '/estacion', '/acceso']);
  assert.deepEqual(plano('COACH').map((s) => [s.href, s.etiqueta]), [['/panel', 'Inicio'], ['/socios', 'Mis socios'], ['/clases', 'Clases'], ['/rutinas', 'Rutinas'], ['/precios', 'Lista de precios']]);
  // Sus firmas y su dinero, arriba: ya no plegados bajo «Dirección» y «Cumplimiento».
  assert.deepEqual(plano('OWNER').map((s) => s.href), ['/panel', '/autorizaciones', '/movimientos', '/tablero', '/caja', '/personal', '/bitacora', '/planes', '/precios', '/gimnasio', '/biometria', '/consentimientos', '/cuenta-gymflow']);
  // Lo que el dueño le libere a recepción sale después de lo suyo.
  assert.deepEqual(plano('RECEPTION', todasLasLlaves).slice(11).map((s) => s.href), ['/retencion', '/planes', '/consentimientos']);
});

test('toda sección del registro tiene lugar en los grupos del gerente (una nueva no cae «al final» sin que nadie lo decida)', () => {
  const enGrupos = new Set(['/panel', ...MENU_POR_TAREA.flatMap((g) => g.rutas)]);
  assert.deepEqual(SECCIONES.map((s) => s.href).filter((h) => !enGrupos.has(h)), []);
  for (const rutas of Object.values(MENU_PLANO)) for (const r of rutas) assert.ok(SECCIONES.some((s) => s.href === r), `${r} no es una sección`);
});

test('la barra inferior es solo de la dueña y solo con lo que está en su menú', () => {
  assert.deepEqual(barraInferior(mirada('OWNER', [])).map((b) => [b.seccion.href, b.etiqueta]), [['/panel', 'Inicio'], ['/movimientos', 'Dinero'], ['/autorizaciones', 'Firmas'], ['/personal', 'Equipo']]);
  for (const p of ['MANAGER', 'RECEPTION', 'COACH']) assert.deepEqual(barraInferior(mirada(p, todasLasLlaves)), [], p);
  assert.deepEqual(barraInferior({ ...mirada('OWNER', []), roles: ['OWNER', 'MANAGER'] }), []);
});
