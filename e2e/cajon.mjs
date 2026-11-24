// El efectivo del cajón (fase 3, bloque 3.5 · D-15), visto en el navegador:
//
//  1. Recepción anota un gasto de caja chica de $60 con motivo y SIN firma.
//  2. Otro de $450 en el mismo turno pasa del tope de $500 por turno: pide la
//     firma de la dueña, y con ella se registra.
//  3. Un retiro a caja fuerte siempre pide firma ($300).
//  4. Recepción no pasa de $5,000 de retiros por turno ni con firma, y el diálogo
//     lo dice ANTES de pedir la firma (fase 4, bloque 4.3).
//  5. La gerencia cambia los topes del cajón con la firma de la dueña; recepción
//     no ve «Cambiar…».
//
// Turno PROPIO: recepción abre «Caja 2 Centro» (la semilla la deja cerrada) con
// $6,000 de fondo, y al terminar la gerencia lo corta con lo que debía haber
// (cuadra). Así el tope por turno empieza en cero en cada corrida y nadie más
// pierde efectivo. Los topes vuelven a los de fábrica al terminar (se borra en
// gymflow_pruebas el ajuste que hizo el recorrido).
import { recorrido, sedeDe, letras, accion, asentado, aparece, firmar, sql, PANEL, T } from './lib/index.mjs';

await recorrido('cajon', async (r) => {
  const g = await r.api('gerencia');
  const rcp = await r.api('recepcion');
  const L = letras(4);
  const cen = await sedeDe(g, 'CEN');
  const caja = (await g.get(`/cash-registers?branchId=${cen.id}`)).registers.find((c) => c.code === 'C2' && c.isActive);
  if (!caja) throw new Error('No hay «Caja 2» en Centro: la siembra cambió');
  const NOMBRE = caja.name;

  /** Corta el turno abierto de la Caja 2, si lo hay, con lo que debía haber. */
  const cortar = async () => {
    const abiertos = (await g.get(`/cash-sessions?branchId=${cen.id}&status=OPEN`)).sessions.filter((s) => s.cashRegisterId === caja.id);
    for (const s of abiertos) {
      const { expectedCashCents } = await g.get(`/cash-sessions/${s.id}`);
      await g.post(`/cash-sessions/${s.id}/close`, { countedCashCents: expectedCashCents });
    }
    return abiertos.length;
  };
  const topesDeFabrica = () => sql(`delete from cash_settings where "organizationId" = (select id from organizations where "tradeName" = 'Gimnasio Demo') returning "organizationId"`);
  if (await cortar()) r.nota(`${NOMBRE} tenía un turno abierto de una corrida que no terminó: se cortó antes de empezar`);
  await topesDeFabrica();
  r.alFinal(async () => { await cortar(); await topesDeFabrica(); });

  const turno = await rcp.post('/cash-sessions', { cashRegisterId: caja.id, openingFloatCents: '600000', shiftLabel: 'EVENING' });
  const topes = await g.get('/cash/limits');
  r.ok(topes.isDefault && topes.pettyLimitCents === '50000' && topes.withdrawalShiftLimitCents === '500000', `datos de la corrida: recepción abrió ${NOMBRE} con $6,000.00; topes de fábrica ($500 y $5,000)`);
  const movimientos = async () => (await g.get(`/cash-sessions/${turno.id}`)).movements;

  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  const tarjeta = rec.locator('.card').filter({ hasText: NOMBRE }).filter({ has: rec.getByRole('button', { name: 'Retiro o gasto' }) });
  await tarjeta.waitFor({ timeout: T.respuesta });
  await asentado(rec);
  r.ok(await rec.getByText('Topes del cajón').count() === 0, 'recepción no ve «Topes del cajón · Cambiar…»');

  /** Abre «Retiro o gasto» de la Caja 2, elige el tipo y llena importe y motivo. */
  async function movimiento(tipo, importe, motivo) {
    await tarjeta.getByRole('button', { name: 'Retiro o gasto' }).click();
    const d = rec.getByRole('dialog', { name: `Movimiento de efectivo · ${NOMBRE}` });
    await d.getByLabel('Tipo').selectOption({ label: tipo });
    await d.getByLabel('Importe').fill(importe);
    await d.getByLabel('Motivo').fill(motivo);
    return d;
  }

  // ── 1. Gasto chico sin firma ──────────────────────────────────────────────
  r.paso('gasto chico sin firma');
  let d = await movimiento('Gasto de caja chica', '60', `Garrafón de agua ${L}`);
  r.ok(await aparece(d.getByText('Hasta $500.00 por turno no pide autorización; arriba, sí.'), T.ui), 'el diálogo dice el tope: «Hasta $500.00 por turno no pide autorización; arriba, sí.»');
  await r.captura(rec, 'cajon-1-gasto-chico');
  const chico = await accion(rec, () => d.getByRole('button', { name: 'Registrar', exact: true }).click(), /\/api\/cash-sessions\/[^/]+\/petty-movements$/, { metodo: 'POST', que: 'el gasto chico' });
  r.ok(chico.ok(), `recepción anota $60.00 con motivo y sin firma (${chico.status()})`);
  r.ok(await aparece(rec.getByText('Gasto de caja chica: $60.00'), T.respuesta), 'avisa «Gasto de caja chica: $60.00»');
  await asentado(rec);

  // ── 2. El tope de $500 es por turno: $60 + $450 pide firma ────────────────
  r.paso('gasto que pasa del tope del turno');
  d = await movimiento('Gasto de caja chica', '450', `Material de limpieza ${L}`);
  const sinFirma = await accion(rec, () => d.getByRole('button', { name: 'Registrar', exact: true }).click(), /\/api\/cash-sessions\/[^/]+\/petty-movements$/, { metodo: 'POST', que: 'el gasto que pasa del tope' });
  r.ok(sinFirma.status() === 428, `$450.00 más en el mismo turno pasa de $500.00: la API pide firma (${sinFirma.status()})`);
  const f1 = await firmar(rec, 'Autorizar gasto de caja chica');
  r.ok((await f1.d.innerText()).includes('$450.00') && (await f1.d.innerText()).includes(`Material de limpieza ${L}`), 'la firma dice qué se autoriza: el gasto, su motivo y $450.00');
  await r.captura(rec, 'cajon-2-firma-gasto');
  const conFirma = await accion(rec, () => f1.autorizar(), /\/api\/cash-sessions\/[^/]+\/petty-movements$/, { metodo: 'POST', que: 'el gasto firmado' });
  r.ok(conFirma.ok(), `con la firma (${f1.quien}) se registra (${conFirma.status()})`);
  await rec.getByText('Gasto de caja chica: $450.00').waitFor({ timeout: T.respuesta });
  await asentado(rec);

  // ── 3. El retiro siempre pide firma ───────────────────────────────────────
  r.paso('retiro con firma');
  d = await movimiento('Retiro a caja fuerte', '300', `Retiro de media tarde ${L}`);
  r.ok(await aparece(d.getByText(/Siempre pide autorización\. Tu puesto: hasta \$5,000\.00 por turno\./), T.ui), 'el retiro dice «Siempre pide autorización. Tu puesto: hasta $5,000.00 por turno.»');
  r.ok(await d.getByRole('button', { name: 'Registrar', exact: true }).count() === 0, 'no hay «Registrar»: solo «Pedir autorización»');
  await d.getByRole('button', { name: 'Pedir autorización' }).click();
  const f2 = await firmar(rec, 'Autorizar retiro a caja fuerte');
  const retiro = await accion(rec, () => f2.autorizar(), /\/api\/cash-sessions\/[^/]+\/movements$/, { metodo: 'POST', que: 'el retiro firmado' });
  r.ok(retiro.ok(), `con la firma (${f2.quien}) el retiro de $300.00 queda en el turno (${retiro.status()})`);
  await rec.getByText('Retiro a caja fuerte: $300.00').waitFor({ timeout: T.respuesta });
  await asentado(rec);
  const movs = await movimientos();
  r.ok(movs.length === 3 && movs.filter((m) => m.approvedByUserId).length === 2, `el turno tiene los tres movimientos; dos con quién autorizó (${movs.length}, ${movs.filter((m) => m.approvedByUserId).length})`);

  // ── 4. Recepción no pasa de $5,000 por turno ni con firma ─────────────────
  // Fase 4, bloque 4.3 (defecto D1 de 3.13): la pantalla lo dice ANTES de pedir la firma. La API le
  // dice al diálogo cuánto le queda al puesto en el turno (`GET /cash-sessions/:id/allowance`).
  r.paso('tope de retiros de recepción');
  const queda = await rcp.get(`/cash-sessions/${turno.id}/allowance`);
  r.ok(queda.withdrawal.role === 'CON_TOPE' && queda.withdrawal.remainingCents === '470000', `la API dice que a recepción le quedan $4,700.00 de retiros en el turno (${queda.withdrawal.remainingCents})`);
  d = await movimiento('Retiro a caja fuerte', '4800', `Retiro grande ${L}`);
  r.ok(await aparece(d.getByText(/Te quedan \$4,700\.00 en este turno\./), T.ui), 'el diálogo dice «Te quedan $4,700.00 en este turno.»');
  await d.getByRole('button', { name: 'Pedir autorización' }).click();
  const porque = d.getByText(/Pasa de lo que tu puesto puede retirar o depositar en este turno \(te quedan \$4,700\.00\)/).first();
  r.ok(await aparece(porque, T.ui), `$300.00 + $4,800.00 pasa de $5,000.00 y el diálogo lo dice sin pedir la firma: «${(await porque.innerText().catch(() => '')).trim().slice(0, 200)}»`);
  r.ok(await rec.getByRole('dialog', { name: 'Autorizar retiro a caja fuerte' }).count() === 0, 'no se abre «Autorizar retiro a caja fuerte»: nadie teclea su contraseña para algo que no va a pasar');
  // La regla sigue en la API: pedirlo directo, aun con el importe permitido por la firma, responde 403.
  const directo = await rcp.crudo('POST', `/cash-sessions/${turno.id}/movements`, { movementType: 'WITHDRAWAL', amountCents: '480000', reason: `Retiro grande ${L}` });
  r.ok(directo.status === 403, `y la API tampoco lo deja pasar por fuera de la pantalla (${directo.status})`);
  await r.captura(rec, 'cajon-3-tope-del-puesto');
  await d.getByRole('button', { name: 'Cancelar' }).click();
  r.ok((await movimientos()).length === 3, 'el turno sigue con tres movimientos: no salió nada');

  // ── 5. La gerencia cambia los topes con la firma de la dueña ──────────────
  r.paso('topes del cajón');
  const ger = await r.como('gerente');
  await ger.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  const aviso = ger.locator('.callout').filter({ hasText: 'Topes del cajón' });
  await aviso.waitFor({ timeout: T.respuesta });
  r.ok(/hasta \$500\.00 por turno/.test(await aviso.innerText()) && /hasta \$5,000\.00 por turno/.test(await aviso.innerText()) && /Son los de fábrica/.test(await aviso.innerText()), 'la gerencia ve los topes: $500.00 y $5,000.00, «Son los de fábrica»');
  await aviso.getByRole('button', { name: 'Cambiar…' }).click();
  const tp = ger.getByRole('dialog', { name: 'Topes del cajón' });
  await tp.getByLabel('Fondo y gastos sin autorización, por turno').fill('400');
  const pedir = tp.getByRole('button', { name: 'Pedir autorización' });
  r.ok(await pedir.isDisabled(), 'sin motivo no se pide el cambio');
  await tp.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Lo pidió la dueña' }).click();
  await r.captura(ger, 'cajon-4-topes');
  await pedir.click();
  const f4 = await firmar(ger, 'Autorizar el cambio de los topes del cajón');
  const cambio = await accion(ger, () => f4.autorizar(), '/api/cash/limits', { metodo: 'PUT', que: 'el cambio de topes' });
  r.ok(cambio.ok(), `con la firma (${f4.quien}) los topes cambian (${cambio.status()})`);
  r.ok(await aparece(ger.getByText('Topes del cajón actualizados'), T.respuesta), 'avisa «Topes del cajón actualizados»');
  r.ok(await aparece(aviso.getByText(/hasta \$400\.00 por turno/), T.respuesta) && !/Son los de fábrica/.test(await aviso.innerText()), 'el aviso pasa a $400.00 y ya no dice «de fábrica»');
  const nuevos = await g.get('/cash/limits');
  r.ok(nuevos.pettyLimitCents === '40000' && nuevos.isDefault === false, 'y la API lo confirma (40000, ya no de fábrica)');
}, { erroresDePagina: 'informa' });
