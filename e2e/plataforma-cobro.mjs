// La consola de plataforma cobra a una marca (fase 3, bloque 3.11 · D-37/D-38,
// y fase 4, bloque 4.9 · D-39). Lo que la fase 3 dejó sin recorrido:
//
//  1. «Dar descuento» 20 % por 2 meses: la mensualidad gana su renglón y
//     «Paga al mes»; la factura que se emite lo trae; cancelar el descuento no
//     cambia la factura ya emitida.
//  2. Cobranza → «Avisos por mandar»: el dueño sin celular → «Ya se lo avisé».
//  3. Con la factura vencida, «Dar prórroga» en la ficha.
//  4. Con el servicio suspendido, «Registrar pago» ofrece reanudarlo y lo reanuda.
//  5. Planes → cambiar el precio de un plan con marcas: se ANUNCIA (no aplica
//     hoy), con la lista de marcas; «Cancelar cambio» lo deja como estaba.
//
// Datos propios: un plan «Cobro XXXX» y una marca «Cobro XXXX» de la corrida
// (sin precios de plataforma: el plan trae el suyo). La factura se vence
// moviendo su fecha en gymflow_pruebas. Al terminar, pase lo que pase, el
// cambio de precio anunciado se cancela y la marca queda suspendida, como las
// de `plataforma` y `plataforma-ficha` (no entra a la cobranza de cada mes).
import { recorrido, accion, asentado, aparece, desaparece, sql, dia, letras, CLAVE_PRUEBAS, PANEL, T } from './lib/index.mjs';

await recorrido('plataforma-cobro', async (r) => {
  const pla = await r.api('plataforma');
  await pla.post('/platform/reauth', { password: CLAVE_PRUEBAS });
  const L = letras(4).toUpperCase();
  const MARCA = `Cobro ${L}`;
  const plan = await pla.post('/platform/plans', { name: MARCA, description: 'Plan de un recorrido de prueba', modules: ['cash'], monthlyCents: '200000' });
  const alta = await pla.post('/platform/organizations', {
    legalName: `${MARCA} S.A. de C.V.`, tradeName: MARCA, planId: plan.id, releaseNow: true,
    branch: { code: 'MTZ', name: 'Matriz' },
    owner: { fullName: 'Elsa Duena Cobro', email: `duena.${L.toLowerCase()}@cobro-prueba.mx` },
    reason: 'Marca de un recorrido de prueba',
  });
  const org = alta.organizationId;
  r.alFinal(async () => {
    const { changes } = await pla.get('/platform/price-changes');
    for (const c of changes.filter((x) => x.status === 'PENDING' && x.concept === MARCA)) await pla.post(`/platform/price-changes/${c.id}/cancel`, { reason: 'Fin del recorrido de prueba' });
    const ficha = await pla.get(`/platform/organizations/${org}`);
    if (ficha.serviceStatus !== 'SUSPENDED') await pla.post(`/platform/organizations/${org}/service`, { status: 'SUSPENDED', reason: 'Marca de un recorrido de prueba' });
  });
  r.ok(alta.serviceStatus === 'ACTIVE', `datos de la corrida: plan «${MARCA}» de $2,000.00 y la marca en uso`);

  const pl = await r.como('plataforma');
  const ficha = async () => {
    await pl.goto(`${PANEL}/plataforma/${org}`, { waitUntil: 'networkidle' });
    await pl.getByTestId('cobro').getByTestId('mensualidad').waitFor({ timeout: T.respuesta });
  };
  const cobro = pl.getByTestId('cobro');

  // ── 1. Descuento y factura con descuento ──────────────────────────────────
  r.paso('descuento');
  await ficha();
  const sinDescuento = (await cobro.getByTestId('mensualidad').innerText()).trim();
  r.ok(sinDescuento === '$2,000.00', `la mensualidad de hoy es la del plan (${sinDescuento})`);
  await cobro.getByTestId('descuentos').getByRole('button', { name: 'Dar descuento' }).click();
  const dd = pl.getByRole('dialog', { name: `Dar un descuento a ${MARCA}` });
  await dd.getByTestId('dar-descuento').waitFor({ timeout: T.ui });
  await dd.getByRole('button', { name: 'Guardar descuento' }).click();
  r.ok(await aparece(dd.getByText('Escribe el porcentaje, de 0.01 a 100; por ejemplo 20.'), T.ui), 'sin porcentaje no se guarda: el campo lo pide');
  await dd.locator('#dd-v').fill('20');
  await dd.locator('#dd-n').fill('2');
  await dd.locator('#dd-m').fill('Promoción de arranque (recorrido de prueba)');
  await r.captura(pl, 'plataforma-cobro-1-descuento');
  await accion(pl, () => dd.getByRole('button', { name: 'Guardar descuento' }).click(), `/api/platform/organizations/${org}/billing-adjustments`, { metodo: 'POST', que: 'el descuento' });
  r.ok(await aparece(pl.getByText(/^Descuento guardado: sale en las facturas de /), T.respuesta), 'avisa «Descuento guardado: sale en las facturas de …»');
  await asentado(pl);
  r.ok(await aparece(cobro.getByTestId('descuento-vigente'), T.respuesta), `la tarjeta dice «${(await cobro.getByTestId('descuento-vigente').innerText().catch(() => '')).trim()}»`);
  const desglose = cobro.getByTestId('mensualidad-desglose');
  r.ok(await aparece(desglose, T.ui) && /Paga al mes/.test(await desglose.innerText()), 'la mensualidad gana su desglose con «Paga al mes»');
  r.ok((await cobro.getByTestId('mensualidad').innerText()).trim() === '$1,600.00', `y paga $1,600.00 al mes (${(await cobro.getByTestId('mensualidad').innerText()).trim()})`);
  r.ok(await cobro.locator('tr[data-descuento="ACTIVE"]').count() === 1, 'el descuento sale en la tabla, «vigente»');

  await cobro.getByRole('button', { name: 'Generar factura' }).click();
  const de = pl.getByRole('dialog');
  await de.getByTestId('emision-total').waitFor({ timeout: T.respuesta });
  const cobrado = (await de.getByTestId('emision-total').innerText()).trim();
  const previa = (await de.getByTestId('vista-previa-emision').innerText()).replace(/\s+/g, ' ');
  r.ok(/20 ?%/.test(previa) || /Descuento/i.test(previa), `la vista previa trae el renglón del descuento («${previa.slice(0, 220)}»)`);
  await r.captura(pl, 'plataforma-cobro-2-emitir');
  await de.getByRole('button', { name: /^Emitir/ }).click();
  await pl.getByText(/Factura GF-\d{4}-\d{6} emitida/).waitFor({ timeout: T.respuesta });
  await asentado(pl);
  const folio = await pl.locator('[data-folio]').first().getAttribute('data-folio');
  const [fac] = await sql(`select id, "totalCents"::text as total from platform_invoices where folio = $1`, [folio]);
  r.ok(!!fac && `$${(Number(fac.total) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` === cobrado, `la factura ${folio} sale por lo que dijo la vista previa (${cobrado})`);

  // Cancelar el descuento no toca la factura emitida.
  await cobro.locator('tr[data-descuento="ACTIVE"]').getByRole('button', { name: 'Cancelar' }).click();
  const cd = pl.getByRole('dialog', { name: 'Cancelar el descuento' });
  await cd.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Cambió el acuerdo con el dueño' }).click();
  await accion(pl, () => cd.getByRole('button', { name: 'Cancelar el descuento' }).click(), /\/api\/platform\/billing-adjustments\/[^/]+\/cancel$/, { metodo: 'POST', que: 'cancelar el descuento' });
  r.ok(await aparece(pl.getByText('Descuento cancelado: las facturas que faltan salen sin él.'), T.respuesta), 'avisa «Descuento cancelado: las facturas que faltan salen sin él.»');
  await asentado(pl);
  const [despues] = await sql(`select "totalCents"::text as total from platform_invoices where id = $1`, [fac.id]);
  r.ok(despues.total === fac.total, `la factura ya emitida no cambia (${despues.total})`);
  r.ok(await aparece(cobro.getByTestId('mensualidad').getByText('$2,000.00'), T.respuesta), 'y la mensualidad vuelve a $2,000.00');

  // ── 2. Avisos por mandar ──────────────────────────────────────────────────
  r.paso('avisos por mandar');
  await pl.goto(`${PANEL}/plataforma/cobranza`, { waitUntil: 'networkidle' });
  const porMandar = pl.locator('.card').filter({ has: pl.getByRole('heading', { name: /^Avisos por mandar/ }) });
  const aviso = porMandar.locator('tr[data-aviso]').filter({ hasText: MARCA });
  r.ok(await aparece(aviso, T.respuesta), `«Avisos por mandar» trae el aviso de la factura de ${MARCA}`);
  r.ok(/Su dueño no tiene celular registrado: avísale por otro medio\./.test(await aviso.innerText()), 'sin celular del dueño, dice por qué no hay WhatsApp');
  await accion(pl, () => aviso.getByRole('button', { name: 'Ya se lo avisé' }).click(), /\/api\/platform\/notices\/[^/]+\/sent$/, { metodo: 'POST', que: 'anotar el aviso' });
  r.ok(await aparece(pl.getByText('Anotado: desde hoy hay constancia de que se le avisó.'), T.respuesta), 'avisa «Anotado: desde hoy hay constancia de que se le avisó.»');
  r.ok(await desaparece(aviso, T.respuesta), 'y sale de «Avisos por mandar»');
  await r.captura(pl, 'plataforma-cobro-3-cobranza');

  // ── 3. Factura vencida: prórroga ──────────────────────────────────────────
  r.paso('prórroga');
  await sql(`update platform_invoices set "dueDate" = $2::date where id = $1`, [fac.id, dia(-5)]);
  await ficha();
  const estado = cobro.getByTestId('cobranza-estado');
  r.ok(await aparece(estado, T.respuesta), `vencida, la tarjeta dice qué va a pasar: «${(await estado.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}»`);
  await estado.getByRole('button', { name: /Dar prórroga|Cambiar prórroga/ }).click();
  const pr = pl.getByRole('dialog', { name: `Prórroga para ${MARCA}` });
  await pr.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'El dueño confirmó que paga esta semana' }).click();
  await accion(pl, () => pr.getByRole('button', { name: 'Dar prórroga' }).click(), `/api/platform/organizations/${org}/collections-hold`, { metodo: 'PUT', que: 'la prórroga' });
  r.ok(await aparece(pl.getByText(/^Prórroga hasta el .*: el sistema no la suspende antes\.$/), T.respuesta), 'avisa «Prórroga hasta el …: el sistema no la suspende antes.»');
  await asentado(pl);
  // Sin el aviso de «vencida» (lo crea el cierre de la noche, que aquí no se corre) la tarjeta sigue diciendo que el
  // aviso no ha llegado; la prórroga queda guardada y el botón pasa a «Cambiar prórroga».
  const conProrroga = await pla.get(`/platform/organizations/${org}/billing`);
  r.ok(!!conProrroga.collections?.holdUntil, `la prórroga queda guardada (hasta el ${conProrroga.collections?.holdUntil})`);
  r.ok(await aparece(cobro.getByTestId('cobranza-estado').getByRole('button', { name: 'Cambiar prórroga' }), T.respuesta), 'y la tarjeta ofrece «Cambiar prórroga»');
  await r.captura(pl, 'plataforma-cobro-4-prorroga');

  // ── 4. Suspendida: el pago la reanuda ─────────────────────────────────────
  r.paso('reanudar al pagar');
  await pla.post(`/platform/organizations/${org}/service`, { status: 'SUSPENDED', reason: 'No pagó (recorrido de prueba)' });
  await ficha();
  await pl.locator(`[data-folio="${folio}"]`).getByRole('button', { name: 'Registrar pago' }).click();
  const pg = pl.getByRole('dialog');
  const reanudar = pg.getByTestId('reanudar-al-pagar');
  r.ok(await aparece(reanudar, T.ui) && /¿Reanudar el servicio con este pago\?/.test(await reanudar.innerText()), 'el pago pregunta «¿Reanudar el servicio con este pago?»');
  r.ok(await reanudar.getByRole('switch').isChecked(), 'con «Reanudar» encendido');
  await pg.getByLabel('Referencia').fill(`SPEI ${L}0001`);
  await r.captura(pl, 'plataforma-cobro-5-reanudar');
  const pago = await accion(pl, () => pg.getByRole('button', { name: 'Registrar pago' }).click(), /\/api\/platform\/invoices\/[^/]+\/pay$/, { metodo: 'POST', que: 'el pago' });
  const cuerpo = await pago.json().catch(() => null);
  r.ok(pago.ok() && cuerpo?.service?.resumed === true, `se registra y reanuda el servicio (${pago.status()}, resumed=${cuerpo?.service?.resumed})`);
  await asentado(pl);
  r.ok((await pla.get(`/platform/organizations/${org}`)).serviceStatus === 'ACTIVE', 'la marca queda en uso');
  r.ok(await aparece(pl.locator(`[data-folio="${folio}"]`).getByText('Pagada'), T.respuesta), 'y la factura, pagada');

  // ── 5. Anunciar un cambio de precio y cancelarlo ──────────────────────────
  r.paso('anunciar un cambio de precio');
  await pl.goto(`${PANEL}/plataforma/planes`, { waitUntil: 'networkidle' });
  const fila = pl.locator(`[data-plan="${MARCA}"]`);
  await fila.waitFor({ timeout: T.respuesta });
  await fila.getByRole('button', { name: 'Editar' }).click();
  const ed = pl.getByRole('dialog', { name: `Editar ${MARCA}` });
  r.ok(/1 marca lo tiene/.test(await ed.innerText()), 'el diálogo avisa «1 marca lo tiene»');
  await ed.getByLabel('Precio al mes (MXN)').fill('2300');
  await ed.getByRole('button', { name: 'Guardar' }).click();
  const an = pl.getByRole('dialog', { name: `Cambiar el plan ${MARCA}` });
  await an.getByTestId('anunciar-cambio').waitFor({ timeout: T.respuesta });
  const afectada = an.locator(`tr[data-afectada="${MARCA}"]`);
  r.ok(await afectada.count() === 1 && /\$2,000\.00/.test(await afectada.innerText()) && /\$2,300\.00/.test(await afectada.innerText()), 'dice a qué marca le cambia: paga $2,000.00, pagará $2,300.00');
  r.ok(/no aplica hoy, se anuncia con al menos un mes de aviso/.test(await an.innerText()), 'y que no aplica hoy: se anuncia con un mes de aviso');
  await r.captura(pl, 'plataforma-cobro-6-anunciar');
  await accion(pl, () => an.getByRole('button', { name: /^Anunciar desde / }).click(), `/api/platform/plans/${plan.id}`, { metodo: 'PUT', que: 'el anuncio' });
  r.ok(await aparece(pl.getByText(new RegExp(`^Plan ${MARCA}: el precio y los módulos nuevos aplican desde la factura de `)), T.respuesta), 'avisa desde qué factura aplica');
  await asentado(pl);
  r.ok(/\$2,000\.00/.test(await fila.innerText()), 'el plan sigue hoy en $2,000.00');
  const anunciado = pl.getByTestId('cambios-anunciados').locator(`tr[data-cambio="${MARCA}"][data-estado="PENDING"]`);
  r.ok(await aparece(anunciado, T.respuesta), 'y queda en «Cambios anunciados»');
  await anunciado.getByRole('button', { name: 'Cancelar cambio' }).click();
  const cc = pl.getByRole('dialog', { name: `Cancelar el cambio de Plan ${MARCA}` });
  await cc.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Se decidió no cambiarlo' }).click();
  await accion(pl, () => cc.getByRole('button', { name: 'Cancelar el cambio' }).click(), /\/api\/platform\/price-changes\/[^/]+\/cancel$/, { metodo: 'POST', que: 'cancelar el anuncio' });
  r.ok(await aparece(pl.getByText('Cambio cancelado: todo sigue como estaba.'), T.respuesta), 'avisa «Cambio cancelado: todo sigue como estaba.»');
  r.ok(await aparece(pl.getByTestId('cambios-anunciados').locator(`tr[data-cambio="${MARCA}"][data-estado="CANCELED"]`), T.respuesta), 'y queda «Cancelado»');
}, { erroresDePagina: 'informa' });
