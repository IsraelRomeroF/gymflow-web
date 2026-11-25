// La caja de la fase 4 (bloque 4.3 · D-17), vista en el navegador:
//
//  1. Una caja que amaneció sin cortar: la dueña lo ve en «Cortes de caja»
//     (solo consulta: ningún botón de operación) y la gerencia en Caja.
//  2. «Retiro del dueño» desde Caja: recepción lo pide, el diálogo dice su tope
//     ANTES de la firma, la dueña firma, sale del cajón y queda en Movimientos
//     con «No resta».
//  3. Recepción corta con $63 de faltante: «Corte hecho» dice a nombre de quién
//     y que queda por revisar, y pregunta «¿Cerrar sesión?» (bloque 4.1).
//  4. La gerencia lo ve en «Hoy te toca» y en «Descuadres por revisar», lo
//     revisa con su nota y la hoja del corte dice quién revisó y qué se resolvió.
//  5. La gerencia corta un turno que abrió recepción: la tarjeta y la hoja
//     dicen de quién es el cajón.
//  6. La dueña filtra los cortes: el suyo ya no está «Por revisar».
//
// Turnos PROPIOS en «Caja 2 Centro» (como cajon y direccion-cierre): se corta
// el que haya abierto al empezar y al terminar. El primero se fecha AYER en
// gymflow_pruebas (es lo único que la API no deja: que amanezca). El retiro
// del dueño ($150) se queda en Movimientos del mes: no resta de la ganancia y
// ya no se puede anular (bloque 4.11), igual que en el uso real.
import { recorrido, sedeDe, accion, asentado, aparece, desaparece, firmar, irPorMenu, sql, dia, hoy, letras, PANEL, T } from './lib/index.mjs';

await recorrido('cortes', async (r) => {
  const g = await r.api('gerencia');
  const rcp = await r.api('recepcion');
  const L = letras(4);
  const cen = await sedeDe(g, 'CEN');
  const caja = (await g.get(`/cash-registers?branchId=${cen.id}`)).registers.find((c) => c.code === 'C2' && c.isActive);
  if (!caja) throw new Error('No hay «Caja 2» en Centro: la siembra cambió');
  const NOMBRE = caja.name;
  const RECEPCION = 'Paola Núñez';
  const GERENCIA = 'Lucía Fernández';

  /** Corta el turno abierto de la Caja 2, si lo hay, con lo que debía haber. */
  const cortar = async () => {
    const abiertos = (await g.get(`/cash-sessions?branchId=${cen.id}&status=OPEN`)).sessions.filter((s) => s.cashRegisterId === caja.id);
    for (const s of abiertos) {
      const { expectedCashCents } = await g.get(`/cash-sessions/${s.id}`);
      await g.post(`/cash-sessions/${s.id}/close`, { countedCashCents: expectedCashCents });
    }
    return abiertos.length;
  };
  /** Los descuadres de esta corrida que se quedaron sin revisar (si se cayó a medias). */
  const mios = [];
  const revisarLosMios = async () => {
    for (const id of mios) {
      const { session } = await g.get(`/cash-sessions/${id}`);
      if (session.varianceStatus === 'PENDING') await g.post(`/cash-sessions/${id}/variance/review`, { note: 'Fin del recorrido de prueba' });
    }
  };
  if (await cortar()) r.nota(`${NOMBRE} tenía un turno abierto de una corrida que no terminó: se cortó antes de empezar`);
  r.alFinal(async () => { await cortar(); await revisarLosMios(); });

  // ── 0. Un turno de recepción que «amaneció» abierto ───────────────────────
  const ayer = dia(-1);
  const turno = await rcp.post('/cash-sessions', { cashRegisterId: caja.id, openingFloatCents: '100000', shiftLabel: 'EVENING' });
  mios.push(turno.id);
  await sql(`update cash_sessions set "businessDate" = $2::date where id = $1`, [turno.id, ayer]);
  const alertas = await g.get(`/cash/alerts?branchId=${cen.id}`);
  r.ok(alertas.open.some((a) => a.id === turno.id && a.stale), `datos de la corrida: recepción abrió ${NOMBRE} con $1,000.00 y su día de operación es ayer (${ayer}): la API la da por «sin cortar»`);

  // ── 1. La dueña: «Cortes de caja», solo consulta ──────────────────────────
  r.paso('cortes de la dueña');
  const own = await r.como('duena');
  await irPorMenu(own, 'Cortes de caja');
  await own.waitForURL('**/caja', { timeout: T.navegacion });
  await own.getByRole('heading', { name: 'Cortes de caja' }).waitFor({ timeout: T.respuesta });
  const avisosDuena = own.getByTestId('avisos-de-caja');
  r.ok(await aparece(avisosDuena.getByText(/amaneci(ó|eron) sin cortar/), T.respuesta) && (await avisosDuena.innerText()).includes(NOMBRE), `la dueña ve el aviso «…amaneció sin cortar» con ${NOMBRE}`);
  const abierta = own.getByTestId('cajas-abiertas').locator('li').filter({ hasText: NOMBRE });
  r.ok(await aparece(abierta, T.respuesta) && /la abrió Paola Núñez desde el .*: sigue sin cortar\./.test(await abierta.innerText()), `«Abiertas ahora»: «${(await abierta.innerText().catch(() => '')).trim()}»`);
  await asentado(own);
  const botonesDeOperacion = await own.getByRole('button', { name: /^(Hacer corte|Retiro o gasto|Abrir turno)$/ }).count();
  r.ok(botonesDeOperacion === 0, 'ni «Hacer corte», ni «Retiro o gasto», ni «Abrir turno»: es solo consulta');
  const filtros = (await own.getByRole('group', { name: 'Qué cortes ver' }).getByRole('button').allInnerTexts()).map((t) => t.trim());
  r.ok(JSON.stringify(filtros) === JSON.stringify(['Todos', 'Con diferencia', 'Por revisar']), `los cortes se filtran por «${filtros.join(' · ')}»`);
  await r.captura(own, 'cortes-1-duena-sin-cortar');

  // ── 2. Retiro del dueño desde Caja ────────────────────────────────────────
  r.paso('retiro del dueño desde caja');
  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  const tarjeta = rec.locator('.card').filter({ hasText: NOMBRE }).filter({ has: rec.getByRole('button', { name: 'Retiro o gasto' }) });
  await tarjeta.waitFor({ timeout: T.respuesta });
  r.ok(await aparece(rec.getByTestId('avisos-de-caja').getByText(/amaneci(ó|eron) sin cortar/), T.respuesta), 'recepción también ve en Caja que la suya amaneció sin cortar');
  await tarjeta.getByRole('button', { name: 'Retiro o gasto' }).click();
  const mv = rec.getByRole('dialog', { name: `Movimiento de efectivo · ${NOMBRE}` });
  await mv.getByLabel('Tipo').selectOption({ label: 'Retiro del dueño' });
  r.ok(await aparece(mv.getByText(/queda anotado en Movimientos como «Retiro del dueño» \(no resta de la ganancia\)\. Siempre pide autorización\. Tu puesto: hasta \$5,000\.00 por turno\. Te quedan \$5,000\.00 en este turno\./), T.ui),
    'antes de la firma el diálogo dice que va a Movimientos, que no resta, y el tope: «Te quedan $5,000.00 en este turno.»');
  await mv.getByLabel('Importe').fill('150');
  await mv.getByLabel('Motivo').fill(`Retiro de la dueña ${L}`);
  await r.captura(rec, 'cortes-2-retiro-del-dueno');
  await mv.getByRole('button', { name: 'Pedir autorización' }).click();
  const f1 = await firmar(rec, 'Autorizar retiro del dueño');
  r.ok((await f1.d.innerText()).includes('$150.00'), 'la firma dice qué autoriza: retiro del dueño de $150.00');
  const retiro = await accion(rec, () => f1.autorizar(), /\/api\/cash-sessions\/[^/]+\/owner-draw$/, { metodo: 'POST', que: 'el retiro del dueño' });
  r.ok(retiro.status() === 201, `con la firma (${f1.quien}) sale del cajón y se anota en un solo paso (${retiro.status()})`);
  r.ok(await aparece(rec.getByText('Retiro del dueño: $150.00'), T.respuesta), 'avisa «Retiro del dueño: $150.00»');
  const { expenseId } = await retiro.json();
  await asentado(rec);
  const enTarjeta = tarjeta.locator('.row-between').filter({ hasText: `Retiro de la dueña ${L}` });
  await enTarjeta.waitFor({ timeout: T.respuesta });
  r.ok((await enTarjeta.innerText()).startsWith('Retiro del dueño'), `la tarjeta del turno lo nombra «Retiro del dueño» («${(await enTarjeta.innerText()).replace(/\s+/g, ' ').trim()}»)`);
  const corteApi = await g.get(`/cash-sessions/${turno.id}`);
  r.ok(corteApi.movements.some((m) => m.ownerDraw && /^-?15000$/.test(m.amountCents)), 'y en el turno queda como retiro del dueño (la API lo marca)');

  // En Movimientos (gerencia, con Movimientos liberado): con «No resta».
  const ger = await r.como('gerencia');
  await ger.goto(`${PANEL}/movimientos`, { waitUntil: 'networkidle' });
  const gasto = ger.locator('li.list-item').filter({ hasText: `Retiro de la dueña ${L}` });
  r.ok(await aparece(gasto, T.respuesta), 'Movimientos → Gastos fijos trae el retiro con su motivo');
  r.ok(await gasto.getByText('No resta', { exact: true }).count() === 1 && /\$150/.test(await gasto.innerText()), 'con «No resta» y $150');
  const delMes = (await g.get(`/expenses?month=${hoy().slice(0, 7)}`)).expenses ?? [];
  r.ok(delMes.some((e) => e.id === expenseId && e.category === 'OWNER_DRAW'), 'la API lo tiene como «Retiro del dueño» del mes');
  await r.captura(ger, 'cortes-3-movimientos-no-resta');

  // ── 3. Recepción corta con $63.00 de faltante ─────────────────────────────
  r.paso('corte con faltante');
  await tarjeta.getByRole('button', { name: 'Hacer corte' }).click();
  const dc = rec.getByRole('dialog', { name: `Corte · ${NOMBRE}` });
  // Debía haber $1,000 − $150 = $850; se cuentan $787.
  for (const [etiqueta, n] of [['Billetes de $500', 1], ['Billetes de $200', 1], ['Billetes de $50', 1], ['Billetes de $20', 1], ['Monedas de $10', 1], ['Monedas de $5', 1], ['Monedas de $2', 1]]) {
    await dc.getByLabel(etiqueta, { exact: true }).fill(String(n));
  }
  r.ok((await dc.locator('.conteo-total strong').innerText()).includes('787'), 'el conteo suma $787.00');
  await dc.getByRole('button', { name: /^Cerrar con/ }).click();
  const motivo = rec.getByRole('dialog', { name: 'La caja no cuadra' });
  await motivo.waitFor({ timeout: T.respuesta });
  r.ok(await motivo.getByText('Faltan $63.00').count() >= 1, 'al contar se revela: «Faltan $63.00»');
  await motivo.getByLabel('Motivo').fill(`Se dio cambio de más ${L}`);
  await motivo.getByRole('button', { name: 'Cerrar con diferencia' }).click();
  const hecho = rec.getByRole('dialog', { name: 'Corte hecho' });
  await hecho.waitFor({ timeout: T.respuesta });
  const veredicto = (await hecho.locator('.corte-veredicto').innerText()).replace(/\s+/g, ' ');
  r.ok(/Faltaron \$63\.00/.test(veredicto) && veredicto.includes(`a nombre de ${RECEPCION}, y por revisar`), `«Corte hecho»: «${veredicto.trim()}»`);
  r.ok(await aparece(hecho.getByTestId('pregunta-cerrar-sesion'), T.ui) && /quien sigue entra con su nombre/.test(await hecho.getByTestId('pregunta-cerrar-sesion').innerText()), '«Corte hecho» pregunta «¿Cerrar sesión?» (bloque 4.1)');
  await r.captura(rec, 'cortes-4-corte-hecho');
  const { session: cortado } = await g.get(`/cash-sessions/${turno.id}`);
  r.ok(cortado.varianceStatus === 'PENDING' && cortado.varianceCents === '-6300' && cortado.responsibleName === RECEPCION, `la API: -6300 por revisar, a nombre de ${cortado.responsibleName}`);
  await hecho.getByTestId('cerrar-sesion-tras-corte').click();
  await rec.waitForURL('**/login**', { timeout: T.navegacion });
  r.ok(await aparece(rec.getByText('Saliste de GymFlow en este equipo'), T.respuesta), '«Cerrar sesión» lleva al login: «Saliste de GymFlow en este equipo»');

  // ── 4. La gerencia lo revisa ──────────────────────────────────────────────
  r.paso('la gerencia revisa');
  await ger.goto(`${PANEL}/panel`, { waitUntil: 'networkidle' });
  const asunto = ger.locator('[data-asunto="variances"]');
  r.ok(await aparece(asunto, T.respuesta) && /por revisar/i.test(await asunto.innerText()), `«Hoy te toca» trae los descuadres por revisar («${(await asunto.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 120)}»)`);
  await ger.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  const lista = ger.getByTestId('descuadres-por-revisar');
  const renglon = lista.locator('li').filter({ has: ger.locator(`a[href="/caja/${turno.id}"]`) });
  await renglon.waitFor({ timeout: T.respuesta });
  r.ok((await renglon.innerText()).includes('Faltan $63.00') && (await renglon.innerText()).includes(RECEPCION), 'en «Descuadres por revisar»: faltan $63.00, de Paola Núñez');
  r.ok(await ger.getByTestId('avisos-de-caja').getByText(/por revisar/).count() >= 1, 'y el aviso de arriba de Caja lo cuenta');
  await renglon.getByRole('button', { name: 'Revisar' }).click();
  const rv = ger.getByRole('dialog', { name: /^Revisar el descuadre · / });
  await rv.waitFor({ timeout: T.ui });
  const textoRv = (await rv.innerText()).replace(/\s+/g, ' ');
  r.ok(textoRv.includes('Faltaron $63.00') && textoRv.includes(`El turno es de ${RECEPCION}`) && textoRv.includes(`Se dio cambio de más ${L}`), 'la revisión dice cuánto, de quién es y lo que se explicó al cortar');
  r.ok(/no descuenta nada del sueldo/.test(textoRv), 'y que el sistema no descuenta nada del sueldo');
  await rv.getByRole('button', { name: 'Cerrar la revisión' }).click();
  r.ok(await aparece(rv.locator('#rv-nota[aria-invalid="true"]'), T.ui), 'sin nota no se cierra: el campo lo pide');
  await rv.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Error al contar', exact: true }).click();
  await r.captura(ger, 'cortes-5-revisar');
  const revision = await accion(ger, () => rv.getByRole('button', { name: 'Cerrar la revisión' }).click(), `/api/cash-sessions/${turno.id}/variance/review`, { metodo: 'POST', que: 'la revisión' });
  r.ok(revision.ok(), `la revisión se cierra (${revision.status()})`);
  r.ok(await aparece(ger.getByText('Descuadre revisado'), T.respuesta), 'avisa «Descuadre revisado»');
  r.ok(await desaparece(renglon, T.respuesta), 'y sale de «Descuadres por revisar»');
  await ger.goto(`${PANEL}/caja/${turno.id}`, { waitUntil: 'networkidle' });
  await ger.getByText('Responsable del cajón').waitFor({ timeout: T.respuesta });
  const hoja = (await ger.locator('main').innerText()).replace(/\s+/g, ' ');
  r.ok(hoja.includes(`Responsable del cajón ${RECEPCION}`), 'la hoja del corte: «Responsable del cajón · Paola Núñez»');
  r.ok(new RegExp(`Revisó ${GERENCIA}`).test(hoja) && hoja.includes('Qué se resolvió: Error al contar'), 'y «Revisó · Lucía Fernández» con «Qué se resolvió: Error al contar»');
  r.ok(hoja.includes('Retiro del dueño') && hoja.includes(`Retiro de la dueña ${L}`), 'el retiro del dueño sale en la hoja con su nombre');
  r.ok(await ger.getByTestId('corte-por-revisar').count() === 0, 'ya no dice «Diferencia por revisar»');
  await r.captura(ger, 'cortes-6-hoja-revisada', { full: true });

  // ── 5. La gerencia corta un turno que abrió recepción ─────────────────────
  r.paso('la gerencia corta un turno ajeno');
  const otro = await rcp.post('/cash-sessions', { cashRegisterId: caja.id, openingFloatCents: '50000', shiftLabel: 'EVENING' });
  mios.push(otro.id);
  await ger.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  const suya = ger.locator('.card').filter({ hasText: NOMBRE }).filter({ has: ger.getByRole('button', { name: 'Hacer corte' }) });
  await suya.waitFor({ timeout: T.respuesta });
  r.ok(await aparece(suya.getByText(`Este turno es de ${RECEPCION}: si lo cortas tú, la diferencia queda a su nombre.`), T.respuesta), 'la tarjeta avisa: «Este turno es de Paola Núñez: si lo cortas tú, la diferencia queda a su nombre.»');
  await suya.getByRole('button', { name: 'Hacer corte' }).click();
  const dg = ger.getByRole('dialog', { name: `Corte · ${NOMBRE}` });
  await dg.getByLabel('Billetes de $500', { exact: true }).fill('1');
  await dg.getByRole('button', { name: /^Cerrar con/ }).click();
  const hecho2 = ger.getByRole('dialog', { name: 'Corte hecho' });
  await hecho2.waitFor({ timeout: T.respuesta });
  r.ok(await hecho2.getByText('La caja cuadró').count() === 1, 'cuadra: «La caja cuadró»');
  await hecho2.getByRole('link', { name: /Ver e imprimir corte/ }).click();
  await ger.waitForURL(`**/caja/${otro.id}`, { timeout: T.navegacion });
  await ger.getByText('Responsable del cajón').waitFor({ timeout: T.respuesta });
  const hoja2 = (await ger.locator('main').innerText()).replace(/\s+/g, ' ');
  r.ok(hoja2.includes(`Responsable del cajón ${RECEPCION} · abrió el turno; lo cortó otra persona`), 'la hoja: «Responsable del cajón · Paola Núñez · abrió el turno; lo cortó otra persona»');

  // ── 6. La dueña filtra los cortes ─────────────────────────────────────────
  r.paso('la dueña filtra');
  await own.reload({ waitUntil: 'networkidle' });
  await own.getByRole('heading', { name: 'Cortes de caja' }).waitFor({ timeout: T.respuesta });
  const fila = own.locator(`tr:has(a[href="/caja/${turno.id}"])`);
  await own.getByRole('group', { name: 'Qué cortes ver' }).getByRole('button', { name: 'Con diferencia' }).click();
  r.ok(await aparece(fila, T.respuesta), '«Con diferencia» trae el corte del faltante');
  r.ok((await fila.innerText()).includes(`Revisado · ${GERENCIA}`) && (await fila.innerText()).includes('Faltan $63.00'), 'con «Faltan $63.00» y «Revisado · Lucía Fernández»');
  r.ok(await own.locator('table').getByRole('button', { name: 'Revisar', exact: true }).count() === 0, 'la dueña no tiene «Revisar» en sus cortes: lo hace la gerencia');
  await own.getByRole('group', { name: 'Qué cortes ver' }).getByRole('button', { name: 'Por revisar' }).click();
  r.ok(await desaparece(fila, T.respuesta), '«Por revisar» ya no lo trae');
  r.ok(await own.getByTestId('cajas-abiertas').locator('li').filter({ hasText: NOMBRE }).count() === 0, `y ${NOMBRE} ya no está en «Abiertas ahora»`);
  await r.captura(own, 'cortes-7-duena-filtros');
}, { erroresDePagina: 'informa' });
