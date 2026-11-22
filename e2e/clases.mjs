// Clases (gerencia): crear una clase y ponerla en el horario, cancelar una
// sesión, dejar de dar TODAS las clases (la pantalla y el portal lo dicen) y
// reactivar.
//
// Ya no es destructivo (fase 1.17a; A2 «clases.mjs deja de ser destructivo»):
// la clase nueva lleva el nombre de la corrida (antes «Yoga» chocaba con la
// de la corrida anterior), y al terminar se deja el horario como estaba:
// reactiva cada clase que retiró, vuelve a poner sus horarios (con sus
// sesiones de los próximos días) y retira la suya. Antes, después de este
// recorrido no quedaban sesiones que inscribir y había que regenerar la base.
import { recorrido, socioAlCorriente, invitacionPortal, accion, asentado, aparece, letras, hoy, PANEL, PORTAL, T } from './lib/index.mjs';

await recorrido('clases', async (r) => {
  const g = await r.api('gerencia');
  const yoga = `Yoga ${letras(4)}`;
  // Cómo estaba el horario: qué clases estaban activas y sus horarios vigentes.
  const tiposAntes = (await g.get('/classes/types')).types;
  const horariosAntes = (await g.get('/classes/templates')).templates;
  r.alFinal(async () => {
    const tipos = (await g.get('/classes/types')).types;
    for (const t of tiposAntes) {
      const ahora = tipos.find((x) => x.id === t.id)?.isActive;
      // La que estaba activa y se retiró, se reactiva; la que estaba retirada y
      // «Reactivar» trajo de vuelta, se retira otra vez.
      if (t.isActive && ahora === false) await g.patch(`/classes/types/${t.id}`, { isActive: true });
      if (!t.isActive && ahora === true) await g.post(`/classes/types/${t.id}/retire`, { reason: 'Vuelve a como estaba antes del recorrido' });
    }
    const vigentes = new Set((await g.get('/classes/templates')).templates.map((x) => x.id));
    let puestos = 0;
    for (const h of horariosAntes.filter((x) => !vigentes.has(x.id))) {
      await g.post('/classes/templates', {
        branchId: h.branchId, classTypeId: h.classTypeId, coachUserId: h.coachUserId ?? null, room: h.room ?? null,
        effectiveFrom: hoy(), slots: h.slots,
      });
      puestos++;
    }
    const propia = (await g.get('/classes/types')).types.find((x) => x.name === yoga && x.isActive);
    if (propia) await g.post(`/classes/types/${propia.id}/retire`, { reason: 'Clase de un recorrido de prueba' });
    if (puestos) r.nota(`el horario quedó como estaba: ${tiposAntes.filter((t) => t.isActive).length} clases activas y ${puestos} horarios puestos otra vez`);
  });
  const socio = await socioAlCorriente(g, { sede: 'CEN' });

  const page = await r.como('gerencia');
  const shot = (n, full = false) => r.captura(page, `c${n}`, { full });
  // Clases abre en «Sesiones»; el horario y las clases que se dan viven en la pestaña «Horario» (bloque 2.5).
  await page.goto(`${PANEL}/clases?vista=horario`, { waitUntil: 'networkidle' });
  await page.getByText('Clases que se dan').waitFor({ timeout: T.respuesta });
  await shot('1-clases', true);
  r.ok(await page.locator('.bloque').count() > 0, 'el horario semanal muestra las clases del sembrado');

  // Crear una clase y agregarla al horario
  r.paso('clase nueva al horario');
  await page.getByRole('button', { name: 'Nueva clase' }).click();
  let d = page.getByRole('dialog');
  await d.getByLabel('Nombre').fill(yoga);
  await d.getByLabel('Duración (min)').fill('50');
  await d.getByLabel('Cupo').fill('14');
  await d.getByRole('button', { name: 'Crear clase' }).click();
  d = page.getByRole('dialog');
  await d.getByText('Agregar al horario').first().waitFor();
  // Nada viene marcado (UX5-G-05): el botón dice qué falta.
  r.ok(await d.getByRole('button', { name: 'Elige los días' }).isDisabled(), 'sin días marcados, el botón dice qué falta');
  for (const dia of ['Mar', 'Jue', 'Sáb']) await d.getByRole('button', { name: dia, exact: true }).click();
  await d.getByLabel('Hora').fill('18:30');
  await d.getByLabel('Salón (opcional)').fill('Salón 3');
  await shot('2-agregar-horario');
  r.ok((await d.innerText()).includes('martes, jueves y sábado a las 18:30'), 'la frase de resumen dice exactamente qué se va a publicar');
  await d.getByRole('button', { name: 'Agregar 3 días por semana' }).click();
  await page.getByText(/Se generaron \d+ sesiones/).waitFor({ timeout: T.respuesta });
  await asentado(page);
  r.ok(await page.locator('.bloque', { hasText: yoga }).count() === 3, `${yoga} aparece 3 veces en el horario semanal`);
  await page.getByRole('tab', { name: 'Sesiones' }).click();
  await page.locator('.list-item', { hasText: yoga }).first().waitFor({ timeout: T.respuesta });
  r.ok(await page.locator('.list-item', { hasText: yoga }).count() > 0, 'sus sesiones aparecen en los próximos 7 días');
  await shot('3-con-yoga', true);

  // Cancelar una sesión (de la clase de esta corrida)
  r.paso('cancelar una sesión');
  // «Cancelar sesión» vive en el «Más» de la fila (11-12): ya no hay un botón destructivo por sesión.
  await page.locator('.list-item', { hasText: yoga }).getByRole('button', { name: /^Más acciones de/ }).first().click();
  await page.getByRole('menuitem', { name: 'Cancelar sesión' }).click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('El instructor está enfermo');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
  await page.getByText(/Sesión cancelada/).waitFor({ timeout: T.respuesta });
  await asentado(page);
  r.ok(await page.locator('.list-item', { hasText: yoga }).filter({ hasText: 'Cancelada' }).count() > 0, 'la sesión queda cancelada');

  // Dejar de dar TODAS las clases
  r.paso('dejar de dar todas');
  await page.getByRole('tab', { name: 'Horario' }).click();
  await page.getByText('Clases que se dan').waitFor({ timeout: T.respuesta });
  for (let i = 0; i < 12; i++) {
    // "Dejar de dar" vive en el menú Más de cada clase (no compite con Editar).
    const mas = page.locator('.card').filter({ has: page.getByRole('button', { name: 'Editar' }) }).getByRole('button', { name: 'Más' });
    if (await mas.count() === 0) break;
    await mas.first().click();
    await page.getByRole('menuitem', { name: /Dejar de dar/ }).click();
    await page.getByRole('dialog').getByLabel('Motivo').fill('El gimnasio deja de dar clases');
    await accion(page, () => page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click(), /\/api\/classes\/types\/[^/]+\/retire$/, { metodo: 'POST', que: 'retirar la clase' });
    await asentado(page);
  }
  await page.getByText('Este gimnasio ya no ofrece clases').waitFor({ timeout: T.respuesta });
  r.ok(true, 'sin clases activas, la pantalla lo dice');
  await shot('4-sin-clases');
  r.ok(await page.getByRole('button', { name: 'Reactivar' }).count() >= 3, 'las clases retiradas se pueden reactivar');

  // El portal esconde la pestaña de Clases
  r.paso('el portal sin clases');
  const code = await invitacionPortal(g, socio);
  const tel = await r.nueva({ movil: true, hasTouch: false, etiqueta: 'portal' });
  await tel.goto(`${PORTAL}/activar`, { waitUntil: 'networkidle' });
  await tel.getByLabel('Código de activación').fill(code);
  await tel.getByRole('button', { name: /Activar/ }).click();
  await tel.getByText('Cómo entras').waitFor({ timeout: T.respuesta });
  await asentado(tel);
  r.ok(await tel.getByRole('navigation').getByRole('link', { name: 'Clases' }).count() === 0, 'el portal ya no muestra la pestaña de Clases');
  r.ok(await tel.getByText('Tu próxima clase').count() === 0, 'ni la tarjeta de próxima clase');
  await r.captura(tel, 'c5-portal-sin-clases');

  // Reactivar una la trae de vuelta
  r.paso('reactivar');
  await accion(page, () => page.getByRole('button', { name: 'Reactivar' }).first().click(), /\/api\/classes\/types\/[^/]+$/, { metodo: 'PATCH', que: 'reactivar la clase' });
  await asentado(page);
  r.ok(await aparece(page.getByText('Clases que se dan'), T.ui), 'reactivar devuelve la clase');
});
