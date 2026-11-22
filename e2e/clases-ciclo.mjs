// El ciclo de una clase suelta (fase 2, bloque 2.5; recorrido de 2.14): el socio
// aparta desde su teléfono una clase que su plan no incluye; en el panel, la
// lista de la sesión dice «Por pagar $X» y recepción la cobra y marca su
// llegada en un solo paso («Cobrar y marcar», 11-03); la ficha del socio lo
// refleja en su tarjeta «Clases». Y la gerencia pone una pausa por fechas y la
// quita (11-05).
//
// Datos propios: la clase (con su precio de clase suelta), su sesión única de
// hoy (dentro de 35 minutos: con la lista ya abierta) y el socio son de esta
// corrida; al terminar la clase se retira. La pausa es de UN día dentro de
// 40 días, donde todavía no hay sesiones generadas: una pausa es de toda la
// sucursal y cancelaría las clases (y reservas) de los demás recorridos si
// cayera en esta semana. No se tocan el horario sembrado ni las reglas.
import { recorrido, socioAlCorriente, invitacionPortal, crearClase, retirarClase, sedeDe, elegirCaja, accion, asentado, aparece, desaparece, letras, dia, ZONA, PANEL, PORTAL, T } from './lib/index.mjs';

const PRECIO = 12000; // centavos: $120
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Fecha y minuto del día en el gimnasio, `min` minutos después de ahora. */
function dentroDe(min) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(Date.now() + min * 60_000)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, startMinute: Number(p.hour) * 60 + Number(p.minute) };
}
/** «AAAA-MM-DD» como se teclea en un campo de fecha del panel: «DD/MM/AAAA». */
const tecleada = (iso) => iso.split('-').reverse().join('/');

await recorrido('clases-ciclo', async (r) => {
  const g = await r.api('gerencia');
  const L = letras(5);
  const nombreClase = `Spinning ${L}`;
  const motivoPausa = `Mantenimiento del salón ${L}`;
  const centro = await sedeDe(g, 'CEN');

  // La clase de la corrida: su tipo con precio de clase suelta y un horario propio (mañana).
  const clase = await crearClase(g, { nombre: nombreClase, sede: 'CEN', precio: PRECIO, cupo: 6, salon: `Salón ${L}` });
  r.alFinal(() => retirarClase(g, clase.tipo, 'Clase de un recorrido de prueba'));
  // Y una sesión única de HOY que empieza en 35 minutos: la lista se abre una hora antes.
  const sesion = await g.post('/classes/schedules', { branchId: centro.id, classTypeId: clase.tipo.id, ...dentroDe(35), durationMin: 45, capacity: 6, room: `Salón ${L}` });
  // Un socio al corriente con Mensualidad, que no incluye clases: la aparta como clase suelta.
  const socio = await socioAlCorriente(g, { sede: 'CEN' });
  const completo = `${socio.firstName} ${socio.lastName}`;

  // ── 1. El socio la aparta desde su teléfono ───────────────────────────────
  r.paso('el portal aparta la clase suelta');
  const code = await invitacionPortal(g, socio);
  const tel = await r.nueva({ movil: true, etiqueta: 'portal' });
  await tel.goto(`${PORTAL}/activar`, { waitUntil: 'networkidle' });
  await tel.getByLabel('Código de activación').fill(code);
  await tel.getByRole('button', { name: /Activar/ }).click();
  await tel.getByText('Cómo entras').waitFor({ timeout: T.respuesta });
  await tel.getByRole('navigation').getByRole('link', { name: 'Clases' }).click();
  const nombreEnPortal = tel.getByText(nombreClase, { exact: true });
  await nombreEnPortal.first().waitFor({ timeout: T.respuesta });
  await asentado(tel);
  r.ok(await tel.getByText(/No incluida en tu plan · \$120/).count() >= 1, 'el portal dice que la clase no va en su plan y cuánto cuesta ($120)');
  // Su tarjeta: el bloque más interno que tiene el nombre de la clase y el botón (hoy puede haber clases de otros recorridos).
  const reservar = tel.locator('div').filter({ has: nombreEnPortal }).filter({ has: tel.getByRole('button', { name: /^Reservar/ }) }).last().getByRole('button', { name: /^Reservar/ });
  r.ok(await reservar.count() === 1 && (await reservar.innerText()).trim() === 'Reservar · se paga en recepción', 'y su botón avisa que se paga en recepción');
  await r.captura(tel, 'cc-1-portal-clase');
  const book = await accion(tel, () => reservar.click(), /\/portal\/classes\/[^/]+\/book$/, { metodo: 'POST', que: 'apartar la clase' });
  r.ok(book.status() < 300 && book.url().includes(sesion.id), `aparta la sesión de hoy (POST …/book → ${book.status()})`);
  r.ok(await aparece(tel.getByText(new RegExp(`Listo, tienes lugar en ${nombreClase}\\. Paga \\$120(\\.00)? en recepción antes de la clase\\.`)), T.respuesta), 'al apartar le dice que la paga en recepción antes de la clase');
  const mias = tel.getByTestId('mis-clases');
  r.ok(await aparece(mias.getByText(nombreClase), T.respuesta) && await mias.getByText('Por pagar en recepción').count() === 1, '«Mis clases» la muestra «Por pagar en recepción»');
  await r.captura(tel, 'cc-2-portal-apartada');

  // ── 2. Recepción: la lista dice cuánto debe, y cobra y marca ──────────────
  r.paso('la lista dice «Por pagar»');
  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/clases`, { waitUntil: 'networkidle' });
  const hoyEnLista = rec.getByTestId('clases-hoy');
  await hoyEnLista.waitFor({ timeout: T.respuesta });
  // La fila de una sesión es un <li role="button"> (abre la lista): se busca por su etiqueta, no por rol de lista.
  const fila = hoyEnLista.locator('li').filter({ hasText: nombreClase });
  await fila.waitFor({ timeout: T.respuesta });
  r.ok(/1\/6/.test(await fila.innerText()), 'la sesión de hoy trae su lugar reservado (1/6)');
  await fila.getByRole('button', { name: 'Pasar lista' }).click();
  const lista = rec.getByTestId('lista-sesion');
  const renglon = lista.getByRole('listitem').filter({ hasText: completo });
  await renglon.waitFor({ timeout: T.respuesta });
  r.ok(await renglon.getByText('Por pagar $120', { exact: false }).count() === 1, `la fila de ${socio.firstName} dice «Por pagar $120»`);
  r.ok(await lista.getByText('1 por pagar').count() === 1, 'y la cabecera cuenta «1 por pagar»');
  r.ok(await renglon.getByRole('button', { name: 'Cobrar y marcar' }).count() === 1 && await renglon.getByRole('button', { name: 'Llegó', exact: true }).count() === 0, 'su botón es «Cobrar y marcar», no «Llegó»');
  await r.captura(rec, 'cc-3-lista-por-pagar');

  r.paso('cobrar y marcar');
  await renglon.getByRole('button', { name: 'Cobrar y marcar' }).click();
  const cobro = rec.getByRole('dialog', { name: `Cobrar la clase de ${socio.firstName}` });
  await cobro.waitFor({ timeout: T.ui });
  r.ok(/Al cobrar se marca su llegada\./.test(await cobro.innerText()), 'el cobro avisa que al cobrar se marca su llegada');
  await asentado(rec);
  await elegirCaja(cobro);
  const llegada = accion(rec, () => cobro.getByRole('button', { name: /^Cobrar \$120/ }).click(), /\/api\/classes\/bookings\/[^/]+\/checkin$/, { metodo: 'POST', que: 'marcar su llegada tras cobrar' });
  const marcada = await llegada;
  const cobrada = rec.getByRole('dialog', { name: 'Clase cobrada' });
  r.ok(await aparece(cobrada, T.respuesta) && marcada.status() < 300, `queda cobrada y con su llegada marcada (checkin → ${marcada.status()})`);
  await r.captura(rec, 'cc-4-clase-cobrada');
  await cobrada.getByRole('button', { name: 'Listo' }).click();
  await renglon.getByText('Llegó', { exact: true }).waitFor({ timeout: T.respuesta });
  await asentado(rec);
  const trasCobrar = await renglon.innerText();
  r.ok(/Llegó/.test(trasCobrar) && /Pagada/.test(trasCobrar) && !/Por pagar/.test(trasCobrar), 'en la lista su fila pasa a «Pagada» y «Llegó»');
  r.ok(await lista.getByText(/por pagar/).count() === 0, 'y la cabecera ya no cuenta lugares por pagar');
  await r.captura(rec, 'cc-5-lista-pagada');

  // ── 3. La ficha lo refleja ────────────────────────────────────────────────
  r.paso('la ficha lo refleja');
  await rec.goto(`${PANEL}/socios/${socio.id}`, { waitUntil: 'networkidle' });
  const tarjeta = rec.getByTestId('ficha-clases');
  await tarjeta.waitFor({ timeout: T.respuesta });
  const enFicha = tarjeta.getByRole('listitem').filter({ hasText: nombreClase });
  await enFicha.first().waitFor({ timeout: T.respuesta });
  const textoFicha = await enFicha.first().innerText();
  r.ok(/Pagada/.test(textoFicha) && /Llegó/.test(textoFicha), `la tarjeta «Clases» de su ficha dice «Pagada» y «Llegó» (${textoFicha.replace(/\s+/g, ' ').slice(0, 80)})`);
  r.ok(await tarjeta.getByRole('button', { name: 'Cobrar', exact: true }).count() === 0, 'y ya no ofrece «Cobrar» esa clase');
  await r.captura(rec, 'cc-6-ficha-clases', { elemento: tarjeta });
  const reservas = await g.get(`/members/${socio.id}/bookings`);
  const suya = [...reservas.upcoming, ...reservas.recent].find((b) => b.classScheduleId === sesion.id || b.className === nombreClase);
  r.ok(suya?.payment === 'PAID' && !!suya?.checkedInAt, `la API coincide: pago ${suya?.payment}, llegada ${suya?.checkedInAt ? 'marcada' : 'sin marcar'}`);

  // ── 4. Una pausa por fechas, y quitarla ───────────────────────────────────
  r.paso('pausa por fechas');
  const elDia = dia(40);
  r.alFinal(async () => {
    const vivas = (await g.get(`/classes/pauses?branchId=${centro.id}`)).pauses.filter((p) => p.reason === motivoPausa);
    for (const p of vivas) await g.post('/classes/pauses/end', { pauseId: p.id });
  });
  const ger = await r.como('gerencia');
  await ger.goto(`${PANEL}/clases?vista=horario`, { waitUntil: 'networkidle' });
  const pausas = ger.getByTestId('pausas-de-clases');
  await pausas.waitFor({ timeout: T.respuesta });
  await asentado(ger);
  await pausas.getByRole('button', { name: 'Pausar por fechas' }).click();
  const dlg = ger.getByRole('dialog', { name: 'Pausar las clases por fechas' });
  await dlg.getByRole('button', { name: 'Pausar esas fechas' }).click();
  r.ok(await aparece(dlg.getByText('Elige desde qué día.'), T.ui), 'sin fechas no se pausa: el campo dice qué falta');
  await dlg.getByLabel('Desde').fill(tecleada(elDia));
  await dlg.getByLabel('Desde').press('Tab');
  await dlg.getByLabel('Motivo').fill(motivoPausa);
  await r.captura(ger, 'cc-7-pausa');
  const puesta = await accion(ger, () => dlg.getByRole('button', { name: 'Pausar esas fechas' }).click(), '/api/classes/pauses', { metodo: 'POST', que: 'poner la pausa' });
  const creada = await puesta.json().catch(() => null);
  r.ok(puesta.status() === 201 && creada?.pause?.fromDate === elDia && creada?.pause?.toDate === elDia, `la pausa queda de un solo día, el ${elDia} (POST → ${puesta.status()}, ${creada?.pause?.fromDate} a ${creada?.pause?.toDate})`);
  r.ok(await aparece(ger.getByText(/Pausa puesta\./).first(), T.respuesta), 'avisa «Pausa puesta.»');
  if (creada && creada.canceledClasses > 0) r.nota(`la pausa canceló ${creada.canceledClasses} sesiones ya generadas para el ${elDia} (${creada.canceledBookings} reservas); al quitarla vuelven vacías`);
  const renglonPausa = pausas.getByRole('listitem').filter({ hasText: motivoPausa });
  r.ok(await aparece(renglonPausa, T.respuesta) && /Centro/.test(await renglonPausa.innerText()), 'la pausa aparece en «Pausas por fechas» con su motivo y su sucursal');
  await r.captura(ger, 'cc-8-pausa-puesta');
  await accion(ger, () => renglonPausa.getByRole('button', { name: 'Quitar pausa' }).click(), '/api/classes/pauses/end', { metodo: 'POST', que: 'quitar la pausa' });
  r.ok(await aparece(ger.getByText(/Pausa quitada\./).first(), T.respuesta) && await desaparece(renglonPausa, T.respuesta), 'se quita y desaparece de la tarjeta');
  const quedan = (await g.get(`/classes/pauses?branchId=${centro.id}`)).pauses.filter((p) => p.reason === motivoPausa);
  r.ok(quedan.length === 0, 'y la API ya no la lista como viva');
}, { erroresDePagina: 'falla' });
