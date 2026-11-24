/**
 * EL COACH NO TIENE BOTÓN DE WHATSAPP NI DE LLAMAR (D-30 (a); bloque 4.7).
 *
 * La API no le entrega a un coach el teléfono de nadie
 * (`gymflow-backend/test/coach-sin-telefonos.test.ts`). Esta prueba cuida la
 * otra mitad: que ninguna pantalla que el coach ve arme un enlace de WhatsApp
 * o de llamada hacia una persona. Los enlaces `wa.me/<número>` y `tel:` solo
 * existen en las pantallas de esta lista, y ninguna es del coach.
 *
 * Si agregas un botón de WhatsApp o de llamar en otra pantalla, esta prueba
 * falla: hay que venir a decir de quién es la pantalla. Si es una que ve el
 * coach (la ficha, su Inicio, la lista de su clase), D-30 dice que no.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MENU_PLANO, SECCIONES } from './registro.ts';

const RAIZ = new URL('..', import.meta.url).pathname;
const archivos = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? archivos(p) : /\.tsx?$/.test(p) && !p.endsWith('.test.ts') ? [p] : [];
});

/** Un enlace hacia el teléfono de ALGUIEN: `wa.me/` seguido de un número calculado, o `tel:`. (`wa.me/?text=` abre WhatsApp sin destinatario.) */
const HACIA_UN_TELEFONO = /wa\.me\/\$\{|href=\{`tel:/;

/** Dónde hay un botón así, y de qué sección es la pantalla. `null`: no es una pantalla de socios (ver el porqué). */
const PERMITIDOS: Record<string, { seccion: string | null; porque: string }> = {
  'app/(panel)/retencion/page.tsx': { seccion: '/retencion', porque: 'a quién llamar: gerencia y recepción con la llave de Retención' },
  'app/(panel)/retencion/recuperar.tsx': { seccion: '/retencion', porque: 'exsocios por recuperar' },
  'components/prospectos/grupo.tsx': { seccion: '/prospectos', porque: 'la bandeja de interesados, de recepción' },
  'components/prospectos/dialogos.tsx': { seccion: '/prospectos', porque: '«Mandar alta digital» a un interesado' },
  'lib/entrega-temporal.ts': { seccion: null, porque: 'la contraseña temporal de una cuenta del PERSONAL, a su propio celular; no es el teléfono de un socio' },
};

test('los botones de WhatsApp y de llamar viven solo en pantallas que el coach no ve', () => {
  const con = ['app', 'components', 'lib'].flatMap((d) => archivos(join(RAIZ, d)))
    .filter((f) => HACIA_UN_TELEFONO.test(readFileSync(f, 'utf8'))).map((f) => relative(RAIZ, f)).sort();
  assert.deepEqual(con, Object.keys(PERMITIDOS).sort());

  const delCoach = MENU_PLANO.COACH ?? [];
  assert.ok(delCoach.length > 0, 'el coach tiene menú');
  for (const [archivo, { seccion }] of Object.entries(PERMITIDOS)) {
    if (!seccion) continue;
    assert.ok(!delCoach.includes(seccion), `${archivo} es de ${seccion}, que no está en el menú del coach`);
    const s = SECCIONES.find((x) => x.href === seccion);
    assert.ok(s, `la sección ${seccion} existe`);
    // Lo que abre esa pantalla no viene con el puesto de coach (el núcleo lo fija; `tabla-puestos.test.ts` fija el resultado).
    assert.ok(!(s.puestos ?? []).includes('COACH' as never), `${seccion} no nombra al coach entre sus puestos`);
  }
});

test('las piezas que el coach sí usa no mencionan WhatsApp ni teléfonos', () => {
  for (const f of ['components/inicio/inicio-coach.tsx', 'components/coach-socio.tsx', 'components/coach-clase.tsx', 'components/hacerme-su-coach.tsx', 'components/rutina-socio.tsx', 'components/rutina-asignar.tsx']) {
    const texto = readFileSync(join(RAIZ, f), 'utf8');
    assert.ok(!/wa\.me|whatsapp|phoneE164|tel:/i.test(texto), `${f} no arma enlaces de contacto`);
  }
});
