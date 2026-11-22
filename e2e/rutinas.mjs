// Quitar la rutina de un socio (auditoría 8, fase 0.10, 12-08): pide confirmar
// en un diálogo que nombra a la persona, la rutina y su fecha; «Cancelar» no
// toca nada y «Quitar rutina» la quita. Al final se le vuelve a asignar la
// misma, para dejarlo como estaba.
//
// Datos propios (fase 1.17a): el socio es de esta corrida, asignado al coach,
// con una rutina del catálogo (antes: «el último de los primeros 100 con
// rutina», que dependía de la semilla y de `bloque3`). Al terminar se le quita
// la rutina y el coach.
import { recorrido, socioAlCorriente, PANEL, T } from './lib/index.mjs';

await recorrido('rutinas', async (r) => {
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const g = await r.api('gerencia');
  const coachApi = await r.api('coach');
  const coachId = (await g.get('/classes/coaches')).coaches.find((c) => c.fullName === 'Diego Arriaga')?.id;
  const nuevo = await socioAlCorriente(g, { sede: 'CEN' });
  await g.put(`/members/${nuevo.id}/coach`, { coachUserId: coachId });
  const catalogo = (await coachApi.get('/routines')).routines;
  const deCatalogo = catalogo.find((x) => x.name === 'Hipertrofia · torso / pierna') ?? catalogo[0];
  await coachApi.post(`/members/${nuevo.id}/routine`, { routineId: deCatalogo.id, notes: null });
  r.alFinal(async () => {
    await g.post(`/members/${nuevo.id}/routine/end`, { reason: 'Termina el recorrido de prueba' }).catch(() => undefined);
    await g.put(`/members/${nuevo.id}/coach`, { coachUserId: null });
  });

  const p = await r.como('coach');
  const socio = { ...nuevo, rutina: deCatalogo.name, rutinaId: deCatalogo.id };
  r.ok(!!socio, `el coach tiene un socio con rutina (${socio.firstName} · ${socio.rutina})`);
  const nombre = `${socio.firstName} ${socio.lastName}`;
  await p.goto(`${PANEL}/socios/${socio.id}?tab=rutina`, { waitUntil: 'networkidle' });
  const quitar = p.getByRole('button', { name: 'Quitar', exact: true });
  await quitar.waitFor({ timeout: T.respuesta });
  r.ok(await p.getByRole('link', { name: socio.rutina }).count() > 0, 'la ficha muestra su rutina');

  r.paso('cancelar no quita nada');
  await quitar.click();
  const conf = p.getByRole('dialog', { name: `¿Quitar la rutina de ${nombre}?` });
  r.ok(await conf.waitFor({ timeout: T.ui }).then(() => true, () => false), `«Quitar» pide confirmar y nombra a la persona: «¿Quitar la rutina de ${nombre}?»`);
  r.ok(await conf.getByText(new RegExp(`«${esc(socio.rutina)}», asignada el`)).count() === 1, 'y dice qué rutina y desde cuándo');
  await r.captura(p, 'rutinas-1-confirmar');
  await conf.getByRole('button', { name: 'Cancelar' }).click();
  await conf.waitFor({ state: 'hidden', timeout: T.ui });
  r.ok(await quitar.isVisible() && (await coachApi.get(`/members/${socio.id}/routine`)).assignment?.routine?.id === socio.rutinaId, '«Cancelar» no le quita nada');

  r.paso('quitar rutina');
  await quitar.click();
  // El motivo es opcional y queda en la bitácora con el nombre de quien la quitó (fase 0.5, 11-02).
  await conf.locator('#quitar-rutina-motivo').fill('Terminó su programa (recorrido de prueba)');
  await conf.getByRole('button', { name: 'Quitar rutina' }).click();
  await p.getByText(`${socio.firstName} ya no tiene rutina`).first().waitFor({ timeout: T.respuesta });
  await p.getByText(`${socio.firstName} no tiene rutina`).waitFor({ timeout: T.respuesta });
  r.ok((await coachApi.get(`/members/${socio.id}/routine`)).assignment === null, '«Quitar rutina» se la quita: la ficha y la API lo dicen');
  await r.captura(p, 'rutinas-2-sin-rutina');
  const asiento = (await g.get(`/audit?resourceId=${socio.id}&limit=20`)).entries.find((e) => e.action === 'training.routine.end');
  r.ok(asiento?.reason === 'Terminó su programa (recorrido de prueba)' && !!asiento?.actorName, `la bitácora guarda quién la quitó y su motivo (${asiento?.actorName ?? '?'}: «${asiento?.reason ?? ''}»)`);

  // Se le devuelve la misma, como estaba.
  r.paso('se le vuelve a asignar');
  await p.getByRole('button', { name: 'Asignar rutina' }).click();
  const asignar = p.getByRole('dialog', { name: 'Asignar rutina' });
  // Un solo «Asignar rutina» con tarjetas (bloque 2.6, 12-09): se elige la tarjeta, ya no un `<select>`.
  await asignar.locator(`[data-rutina="${socio.rutinaId}"]`).click();
  await asignar.getByRole('button', { name: 'Asignar', exact: true }).click();
  await p.getByRole('link', { name: socio.rutina }).first().waitFor({ timeout: T.respuesta });
  r.ok(true, 'y se le vuelve a asignar la misma');
}, { erroresDePagina: 'falla' });
