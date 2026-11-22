// El día del coach (fase 2, bloque 2.6): su inicio propio (sin «Entradas de
// hoy» ni «Por resolver», con cifras que abren su lista), asignar una rutina
// desde la ficha con vista previa y «Revisar en», «Personalizar» (la copia es
// solo del socio), y en el portal «Hoy toca» → «Marcar día hecho», que el coach
// ve en la ficha.
//
// Datos propios: un socio de la corrida asignado al coach y una rutina con el
// nombre de la corrida (armada por la API con el catálogo de ejercicios). Al
// terminar se le quita la rutina y el coach al socio, y se archivan la rutina
// y su copia personal.
import { recorrido, socioAlCorriente, invitacionPortal, letras, dia, asentado, aparece, PANEL, PORTAL, T } from './lib/index.mjs';

const fechaCorta = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

await recorrido('coach-dia', async (r) => {
  const g = await r.api('gerencia');
  const c = await r.api('coach');
  const L = letras(4);
  const nombreRutina = `Rutina del día ${L}`;
  const nota = `Empieza ligero ${L}`;

  // ── 0. Un socio del coach, sin rutina, y una rutina de la corrida ─────────
  r.paso('preparar socio y rutina');
  const coach = (await g.get('/users')).users.find((u) => u.email === c.email);
  const socio = await socioAlCorriente(g, { nombre: 'Ximena' });
  await g.put(`/members/${socio.id}/coach`, { coachUserId: coach.id });
  r.alFinal(() => g.put(`/members/${socio.id}/coach`, { coachUserId: null }));
  const ejercicios = (await c.get('/exercises')).exercises;
  const de = (grupo) => ejercicios.filter((e) => e.muscleGroup === grupo).slice(0, 2);
  const diaDe = (name, lista) => ({ name, items: lista.map((e) => ({ exerciseId: e.id, sets: 3, reps: '10-12', restSeconds: 60 })) });
  const diaUno = de('CHEST'); const diaDos = de('LEGS').length ? de('LEGS') : ejercicios.slice(-2);
  const rutina = await c.post('/routines', { name: nombreRutina, days: [diaDe('Empuje', diaUno), diaDe('Pierna', diaDos)] });
  const porArchivar = new Set([rutina.id]);
  r.alFinal(async () => { for (const id of porArchivar) await g.crudo('POST', `/routines/${id}/archive`, {}); });
  r.alFinal(() => g.crudo('POST', `/members/${socio.id}/routine/end`, { reason: 'Termina el recorrido de prueba' }));
  const hoyCoach = await c.get('/coach/today');

  // ── 1. El inicio del coach ────────────────────────────────────────────────
  r.paso('inicio del coach');
  const co = await r.como('coach');
  const inicio = co.getByTestId('inicio-coach');
  await inicio.waitFor({ timeout: T.navegacion });
  const total = inicio.getByRole('link', { name: /socios? asignados?: ver Mis socios/ });
  await total.waitFor({ timeout: T.respuesta });
  await asentado(co);
  r.ok(await co.getByText('Entradas de hoy').count() === 0 && await co.getByText('Por resolver').count() === 0, 'el inicio del coach no trae «Entradas de hoy» ni «Por resolver»');
  r.ok(await inicio.getByText('Hoy: tus clases').count() === 1 && await inicio.getByText('Tus socios').count() === 1 && await inicio.getByText('Tus rutinas').count() === 1, 'trae sus tres bloques: «Hoy: tus clases», «Tus socios» y «Tus rutinas»');
  const etiquetaTotal = await total.getAttribute('aria-label');
  // Otros recorridos le asignan y le quitan socios al mismo coach: se compara con holgura de lo que pasó entre la consulta y la pantalla.
  r.ok(Math.abs(Number(/^(\d+)/.exec(etiquetaTotal)?.[1]) - hoyCoach.members.total) <= 3 && hoyCoach.members.total >= 1, `la primera cifra son sus socios asignados (${etiquetaTotal}; la API dice ${hoyCoach.members.total})`);
  r.ok(!/\+52|\b55\d{8}\b/.test(await inicio.innerText()), 'ningún teléfono en su inicio');
  // Cada cifra abre su lista ahí mismo.
  const sinRutina = inicio.getByRole('button', { name: /Sin rutina/ });
  await sinRutina.click();
  const lista = co.getByTestId('coach-lista');
  const renglon = lista.getByRole('listitem').filter({ hasText: socio.lastName });
  r.ok(await sinRutina.getAttribute('aria-pressed') === 'true' && await aparece(renglon, T.ui), `«Sin rutina» abre su lista, y ahí está ${socio.firstName} ${socio.lastName}`);
  r.ok(await renglon.getByRole('link', { name: 'Dar rutina' }).count() === 1 && /Sin rutina/.test(await renglon.innerText()), 'su renglón dice «Sin rutina» y ofrece «Dar rutina»');
  await inicio.getByRole('button', { name: /Sin venir 7 días o más/ }).click();
  r.ok(await aparece(lista.getByText(/^Sin venir 7 días o más · \d+$/), T.ui) && await renglon.count() === 0, '«Sin venir» cambia la lista, y quien se inscribió hoy no sale ahí');
  await sinRutina.click();
  await r.captura(co, 'coach-dia-1-inicio');

  // ── 2. Asignar desde la ficha, con vista previa y «Revisar en» ────────────
  r.paso('asignar rutina desde la ficha');
  await renglon.getByRole('link', { name: 'Dar rutina' }).click();
  await co.waitForURL(`**/socios/${socio.id}?tab=rutina`, { timeout: T.navegacion });
  await co.getByText(`${socio.firstName} no tiene rutina`).waitFor({ timeout: T.navegacion });
  r.ok(true, '«Dar rutina» lleva a la pestaña Rutina de su ficha, que dice que no tiene');
  await co.getByRole('button', { name: 'Asignar rutina' }).click();
  const d = co.getByRole('dialog', { name: 'Asignar rutina' });
  await d.getByRole('radiogroup').waitFor({ timeout: T.respuesta });
  r.ok(await d.getByRole('button', { name: '6 semanas' }).getAttribute('aria-pressed') === 'true', '«Revisar en» nace en 6 semanas');
  r.ok(await d.getByRole('button', { name: 'Asignar', exact: true }).isDisabled(), 'sin elegir rutina, «Asignar» está apagado');
  const buscar = d.getByLabel('Buscar rutina');
  if (await buscar.count()) await buscar.fill(nombreRutina);
  await d.getByRole('radio', { name: new RegExp(nombreRutina) }).click();
  r.ok(await aparece(d.getByText('Día 1 · Empuje'), T.respuesta) && await d.getByText(diaUno[0].name).count() >= 1, `elegirla abre su vista previa con los días y ejercicios (Día 1 · Empuje, ${diaUno[0].name})`);
  await d.getByRole('button', { name: '4 semanas' }).click();
  await d.getByLabel('Nota para el socio (opcional)').fill(nota);
  await r.captura(co, 'coach-dia-2-asignar');
  await d.getByRole('button', { name: 'Asignar', exact: true }).click();
  await co.getByText(`${socio.firstName} ya ve «${nombreRutina}» en su teléfono`).waitFor({ timeout: T.respuesta });
  const cifras = co.getByTestId('rutina-cifras');
  await cifras.waitFor({ timeout: T.respuesta });
  const asignada = (await c.get(`/members/${socio.id}/routine`)).assignment;
  r.ok(asignada.routine.id === rutina.id && asignada.reviewOn === dia(28) && asignada.notes === nota, `queda asignada con su nota y revisión en 4 semanas (${asignada.reviewOn})`);
  r.ok((await cifras.innerText()).replace(/\s+/g, ' ').includes(`Revisión El ${fechaCorta(dia(28))}`), `la ficha enseña las cifras de la rutina, con su fecha de revisión (${(await cifras.innerText()).replace(/\n+/g, ' · ')})`);
  r.ok(/Le toca\s+Día 1 · Empuje/.test(await cifras.innerText()) && await co.getByText('Todavía no marca ningún día como hecho en su teléfono.').count() === 1, 'dice que le toca el día 1 y que todavía no marca ningún día');

  // ── 3. Personalizar: la copia es solo del socio ───────────────────────────
  r.paso('personalizar');
  await co.getByRole('button', { name: 'Personalizar', exact: true }).click();
  const pd = co.getByRole('dialog', { name: `¿Personalizar «${nombreRutina}» para ${socio.firstName} ${socio.lastName}?` });
  r.ok(await aparece(pd, T.ui) && /Se hace una copia solo para/.test(await pd.innerText()) && /La original se queda en el catálogo/.test(await pd.innerText()), '«Personalizar» explica que hace una copia solo para el socio y que la original se queda');
  await pd.getByRole('button', { name: 'Personalizar y editar' }).click();
  await co.waitForURL(/\/rutinas\/[0-9a-f-]{36}$/, { timeout: T.navegacion });
  const copiaId = co.url().split('/').pop();
  if (copiaId !== rutina.id) porArchivar.add(copiaId);
  await co.getByText(/Copia personal de/).first().waitFor({ timeout: T.navegacion });
  r.ok(copiaId !== rutina.id && await co.getByRole('button', { name: 'Asignar a un socio' }).count() === 0, 'abre la copia personal para editarla, y esa no se asigna a nadie más');
  await r.captura(co, 'coach-dia-3-copia-personal');
  await co.goto(`${PANEL}/socios/${socio.id}?tab=rutina`, { waitUntil: 'networkidle' });
  await co.getByTestId('rutina-cifras').waitFor({ timeout: T.respuesta });
  r.ok(await aparece(co.getByText(`Personal de ${socio.firstName}`), T.ui) && await co.getByRole('button', { name: 'Personalizar', exact: true }).count() === 0, `la ficha dice «Personal de ${socio.firstName}» y ya no ofrece personalizar otra vez`);
  const trasCopia = (await c.get(`/members/${socio.id}/routine`)).assignment;
  const catalogo = (await c.get('/routines')).routines;
  r.ok(trasCopia.routine.id === copiaId && trasCopia.reviewOn === dia(28) && trasCopia.notes === nota && catalogo.some((x) => x.id === rutina.id) && !catalogo.some((x) => x.id === copiaId),
    'la copia conserva la nota y la revisión; la original sigue en el catálogo y la copia no sale ahí');

  // ── 4. El socio en su teléfono: «Hoy toca» → «Marcar día hecho» ───────────
  r.paso('portal: hoy toca y día hecho');
  const codigo = await invitacionPortal(g, socio);
  const tel = await r.nueva({ movil: true });
  await tel.goto(`${PORTAL}/activar`, { waitUntil: 'networkidle' });
  await tel.locator('input').first().fill(codigo);
  await tel.getByRole('button', { name: /Activar/ }).click();
  await tel.waitForURL(`${PORTAL}/`, { timeout: T.navegacion });
  await tel.getByRole('link', { name: 'Rutina' }).click();
  const hoyToca = tel.getByTestId('hoy-toca');
  await hoyToca.waitFor({ timeout: T.navegacion });
  r.ok(/Hoy toca/.test(await hoyToca.innerText()) && /Empuje/.test(await hoyToca.innerText()), `el portal dice «Hoy toca» y el día (${(await hoyToca.innerText()).replace(/\n+/g, ' ')})`);
  r.ok(await tel.getByText(`Tu coach: ${coach.fullName}`).count() === 1 && await tel.getByText(nota).count() >= 1 && await tel.getByText('Para ti:').count() === 1, `dice «Tu coach: ${coach.fullName}» y la nota en su renglón «Para ti»`);
  await r.captura(tel, 'coach-dia-4-portal-hoy-toca');
  await tel.getByRole('button', { name: 'Marcar día hecho' }).click();
  r.ok(await aparece(tel.getByRole('status').filter({ hasText: 'Hecho hoy' }), T.respuesta) && /Hoy hiciste/.test(await hoyToca.innerText()), 'marcado, dice «Hecho hoy» y «Hoy hiciste»');
  r.ok(await tel.getByRole('tab', { name: /Día 1.*hecho esta semana/ }).count() === 1 && await tel.getByRole('button', { name: 'Deshacer' }).count() === 1, 'la pestaña del día 1 queda como hecha esta semana, con «Deshacer» a la mano');
  await r.captura(tel, 'coach-dia-5-portal-dia-hecho');

  // El coach lo ve en la ficha.
  r.paso('el coach ve el día hecho');
  await co.reload({ waitUntil: 'networkidle' });
  await co.getByTestId('rutina-cifras').waitFor({ timeout: T.respuesta });
  const cifrasDespues = await co.getByTestId('rutina-cifras').innerText();
  r.ok(/Esta semana\s+1 de 2 días/.test(cifrasDespues) && /Hoy hizo\s+Día 1 · Empuje/.test(cifrasDespues), `y el coach lo ve en la ficha (${cifrasDespues.replace(/\n+/g, ' · ')})`);
  await r.captura(co, 'coach-dia-6-ficha-dia-hecho');
  // Y ya no está en «Sin rutina» de su inicio.
  await co.goto(`${PANEL}/panel`, { waitUntil: 'networkidle' });
  await co.getByTestId('inicio-coach').getByRole('button', { name: /Sin rutina/ }).click();
  await co.getByTestId('coach-lista').getByText(/^Sin rutina · \d+$/).waitFor({ timeout: T.respuesta });
  r.ok(await co.getByTestId('coach-lista').getByRole('listitem').filter({ hasText: socio.lastName }).count() === 0, 'en su inicio, el socio ya no sale en «Sin rutina»');
}, { erroresDePagina: 'falla' });
