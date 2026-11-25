// Nómina y gastos que se repiten (fase 4, bloque 4.5 · D-26), vistos en el navegador:
//
//  1. La dueña anota un pago de nómina: a quién, fecha e importe, «Se repite ·
//     cada quincena». En la lista sale con el nombre, «pagado el …» y «Se repite».
//  2. La gerencia anota una renta que se repite; al anularla queda «Por
//     confirmar» y no cuenta; «Confirmar» con otro importe (y para las
//     siguientes) la vuelve a sumar con ese importe; «Descartar» no mueve nada.
//  3. Un gerente que solo tiene el Tablero (sin Movimientos) no tiene
//     Movimientos en su menú y la API no le dice a quién se le pagó.
//  4. Personal → ese gerente → «Qué ve»: el aviso de que Movimientos enseña la nómina.
//  5. Recepción: 403 en los gastos.
//
// Todo es de la corrida: la nota del pago, la renta y el gerente llevan su
// sufijo. Al terminar, pase lo que pase, lo que se repite deja de repetirse,
// los gastos se anulan y el gerente se da de baja (así no deja propuestas
// «por confirmar» en «Hoy te toca» de nadie ni cifras en el mes).
import { recorrido, accion, asentado, aparece, irPorMenu, abrirMenu, teclear, elegirContrasena, hoy, letras, sufijo, PANEL, T } from './lib/index.mjs';

await recorrido('nomina', async (r) => {
  const g = await r.api('gerencia');
  const own = await r.api('duena');
  const L = letras(4);
  const NOTA = `Quincena ${L}`;
  const RENTA = `Renta de bodega ${L}`;
  const mes = hoy().slice(0, 7);
  const correo = `gerente.tablero.${sufijo()}@correo.invalid`;
  const NOMBRE_GERENTE = `Ramiro Tablero ${L}`;

  const deLaCorrida = (x) => x.description === NOTA || x.description === RENTA;
  r.alFinal(async () => {
    const rep = await g.get(`/expenses/recurring?month=${mes}`);
    for (const t of rep.recurring.filter(deLaCorrida)) await g.post('/expenses/recurring/end', { recurringId: t.id, reason: 'Fin del recorrido de prueba' });
    const { expenses } = await g.get(`/expenses?month=${mes}`);
    for (const e of expenses.filter((x) => deLaCorrida(x) && !x.voidedAt)) await g.post(`/expenses/${e.id}/void`, { reason: 'Fin del recorrido de prueba' });
    const u = (await g.get('/users')).users.find((x) => x.email === correo);
    if (u?.isActive) await g.patch(`/users/${u.id}`, { isActive: false, reason: 'Cuenta de un recorrido de prueba' });
  });

  /** La tarjeta «Gastos fijos» de Movimientos y su cifra del mes («$X en gastos»). */
  const tarjetaDe = (p) => p.locator('.card').filter({ has: p.getByRole('heading', { name: /^Gastos fijos/ }) }).first();
  const enGastos = async (p) => {
    const m = /· \$([\d,]+) en gastos/.exec(await tarjetaDe(p).innerText());
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };

  // ── 1. La dueña anota un pago de nómina que se repite ─────────────────────
  r.paso('pago de nómina');
  const duena = await r.como('duena');
  await irPorMenu(duena, 'Movimientos');
  await duena.waitForURL('**/movimientos', { timeout: T.navegacion });
  const gf = tarjetaDe(duena);
  await gf.getByRole('button', { name: 'Registrar' }).waitFor({ timeout: T.respuesta });
  await gf.getByRole('button', { name: 'Registrar' }).click();
  let d = duena.getByRole('dialog');
  await d.getByLabel('Tipo').selectOption({ label: 'Nómina' });
  await d.getByLabel('A quién').waitFor({ timeout: T.ui });
  r.ok(/Cuánto se le paga a cada persona lo ve quien tiene Movimientos/.test(await d.innerText()), 'el diálogo dice quién va a ver cuánto se le paga a cada persona');
  const registrar = d.getByRole('button', { name: 'Registrar' });
  r.ok(await registrar.isDisabled(), 'sin persona ni importe no se registra');
  // Las opciones se llenan con la API: se espera a la de Paola.
  await d.locator('#gf-q option').filter({ hasText: /^Paola Núñez/ }).waitFor({ state: 'attached', timeout: T.respuesta });
  const opcion = await d.locator('#gf-q option').filter({ hasText: /^Paola Núñez/ }).first().getAttribute('value');
  await d.getByLabel('A quién').selectOption(opcion);
  r.ok((await d.locator('#gf-f').inputValue().catch(() => '')) !== '' || await d.getByLabel('Fecha del pago').count() === 1, 'pide la fecha del pago');
  await d.getByLabel('Importe del pago').fill('3200');
  await d.getByLabel('Nota (opcional)').fill(NOTA);
  await d.getByRole('switch', { name: 'Se repite' }).click();
  await d.getByLabel('Cada cuánto se repite').selectOption({ label: 'Cada quincena (el 15 y el último día)' });
  r.ok(/Se propondrá cada quincena «por confirmar»/.test(await d.innerText()), 'dice que se propondrá cada quincena «por confirmar» y que no se anota solo');
  await r.captura(duena, 'nomina-1-pago');
  const pago = await accion(duena, () => registrar.click(), '/api/expenses', { metodo: 'POST', que: 'el pago de nómina' });
  r.ok(pago.ok(), `el pago se registra (${pago.status()})`);
  r.ok(await aparece(duena.getByText('Pago de nómina anotado; se propondrá cada quincena'), T.respuesta), 'avisa «Pago de nómina anotado; se propondrá cada quincena»');
  await asentado(duena);
  const renglon = gf.locator('li.list-item').filter({ hasText: NOTA });
  await renglon.waitFor({ timeout: T.respuesta });
  const tr = (await renglon.innerText()).replace(/\s+/g, ' ');
  r.ok(tr.startsWith('Paola Núñez') && /Nómina · pagado el /.test(tr) && tr.includes('Se repite') && /\$3,200/.test(tr), `en la lista: «${tr.slice(0, 160)}»`);
  const conPersona = (await own.get(`/expenses?month=${mes}`)).expenses.find((e) => e.description === NOTA);
  r.ok(conPersona?.category === 'PAYROLL' && conPersona.payeeName === 'Paola Núñez' && !!conPersona.paidOn && !!conPersona.recurringId, 'la API lo guarda con persona, fecha y lo que se repite');

  // ── 2. La renta que se repite: por confirmar, confirmar con otro importe, descartar ─
  r.paso('renta que se repite');
  const ger = await r.como('gerencia');
  await ger.goto(`${PANEL}/movimientos`, { waitUntil: 'networkidle' });
  const gg = tarjetaDe(ger);
  await gg.getByRole('button', { name: 'Registrar' }).click();
  d = ger.getByRole('dialog');
  await d.getByLabel('Tipo').selectOption({ label: 'Renta' });
  await d.getByLabel('Descripción').fill(RENTA);
  await d.getByLabel('Importe del mes').fill('9000');
  await d.getByRole('switch', { name: 'Se repite' }).click();
  await accion(ger, () => d.getByRole('button', { name: 'Registrar' }).click(), '/api/expenses', { metodo: 'POST', que: 'la renta' });
  r.ok(await aparece(ger.getByText('Gasto registrado; se propondrá cada mes'), T.respuesta), 'avisa «Gasto registrado; se propondrá cada mes»');
  await asentado(ger);
  // La que se puede anular: la viva (la anulada queda tachada y sin botón; la plantilla está en «Lo que se repite»).
  const renta = gg.locator('li.list-item').filter({ hasText: RENTA }).filter({ has: ger.getByRole('button', { name: `Anular ${RENTA}` }) });
  await renta.waitFor({ timeout: T.respuesta });
  const conRenta = await enGastos(ger);
  await renta.getByRole('button', { name: `Anular ${RENTA}` }).click();
  d = ger.getByRole('dialog', { name: `Anular ${RENTA}` });
  r.ok(/Como se repite, volverá a quedar por confirmar/.test(await d.innerText()), 'anular avisa que volverá a quedar por confirmar');
  await d.getByLabel('Motivo').fill('Capturado con otro importe');
  await accion(ger, () => d.getByRole('button', { name: 'Anular' }).click(), /\/api\/expenses\/[^/]+\/void$/, { metodo: 'POST', que: 'la anulación' });
  await asentado(ger);
  const porConfirmar = ger.getByTestId('gastos-por-confirmar');
  const propuesta = porConfirmar.getByTestId('propuesta').filter({ hasText: RENTA });
  r.ok(await aparece(propuesta, T.respuesta), `anulada, «${RENTA}» aparece en «Por confirmar»`);
  r.ok(/no cuentan en ninguna cifra hasta confirmarlos/.test(await porConfirmar.innerText()), 'y dice que no cuenta en ninguna cifra');
  const sinRenta = await enGastos(ger);
  r.ok(conRenta !== null && sinRenta === conRenta - 9000, `la cifra del mes ya no la suma ($${conRenta} → $${sinRenta})`);
  await r.captura(ger, 'nomina-2-por-confirmar');

  await propuesta.getByRole('button', { name: 'Confirmar' }).click();
  d = ger.getByRole('dialog', { name: `Confirmar ${RENTA}` });
  await d.locator('#cp-m').fill('9500');
  r.ok(await aparece(d.getByText('Lo propuesto era $9,000.00.'), T.ui), 'al corregir el importe dice lo propuesto ($9,000.00)');
  await d.getByRole('switch', { name: 'Proponer este importe también las siguientes veces' }).click();
  await accion(ger, () => d.getByRole('button', { name: 'Confirmar' }).click(), '/api/expenses/recurring/confirm', { metodo: 'POST', que: 'la confirmación' });
  r.ok(await aparece(ger.getByText('Confirmado: ya cuenta como gasto'), T.respuesta), 'avisa «Confirmado: ya cuenta como gasto»');
  await asentado(ger);
  r.ok(await propuesta.count() === 0, 'sale de «Por confirmar»');
  const confirmada = await enGastos(ger);
  r.ok(confirmada === sinRenta + 9500, `la cifra del mes sube exactamente $9,500 ($${sinRenta} → $${confirmada})`);
  const plantilla = (await g.get(`/expenses/recurring?month=${mes}`)).recurring.find((x) => x.description === RENTA);
  r.ok(plantilla?.amountCents === '950000', 'y las siguientes se propondrán por $9,500 (la API lo confirma)');

  // Otra vez por confirmar, y ahora se descarta: ninguna cifra se mueve.
  r.paso('descartar');
  await renta.getByRole('button', { name: `Anular ${RENTA}` }).click();
  d = ger.getByRole('dialog', { name: `Anular ${RENTA}` });
  await d.getByLabel('Motivo').fill('Este mes la paga el arrendatario');
  await accion(ger, () => d.getByRole('button', { name: 'Anular' }).click(), /\/api\/expenses\/[^/]+\/void$/, { metodo: 'POST', que: 'la segunda anulación' });
  await asentado(ger);
  await propuesta.waitFor({ timeout: T.respuesta });
  const antesDeDescartar = await enGastos(ger);
  await propuesta.getByRole('button', { name: new RegExp(`^Descartar ${RENTA}`) }).click();
  d = ger.getByRole('dialog', { name: `Descartar ${RENTA}` });
  r.ok(/No se anota ningún gasto por esta vez/.test(await d.innerText()), 'descartar dice que no se anota ningún gasto');
  await accion(ger, () => d.getByRole('button', { name: 'Descartar' }).click(), '/api/expenses/recurring/skip', { metodo: 'POST', que: 'el descarte' });
  r.ok(await aparece(ger.getByText('Descartado: no se anotó ningún gasto'), T.respuesta), 'avisa «Descartado: no se anotó ningún gasto»');
  await asentado(ger);
  r.ok(await propuesta.count() === 0 && await enGastos(ger) === antesDeDescartar, `sale de «Por confirmar» y la cifra no se mueve ($${antesDeDescartar})`);
  const repite = gg.getByTestId('gastos-se-repiten');
  await repite.locator('summary').click();
  r.ok(new RegExp(`Descartados en .*${RENTA} del .*Lucía Fernández`).test((await repite.innerText()).replace(/\s+/g, ' ')), '«Lo que se repite» dice qué se descartó y quién');
  await r.captura(ger, 'nomina-3-se-repite', { full: true });

  // ── 3. Un gerente con el Tablero y sin Movimientos ────────────────────────
  r.paso('gerente solo con Tablero');
  const { temporaryPassword, user } = await g.post('/users', { email: correo, fullName: NOMBRE_GERENTE, phoneE164: null, roleKey: 'MANAGER', branchIds: [], reason: 'Cuenta de un recorrido de prueba' });
  await own.put(`/users/${user.id}/sections`, { sections: ['tablero'], reason: 'Solo el Tablero (recorrido de prueba)' });
  const tab = await r.nueva();
  await tab.goto(`${PANEL}/login`, { waitUntil: 'networkidle' });
  await teclear(tab, correo, temporaryPassword);
  await elegirContrasena(tab, `TableroSolo.${L}.2026`);
  await tab.waitForURL('**/panel', { timeout: T.navegacion });
  await abrirMenu(tab);
  r.ok(await tab.getByRole('link', { name: 'Tablero', exact: true }).count() === 1 && await tab.getByRole('link', { name: 'Movimientos', exact: true }).count() === 0, 'en su menú está el Tablero y no Movimientos');
  const loQueVe = await tab.evaluate(async (m) => { const x = await fetch(`/api/expenses?month=${m}`); return { status: x.status, body: await x.json() }; }, mes);
  r.ok(loQueVe.status === 200 && !loQueVe.body.expenses.some((e) => e.category === 'PAYROLL' && e.payeeName), `la API le da los gastos del mes sin la nómina por persona (${loQueVe.status})`);
  r.ok((loQueVe.body.hiddenPayroll?.count ?? 0) >= 1, `de la nómina solo «${loQueVe.body.hiddenPayroll?.count} pagos por …»`);
  r.ok(loQueVe.body.expenses.some((e) => e.description === RENTA), 'y los gastos que no nombran a nadie sí (la renta)');
  const anota = await tab.evaluate(async () => (await fetch('/api/expenses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category: 'OTHER', description: 'No debe pasar', amountCents: '100', branchId: null, month: new Date().toISOString().slice(0, 7) }) })).status);
  r.ok(anota === 403, `y no anota gastos (${anota})`);

  // ── 4. «Qué ve»: el aviso de Movimientos ──────────────────────────────────
  r.paso('qué ve');
  await duena.goto(`${PANEL}/personal`, { waitUntil: 'networkidle' });
  await duena.locator('tbody tr').filter({ hasText: correo }).getByRole('button', { name: 'Qué ve' }).click();
  const qv = duena.getByRole('dialog', { name: NOMBRE_GERENTE });
  const aviso = qv.getByTestId('aviso-llave-movimientos');
  r.ok(await aparece(aviso, T.ui) && /ve cuánto se le paga a cada persona del gimnasio/.test(await aviso.innerText()), `bajo Movimientos, el aviso: «${(await aviso.innerText().catch(() => '')).trim()}»`);
  r.ok(!(await qv.getByRole('switch', { name: 'Movimientos' }).isChecked()), 'con Movimientos apagado');
  await r.captura(duena, 'nomina-4-que-ve');
  await duena.keyboard.press('Escape');

  // ── 5. Recepción ──────────────────────────────────────────────────────────
  r.paso('recepción');
  const rec = await r.como('recepcion');
  const deRecepcion = await rec.evaluate(async (m) => (await fetch(`/api/expenses?month=${m}`)).status, mes);
  r.ok(deRecepcion === 403, `recepción no ve los gastos (${deRecepcion})`);
}, { erroresDePagina: 'informa' });
