/**
 * LA PUERTA Y EL MENÚ, PUESTO POR PUESTO (27-06, 27-10).
 *
 * Se corre con `pnpm test` (node --test, sin dependencias nuevas). Usa los
 * puestos y la llave del NÚCLEO (`@gymflow/core`, enlazado con `link:` desde
 * la fase 1.1) para que el registro del panel no se separe de lo que la API
 * concede.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '@gymflow/core';
import { SECCIONES, LLAVES_ABIERTAS, menuPara, respuestaDePuerta, type Mirada, type RespuestaDePuerta, type Seccion } from './registro.ts';

type Nucleo = {
  ROLE_PERMISSIONS: Record<string, readonly string[]>;
  PERMISSION_BY_KEY: ReadonlyMap<string, unknown>;
  LOCKABLE_SECTIONS: ReadonlyArray<{ key: string; defaultOpen?: boolean }>;
  lockedPermissions: (unlocked: readonly string[], roleKeys: readonly string[]) => ReadonlySet<string>;
};
// Una vista con índices de texto: el registro habla de puestos y permisos como `string`.
const nucleo: Nucleo = core;

const PUESTOS = ['OWNER', 'MANAGER', 'RECEPTION', 'COACH'] as const;
const DE_DIRECCION = nucleo.LOCKABLE_SECTIONS.filter((s) => !s.defaultOpen).map((s) => s.key);

/** La sesión que arma la API para ese puesto: sus permisos menos lo que la llave cierra. */
function mirada(rol: string, liberadas: readonly string[] = []): Mirada {
  const fuera = nucleo.lockedPermissions(liberadas, [rol]);
  const permisos = new Set((nucleo.ROLE_PERMISSIONS[rol] ?? []).filter((p) => !fuera.has(p)));
  return { can: (p) => permisos.has(p), activo: () => true, roles: [rol], liberadas: rol === 'OWNER' ? null : liberadas };
}

/** ¿El puesto, por sí mismo, trae la sección? (lo que dice el núcleo, sin llave) */
const laTrae = (s: Seccion, rol: string) => (s.soloRoles ? s.soloRoles.includes(rol) : !s.permisos?.length
  || s.permisos.some((p) => (nucleo.ROLE_PERMISSIONS[rol] ?? []).includes(p))
  || (s.roles ?? []).includes(rol));

const seccion = (href: string) => SECCIONES.find((s) => s.href === href)!;

test('cada permiso, llave y puesto del registro existe en el núcleo', () => {
  const llaves = new Set(nucleo.LOCKABLE_SECTIONS.map((s) => s.key));
  for (const s of SECCIONES) {
    for (const p of s.permisos ?? []) assert.ok(nucleo.PERMISSION_BY_KEY.has(p), `${s.href}: ${p}`);
    if (s.llave) assert.ok(llaves.has(s.llave), `${s.href}: llave ${s.llave}`);
    for (const r of s.puestos ?? []) assert.ok((PUESTOS as readonly string[]).includes(r), `${s.href}: puesto ${r}`);
  }
  assert.deepEqual([...LLAVES_ABIERTAS].sort(), nucleo.LOCKABLE_SECTIONS.filter((s) => s.defaultOpen).map((s) => s.key).sort());
});

test('toda sección con llave dice qué puestos la traen, igual que el núcleo', () => {
  for (const s of SECCIONES.filter((x) => x.llave)) {
    assert.ok(s.puestos, `${s.href} tiene llave y no dice sus puestos`);
    assert.deepEqual([...s.puestos].sort(), PUESTOS.filter((r) => laTrae(s, r)).sort(), s.href);
  }
});

test('la puerta revisa el puesto antes que la llave (27-06)', () => {
  const casos: Array<[string, string, readonly string[], RespuestaDePuerta]> = [
    // Lo que motivó el cambio: recepción no ve Tablero por su puesto; pedírselo al dueño no sirve.
    ['RECEPTION', '/tablero', [], 'puesto'],
    ['RECEPTION', '/tablero', DE_DIRECCION, 'puesto'],
    ['RECEPTION', '/personal', [], 'puesto'],
    ['COACH', '/consentimientos', [], 'puesto'],
    ['COACH', '/caja', [], 'puesto'],
    // La llave solo aparece cuando el puesto sí la trae.
    ['MANAGER', '/tablero', [], 'llave'],
    ['MANAGER', '/tablero', ['tablero'], 'pasa'],
    ['RECEPTION', '/retencion', [], 'llave'],
    ['RECEPTION', '/retencion', ['retencion'], 'pasa'],
    ['RECEPTION', '/planes', [], 'llave'],
    ['COACH', '/planes', [], 'llave'],
    // Caja y Punto de venta vienen con el puesto: el dueño las quita.
    ['RECEPTION', '/caja', [], 'pasa'],
    ['RECEPTION', '/caja', ['-caja'], 'quitada'],
    ['MANAGER', '/punto-de-venta', ['-pos'], 'quitada'],
    // El dueño no tiene llave: ve lo suyo y no lo de operación.
    ['OWNER', '/tablero', [], 'pasa'],
    ['OWNER', '/modulos', [], 'pasa'],
    ['OWNER', '/socios', [], 'puesto'],
  ];
  for (const [rol, href, liberadas, esperada] of casos) {
    assert.equal(respuestaDePuerta(seccion(href), mirada(rol, liberadas)), esperada, `${rol} en ${href} con [${liberadas.join(', ')}]`);
  }
});

test('tabla puesto × sección: la puerta y el menú dicen lo mismo, con y sin llave', () => {
  for (const rol of PUESTOS) {
    for (const liberadas of [[], DE_DIRECCION, ['-caja', '-pos']]) {
      const m = mirada(rol, liberadas);
      const menu = new Set(menuPara(m).map((s) => s.href));
      for (const s of SECCIONES) {
        const r = respuestaDePuerta(s, m);
        const donde = `${rol} en ${s.href} con [${liberadas.join(', ')}]`;
        assert.equal(menu.has(s.href), r === 'pasa', `menú y puerta no coinciden: ${donde}`);
        // «Tu rol no ve esta pantalla» exactamente cuando su puesto no la trae.
        assert.equal(r === 'puesto', !laTrae(s, rol), donde);
      }
    }
  }
});

test('la llave del núcleo abre las mismas pantallas que el registro, en los mismos puestos (17-05)', () => {
  for (const s of SECCIONES.filter((x) => x.llave)) {
    const def = core.LOCKABLE_SECTIONS.find((x) => x.key === s.llave)!;
    assert.deepEqual([...(s.permisos ?? [])].sort(), [...def.menuPermissions].sort(), `${s.href}: permisos del menú`);
    assert.deepEqual([...(s.roles ?? [])].sort(), [...(def.menuRoles ?? [])].sort(), `${s.href}: puestos que la ven sin permiso`);
  }
  for (const rol of PUESTOS) {
    const delRegistro = SECCIONES.filter((x) => x.llave && (x.puestos ?? []).includes(rol)).map((x) => x.llave!);
    assert.deepEqual([...delRegistro].sort(), [...core.effectiveSections(rol)].sort(), rol);
  }
});
