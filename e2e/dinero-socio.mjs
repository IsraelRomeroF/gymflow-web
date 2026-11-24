// Dinero del socio (fase 3, bloque 3.5 · D-12 y D-13), visto en el navegador:
//
//  1. Cancelar con deuda: el diálogo dice «Debe $X y esa deuda no se borra»;
//     cancelar sin tocar nada deja la deuda en su estado de cuenta.
//  2. «Perdonarla…»: cabe en una mensualidad → sin firma; con el tope ya
//     gastado (se le perdonó $1 antes) pide la firma de la dueña.
//  3. Devolver «Una parte» de un cobro por transferencia: referencia
//     obligatoria y firma; el cargo no vuelve a deberse.
//  4. Cancelar una membresía pagada: lo no usado queda «A favor»; «Devolver
//     saldo a favor» lo regresa por transferencia, con firma.
//  5. Tienda: recepción marca una venta «por corregir» (no anula ni devuelve);
//     la gerencia la ve en Caja, anula la del día y registra la devolución de
//     la de ayer con firma.
//
// Datos propios: socios «Zavala…» de la corrida y dos ventas de agua por
// transferencia (no mueven efectivo de ningún turno). La venta «de ayer» se
// arma recorriendo un día la fecha de ESA venta en gymflow_pruebas. Nada
// compartido cambia.
import { randomUUID } from 'node:crypto';
import { recorrido, socioSuspendido, socioAlCorriente, sedeDe, letras, sufijo, accion, asentado, aparece, desaparece, firmar, sql, PANEL, T } from './lib/index.mjs';

const pesos = (cents) => `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

await recorrido('dinero-socio', async (r) => {
  const g = await r.api('gerencia');
  const rcp = await r.api('recepcion');
  const L = letras(4);
  const cen = await sedeDe(g, 'CEN');
  const deuda = async (socio) => BigInt((await g.get(`/members/${socio.id}/debt`)).outstandingCents);

  // Los tres socios de la corrida.
  const deja = await socioSuspendido(g, { mesesAtras: 0 });          // debe una mensualidad; se cancela y la deuda se queda
  const perdona = await socioSuspendido(g, { mesesAtras: 0 });       // debe una mensualidad, y ya gastó $1 de su tope de perdón
  const paga = await socioAlCorriente(g, { sede: 'CEN' });           // pagó hoy por transferencia
  const debeDeja = await deuda(deja);
  const cargoChico = await g.post(`/members/${perdona.id}/charges`, { chargeType: 'MANUAL_ADJUSTMENT', concept: `Toalla ${L}`, subtotalCents: '100', branchId: cen.id, reason: 'Cargo de un recorrido de prueba', requestKey: randomUUID() });
  await g.post(`/charges/${cargoChico.id ?? cargoChico.charge?.id}/adjustments`, { adjustmentType: 'WAIVER', amountCents: '100', reasonCode: 'CORTESIA', reason: 'Cortesía de la gerencia' });
  const debePerdona = await deuda(perdona);
  r.ok(debeDeja > 0n && debePerdona === debeDeja, `datos de la corrida: ${deja.memberCode} y ${perdona.memberCode} deben ${pesos(debeDeja)} (a ${perdona.memberCode} ya se le perdonó $1.00 sin firma); ${paga.memberCode} pagó hoy`);

  const ger = await r.como('gerente');
  const abrirCancelar = async (socio) => {
    await ger.goto(`${PANEL}/socios/${socio.id}`, { waitUntil: 'networkidle' });
    await ger.getByRole('button', { name: 'Cancelar membresía' }).click();
    const d = ger.getByRole('dialog', { name: /^Cancelar la membresía de / });
    await d.getByTestId('adeudo-al-cerrar').waitFor({ timeout: T.respuesta });
    return d;
  };

  // ── 1. Cancelar con deuda: la deuda se queda ──────────────────────────────
  r.paso('cancelar con deuda');
  let d = await abrirCancelar(deja);
  const aviso = d.getByTestId('adeudo-al-cerrar');
  r.ok(await aparece(aviso.getByText(`Debe ${pesos(debeDeja)} y esa deuda no se borra`), T.ui), `al cancelar, el diálogo dice «Debe ${pesos(debeDeja)} y esa deuda no se borra»`);
  r.ok(await aviso.getByRole('button', { name: 'Perdonarla…' }).count() === 1 && await aviso.getByText('Cabe en una mensualidad suya: no pide autorización.').count() === 1,
    'ofrece «Perdonarla…» y dice que cabe en una mensualidad (sin autorización)');
  await r.captura(ger, 'dinero-socio-1-cancelar');
  r.ok(await d.getByRole('button', { name: 'Cancelar membresía' }).isDisabled(), 'sin motivo no se cancela');
  await d.getByLabel('Motivo').fill('Se muda de ciudad (recorrido de prueba)');
  const cancelada = await accion(ger, () => d.getByRole('button', { name: 'Cancelar membresía' }).click(), /\/api\/memberships\/[^/]+\/cancel$/, { metodo: 'POST', que: 'la cancelación' });
  r.ok(cancelada.ok(), `se cancela sin perdonar nada (${cancelada.status()})`);
  await ger.getByText(/Membresía cancelada/).first().waitFor({ timeout: T.respuesta });
  await asentado(ger);
  r.ok(await deuda(deja) === debeDeja, `y la deuda sigue entera por la API (${pesos(await deuda(deja))})`);
  await ger.getByRole('tab', { name: /Estado de cuenta/ }).click();
  const totales = ger.getByTestId('cuenta-totales');
  await totales.waitFor({ timeout: T.respuesta });
  r.ok((await totales.innerText()).includes(pesos(debeDeja).slice(1)), `su estado de cuenta sigue diciendo que debe ${pesos(debeDeja)}`);

  // ── 2. Perdonar: con el tope gastado pide firma ───────────────────────────
  r.paso('perdonar con firma');
  d = await abrirCancelar(perdona);
  const aviso2 = d.getByTestId('adeudo-al-cerrar');
  r.ok(await aparece(aviso2.getByText(/Pasa de lo que se le puede perdonar sin firma \(\$[\d,.]+\)/), T.ui), `con $1.00 ya perdonado, dice que pasa de lo que se perdona sin firma: «${(await aviso2.locator('.tiny').last().innerText().catch(() => '')).trim()}»`);
  await aviso2.getByRole('button', { name: 'Perdonarla…' }).click();
  const per = ger.getByRole('dialog', { name: `Perdonar ${pesos(debePerdona)}` });
  r.ok(await aparece(per, T.ui), `«Perdonarla…» abre «Perdonar ${pesos(debePerdona)}»`);
  const textoPer = await per.innerText();
  r.ok(/Ya se le perdonaron \$1\.00 sin firma/.test(textoPer) && /pide autorización/.test(textoPer), 'dice el tope (una mensualidad), lo ya perdonado ($1.00) y que esto pide autorización');
  const pedir = per.getByRole('button', { name: 'Pedir autorización' });
  r.ok(await pedir.isDisabled(), 'sin motivo no se pide');
  await per.getByRole('radiogroup', { name: '¿Por qué se le perdona?' }).getByRole('radio').first().click();
  await r.captura(ger, 'dinero-socio-2-perdonar');
  const sinFirma = await accion(ger, () => pedir.click(), /\/api\/members\/[^/]+\/debt\/waiver$/, { metodo: 'POST', que: 'el perdón sin firma' });
  r.ok(sinFirma.status() === 428, `la API pide firma (${sinFirma.status()})`);
  const f1 = await firmar(ger, `Autorizar perdonar ${pesos(debePerdona)}`);
  const perdon = await accion(ger, () => f1.autorizar(), /\/api\/members\/[^/]+\/debt\/waiver$/, { metodo: 'POST', que: 'el perdón firmado' });
  r.ok(perdon.ok(), `con la firma (${f1.quien}) se perdona (${perdon.status()})`);
  r.ok(await aparece(ger.getByText(`Se le perdonaron ${pesos(debePerdona)}`), T.respuesta), `avisa «Se le perdonaron ${pesos(debePerdona)}»`);
  r.ok(await aparece(aviso2.getByText('No debe nada.'), T.respuesta), 'y el diálogo de cancelar pasa a «No debe nada.»');
  r.ok(await deuda(perdona) === 0n, 'por la API ya no debe nada');
  await d.getByRole('button', { name: 'Volver' }).click();

  // ── 3. Devolver una parte de un cobro ─────────────────────────────────────
  r.paso('devolución parcial');
  await ger.goto(`${PANEL}/socios/${paga.id}`, { waitUntil: 'networkidle' });
  await ger.getByRole('tab', { name: /Estado de cuenta/ }).click();
  const movs = ger.getByTestId('cuenta-movimientos');
  const pago = movs.locator('[data-testid="mov-pago"][data-contra="no"]').first();
  await pago.waitFor({ timeout: T.respuesta });
  await asentado(ger);
  await pago.getByRole('button', { name: 'Devolver', exact: true }).click();
  const dev = ger.getByRole('dialog', { name: 'Devolver dinero' });
  await dev.waitFor({ timeout: T.respuesta });
  await dev.getByRole('radiogroup', { name: '¿Cuánto se devuelve?' }).getByRole('radio', { name: /^Una parte/ }).click();
  await dev.getByLabel('Importe a devolver').fill('200');
  await dev.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Importe mal capturado' }).click();
  const pedirDev = dev.getByRole('button', { name: 'Pedir autorización' });
  r.ok(await pedirDev.isDisabled(), 'una parte de un cobro por transferencia no se pide sin la referencia de la devolución');
  await dev.getByLabel('Referencia de la devolución').fill(`DEV${L.toUpperCase()}`);
  await r.captura(ger, 'dinero-socio-3-una-parte');
  await pedirDev.click();
  const f2 = await firmar(ger, 'Autorizar la devolución de $200.00');
  const parte = await accion(ger, () => f2.autorizar(), /\/api\/payments\/[^/]+\/return$/, { metodo: 'POST', que: 'la devolución parcial' });
  r.ok(parte.ok(), `con la firma (${f2.quien}) se devuelven $200.00 (${parte.status()})`);
  r.ok(await aparece(ger.getByText('Se devolvieron $200.00: ese importe ya no se le cobra'), T.respuesta), 'avisa «Se devolvieron $200.00: ese importe ya no se le cobra»');
  await asentado(ger);
  r.ok(await deuda(paga) === 0n, 'el cargo no vuelve a deberse (por la API, debe $0.00)');
  r.ok(await aparece(movs.locator('[data-testid="mov-pago"]').filter({ hasText: `DEV${L.toUpperCase()}` }).first(), T.respuesta), 'la devolución aparece en «Movimientos» con su referencia');
  await r.captura(ger, 'dinero-socio-4-devuelto', { full: true });

  // ── 4. Lo no usado queda a favor y se devuelve ────────────────────────────
  r.paso('saldo a favor');
  d = await abrirCancelar(paga);
  r.ok(await aparece(d.getByTestId('adeudo-al-cerrar').getByText('No debe nada.'), T.ui) && /queda a su favor/.test(await d.innerText()), 'al cancelar a quien no debe: «No debe nada.» y lo no usado «queda a su favor»');
  await d.getByLabel('Motivo').fill('Cambio de horario (recorrido de prueba)');
  await accion(ger, () => d.getByRole('button', { name: 'Cancelar membresía' }).click(), /\/api\/memberships\/[^/]+\/cancel$/, { metodo: 'POST', que: 'la cancelación' });
  await ger.getByText(/Membresía cancelada/).first().waitFor({ timeout: T.respuesta });
  await asentado(ger);
  const aFavor = BigInt((await g.get(`/members/${paga.id}/statement`)).creditCents);
  r.ok(aFavor > 0n && aFavor <= 45000n, `lo pagado y no usado queda a su favor: ${pesos(aFavor)} (de los $450.00 que quedaban de su cobro)`);
  await ger.getByRole('tab', { name: /Estado de cuenta/ }).click();
  await totales.waitFor({ timeout: T.respuesta });
  r.ok(await aparece(totales.getByText(pesos(aFavor)).first(), T.respuesta), `el estado de cuenta dice «A favor ${pesos(aFavor)}»`);
  await ger.getByTestId('devolver-saldo').click();
  const saf = ger.getByRole('dialog', { name: 'Devolver saldo a favor' });
  await saf.waitFor({ timeout: T.ui });
  r.ok((await saf.innerText()).includes(`Tiene ${pesos(aFavor)} a favor`), `«Devolver saldo a favor» dice cuánto tiene (${pesos(aFavor)})`);
  await saf.getByRole('radiogroup', { name: '¿Cómo se le devuelve?' }).getByRole('radio', { name: /^Transferencia/ }).click();
  await saf.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Canceló y pidió su dinero' }).click();
  const pedirSaf = saf.getByRole('button', { name: 'Pedir autorización' });
  r.ok(await pedirSaf.isDisabled(), 'por transferencia no se pide sin su referencia');
  await saf.getByLabel('Referencia de la devolución').fill(`SAF${L.toUpperCase()}`);
  await r.captura(ger, 'dinero-socio-5-saldo-a-favor');
  await pedirSaf.click();
  const f3 = await firmar(ger, `Autorizar devolver ${pesos(aFavor)} de saldo a favor`);
  const devSaldo = await accion(ger, () => f3.autorizar(), /\/api\/members\/[^/]+\/credit\/return$/, { metodo: 'POST', que: 'la devolución del saldo a favor' });
  r.ok(devSaldo.ok(), `con la firma (${f3.quien}) se le devuelve (${devSaldo.status()})`);
  r.ok(await aparece(ger.getByText(`Se le devolvieron ${pesos(aFavor)}`), T.respuesta), `avisa «Se le devolvieron ${pesos(aFavor)}»`);
  await asentado(ger);
  r.ok(await desaparece(ger.getByTestId('devolver-saldo'), T.respuesta), 'ya sin saldo a favor, el botón desaparece');
  r.ok(BigInt((await g.get(`/members/${paga.id}/statement`)).creditCents) === 0n, 'y por la API le quedan $0.00 a favor');

  // ── 5. Tienda: «por corregir», anular hoy y devolver la de ayer ───────────
  r.paso('tienda por corregir');
  const agua = (await g.get('/products')).products.find((p) => p.sku === 'AGUA600');
  const turno = (await g.get(`/cash-sessions?branchId=${cen.id}&status=OPEN`)).sessions[0];
  const vender = () => rcp.post('/pos/sales', { branchId: cen.id, method: 'SPEI_TRANSFER', cashSessionId: turno.id, externalRef: `TDA${sufijo().toUpperCase()}`, lines: [{ productId: agua.id, quantity: 1 }], idempotencyKey: randomUUID() });
  const deHoy = await vender();
  const deAyer = await vender();
  const total = pesos(deHoy.totalCents);
  const rec = await r.como('recepcion');
  const MOT = `Producto equivocado ${L}`;
  for (const [venta, etiqueta] of [[deHoy, 'la de hoy'], [deAyer, 'la que será de ayer']]) {
    await rec.goto(`${PANEL}/recibo/venta/${venta.id}`, { waitUntil: 'networkidle' });
    const zona = rec.getByTestId('corregir-venta');
    await zona.getByRole('button', { name: 'Marcar por corregir' }).click();
    const md = rec.getByRole('dialog', { name: `Marcar por corregir · ${total}` });
    await md.getByLabel('Motivo').fill(MOT);
    const marcada = await accion(rec, () => md.getByRole('button', { name: 'Marcar', exact: true }).click(), /\/api\/pos\/sales\/[^/]+\/flag$/, { metodo: 'POST', que: 'la marca «por corregir»' });
    r.ok(marcada.ok() && await aparece(zona.getByText('Por corregir', { exact: true }), T.respuesta), `recepción marca «por corregir» ${etiqueta} (${marcada.status()})`);
    if (venta === deHoy) {
      r.ok(await zona.getByRole('button', { name: 'Anular venta' }).count() === 0 && await zona.getByRole('button', { name: 'Registrar devolución' }).count() === 0, 'y recepción no ve «Anular venta» ni «Registrar devolución»');
      await r.captura(rec, 'dinero-socio-6-marcada');
    }
  }
  // La segunda venta pasa a ser de ayer: es lo que haría el paso del tiempo.
  await sql(`update pos_sales set "businessDate" = "businessDate" - 1 where id = $1`, [deAyer.id]);

  await ger.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  const porCorregir = ger.getByTestId('ventas-por-corregir');
  await porCorregir.waitFor({ timeout: T.respuesta });
  const mias = porCorregir.locator('li').filter({ hasText: MOT });
  r.ok(await mias.count() === 2, `la gerencia ve en Caja las dos «Ventas por corregir» (${await mias.count()})`);
  r.ok(await mias.filter({ hasText: 'Se anula hoy' }).count() === 1 && await mias.filter({ hasText: 'Toca devolución' }).count() === 1, 'una dice «Se anula hoy» y la de ayer «Toca devolución»');
  await r.captura(ger, 'dinero-socio-7-por-corregir');

  // El ticket abre en otra pestaña; aquí, en la misma, para leerlo.
  await ger.goto(`${PANEL}/recibo/venta/${deHoy.id}`, { waitUntil: 'networkidle' });
  let zona = ger.getByTestId('corregir-venta');
  await zona.getByRole('button', { name: 'Anular venta' }).click();
  const an = ger.getByRole('dialog', { name: `Anular la venta · ${total}` });
  await an.getByLabel('Motivo').fill(MOT);
  const anulada = await accion(ger, () => an.getByRole('button', { name: 'Anular venta' }).click(), /\/api\/pos\/sales\/[^/]+\/void$/, { metodo: 'POST', que: 'la anulación' });
  r.ok(anulada.ok() && await aparece(ger.getByText('Venta anulada: el producto volvió al inventario'), T.respuesta), `la de hoy se anula sin firma (${anulada.status()})`);

  await ger.goto(`${PANEL}/recibo/venta/${deAyer.id}`, { waitUntil: 'networkidle' });
  zona = ger.getByTestId('corregir-venta');
  await zona.getByRole('button', { name: 'Registrar devolución' }).waitFor({ timeout: T.respuesta });
  r.ok(await zona.getByRole('button', { name: 'Anular venta' }).count() === 0, 'la de ayer ya no se puede anular: solo «Registrar devolución»');
  await zona.getByRole('button', { name: 'Registrar devolución' }).click();
  const dv = ger.getByRole('dialog', { name: `Devolver la venta · ${total}` });
  await dv.waitFor({ timeout: T.ui });
  r.ok(await dv.getByLabel('Motivo').inputValue() === MOT, 'el motivo llega escrito con lo que dijo recepción');
  const pedirDv = dv.getByRole('button', { name: 'Pedir autorización' });
  r.ok(await pedirDv.isDisabled(), 'una venta por transferencia no se devuelve sin la referencia');
  await dv.getByLabel('Referencia de la devolución').fill(`DVT${L.toUpperCase()}`);
  await r.captura(ger, 'dinero-socio-8-devolver-venta');
  await pedirDv.click();
  const f4 = await firmar(ger, `Autorizar la devolución de ${total}`);
  const devVenta = await accion(ger, () => f4.autorizar(), /\/api\/pos\/sales\/[^/]+\/return$/, { metodo: 'POST', que: 'la devolución de la venta' });
  r.ok(devVenta.ok(), `con la firma (${f4.quien}) se registra la devolución (${devVenta.status()})`);
  r.ok(await aparece(zona.getByText(new RegExp(`^Devuelta el .* · \\${total}`)), T.respuesta), 'el ticket dice «Devuelta el …» con su importe');
  r.ok(/autorizó /.test(await zona.innerText()) && (await zona.innerText()).includes(`ref. DVT${L.toUpperCase()}`), 'con la referencia y quién autorizó');
  await r.captura(ger, 'dinero-socio-9-devuelta');
  const quedan = (await g.get(`/pos/flagged-sales?branchId=${cen.id}`)).items.filter((v) => v.saleId === deHoy.id || v.saleId === deAyer.id);
  r.ok(quedan.length === 0, 'y ninguna de las dos sigue en «Ventas por corregir»');
}, { erroresDePagina: 'falla' });
