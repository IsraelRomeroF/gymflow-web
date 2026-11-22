// Permisos (auditoría 8, fase 0.8: 27-06, 1-05, A2 N-01, 5-08). La puerta revisa
// el puesto antes que la llave: recepción en el Tablero lee «Tu rol no ve esta
// pantalla», no «pídesela al dueño». El coach no ve la afluencia del gimnasio
// («Entradas de hoy») ni los nombres de los socios ajenos en la lista de una
// clase que no imparte. Desde el panel solo se registra la entrada por el
// mostrador (huella, PIN o tarjeta → 422).
//
// Datos propios (fase 1.17a): la clase sin coach, el socio del coach y el ajeno
// son de esta corrida (antes, una sesión cualquiera de la semilla y socios
// tomados por posición); al terminar retira su clase y le quita el coach a su socio.
import { recorrido, socioAlCorriente, crearClase, retirarClase, letras, respuesta, asentado, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('permisos', async (r) => {
  const json = (p, url, init) => p.evaluate(async ([u, i]) => { const x = await fetch(u, i); return { status: x.status, body: await x.json().catch(() => null) }; }, [url, init]);
  const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const g = await r.api('gerencia');
  const coachId = (await g.get('/classes/coaches')).coaches.find((c) => c.fullName === 'Diego Arriaga')?.id;
  const suyo = await socioAlCorriente(g, { sede: 'CEN', nombre: 'Julián' });
  const ajeno = await socioAlCorriente(g, { sede: 'CEN', nombre: 'Olivia' });
  await g.put(`/members/${suyo.id}/coach`, { coachUserId: coachId });
  r.alFinal(() => g.put(`/members/${suyo.id}/coach`, { coachUserId: null }));
  const clase = await crearClase(g, { sede: 'CEN', nombre: `Pilates ${letras(4)}`, dias: [1], hora: '19:00' });
  r.alFinal(() => retirarClase(g, clase.tipo));

  const rec = await r.como('recepcion');
  const coach = await r.como('coach');

  // 1. La afluencia: recepción ve «Entradas de hoy» en su inicio; el coach ya no.
  r.paso('entradas de hoy');
  await rec.getByText('Entradas de hoy').first().waitFor({ timeout: T.respuesta }).catch(() => undefined);
  r.ok(await rec.getByText('Entradas de hoy').count() > 0, 'recepción ve «Entradas de hoy» en su inicio');
  // Se espera a que su inicio cargue lo suyo (bloque 2.6: `GET /coach/today`): antes, «no está» no diría nada.
  const pregunta = respuesta(coach, '/api/coach/today', { que: 'el inicio del coach' }).catch(() => null);
  await coach.reload({ waitUntil: 'networkidle' });
  r.ok(!!(await pregunta), 'el inicio del coach carga sus socios y sus rutinas');
  r.ok(await coach.locator('[data-testid="inicio-coach"]').getByText('Tus socios').count() > 0, 'y es su inicio propio: «Tus socios» (12-04)');
  await asentado(coach);
  r.ok(await coach.getByText('Entradas de hoy').count() === 0, 'el coach ya no ve las entradas del gimnasio (1-05)');
  const turno = await json(coach, '/api/me/shift');
  const entradas = (turno.body?.branches ?? []).map((b) => b.entriesToday);
  r.ok(turno.status === 200 && turno.body?.canSeeEntries === false && entradas.every((n) => n === null), `y la API tampoco se las da (canSeeEntries ${turno.body?.canSeeEntries}, entradas por sede: ${entradas.map(String).join(', ')})`);

  // 2. La puerta: primero el puesto, después la llave (27-06).
  r.paso('la puerta');
  await rec.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  r.ok(await aparece(rec.getByText('Tu rol no ve esta pantalla'), T.respuesta), 'recepción en el Tablero lee «Tu rol no ve esta pantalla»');
  r.ok(await rec.getByText(/la libera el dueño/).count() === 0, 'y no «pídesela al dueño»: su puesto no la trae');
  await r.captura(rec, 'permisos-1-puerta');

  // 3. Desde el panel solo la entrada por el mostrador (5-08).
  r.paso('huella desde el panel');
  const sede = ajeno.homeBranchId;
  const huella = await json(rec, '/api/access/attempts', post({ branchId: sede, memberId: ajeno.id, credentialKind: 'FINGERPRINT', requestKey: crypto.randomUUID() }));
  r.ok(huella.status === 422 && JSON.stringify(huella.body).includes('solo se registra la entrada por el mostrador'), `una «huella» mandada desde el panel no registra entrada (${huella.status}: «${JSON.stringify(huella.body).match(/Desde el panel[^"]*/)?.[0] ?? huella.body?.message}»)`);

  // 4. La lista de una clase que el coach no imparte: el cupo sí, los nombres solo de SUS socios (A2 N-01).
  r.paso('la lista de una clase ajena');
  const sesion = clase.sesiones.find((s) => s.status === 'SCHEDULED' && !s.coachUserId);
  r.ok(!!sesion, `hay una clase sin coach con lugar (${sesion?.className})`);
  const r1 = await json(rec, `/api/classes/schedules/${sesion.id}/bookings`, post({ memberId: suyo.id }));
  const r2 = await json(rec, `/api/classes/schedules/${sesion.id}/bookings`, post({ memberId: ajeno.id }));
  r.ok(r1.status === 201 && r2.status === 201, `recepción inscribe a un socio del coach (${suyo.firstName}) y a uno ajeno (${ajeno.firstName})`);
  const reservas = [r1.body?.id, r2.body?.id].filter(Boolean);
  await coach.goto(`${PANEL}/clases`, { waitUntil: 'networkidle' });
  // El coach aterriza en «Mis clases» (bloque 2.5): la sesión sin coach está en «Todas».
  await coach.getByRole('button', { name: 'Todas', exact: true }).click();
  const fila = coach.locator('li.sesion-fila').filter({ hasText: sesion.className }).first();
  await fila.waitFor({ timeout: T.respuesta });
  await fila.click();
  const lista = coach.getByRole('dialog', { name: new RegExp(`^${sesion.className}`) });
  await lista.locator('.list-item').first().waitFor({ timeout: T.respuesta });
  await asentado(coach);
  const renglones = await lista.locator('.list-item').allInnerTexts();
  r.ok(renglones.some((t) => t.includes(`${suyo.firstName} ${suyo.lastName}`) && t.includes(suyo.memberCode)), 'el coach ve con nombre y código a su socio');
  r.ok(!renglones.some((t) => t.includes(ajeno.firstName) || t.includes(ajeno.memberCode)), 'al socio ajeno no lo nombra');
  r.ok(renglones.some((t) => /^Socio\b/.test(t.trim())), 'lo ve como «Socio»: el lugar cuenta, la persona no se dice');
  await r.captura(coach, 'permisos-2-lista-coach');
  await coach.keyboard.press('Escape');
  for (const id of reservas) await json(rec, `/api/classes/bookings/${id}/cancel`, post({}));
  r.ok(true, 'se quitan las dos reservas de prueba');
}, { erroresDePagina: 'falla' });
