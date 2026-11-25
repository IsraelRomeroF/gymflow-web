// Precios (fase 3, bloque 3.6 · D-19, D-20 y D-21), en el navegador:
//
//  1. Un plan con dos socios, uno de ellos marcado «conserva su precio»: la
//     tarjeta del plan lo dice y su lista lo nombra con el motivo.
//  2. Cambiar el precio: la vista previa dice a cuántos les sube en su
//     siguiente pago, cuánto, y quién conserva su precio; NO deja guardar sin
//     decidir qué pasa con quien lo conserva.
//  3. Al guardar: el socio normal pasa al precio nuevo con 15 días de aviso
//     (4.20: la ficha y «Renovar» dicen que hoy sigue en el de antes y a cuánto
//     pasa), el otro conserva el suyo, y el aviso del primero queda en Mensajes.
//  4. Producto con precio de socio y costo: la gerencia los captura y ve «Deja»;
//     recepción no ve el costo; la venta desde la ficha de un socio vigente
//     cobra el precio de socio y el ticket lo dice.
//
// Datos propios: un plan «Plan Xxxx» y un producto «Termo Xxxx» de la corrida
// (no se toca la Mensualidad ni el agua, de los que dependen los demás
// recorridos), y dos socios «Zavala…». Al terminar el plan y el producto se
// desactivan. Queda un aviso de cambio de precio en Mensajes (del socio de la
// corrida) y una venta por transferencia de $20.00.
import { recorrido, crearSocio, venderMembresia, letras, sufijo, accion, respuesta, asentado, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('precios', async (r) => {
  const g = await r.api('gerencia');
  const L = letras(4);
  // La sede se pide directo (no con sedeDe): el catálogo del recorrido se memoriza la primera vez, y el plan de la corrida todavía no existe.
  const cen = (await g.get('/branches')).find((b) => b.code === 'CEN');
  const CODIGO = `R${sufijo().toUpperCase()}`.slice(0, 8);
  const NOMBRE = `Plan ${L}`;
  const plan = await g.post('/plans', {
    code: CODIGO, name: NOMBRE, billingModel: 'RECURRING', durationUnit: 'MONTH', durationValue: 1, priceCents: '40000',
    branchIds: [cen.id], reason: 'Plan de un recorrido de prueba',
  });
  const producto = await g.post('/products', { sku: `TERMO-${sufijo().toUpperCase()}`, name: `Termo ${L}`, priceCents: '3000', tracksInventory: false });
  r.alFinal(async () => {
    await g.patch(`/plans/${plan.id}`, { isActive: false, reason: 'Termina el recorrido de prueba' }).catch((e) => r.nota(`no se pudo desactivar el plan de la corrida: ${e.message}`));
    await g.patch(`/products/${producto.id}`, { isActive: false }).catch((e) => r.nota(`no se pudo desactivar el producto de la corrida: ${e.message}`));
  });
  // Dos socios con ese plan (se vende por su id: el catálogo del recorrido se lee después de crearlo).
  const paga = await crearSocio(g, { sede: 'CEN' });
  const conserva = await crearSocio(g, { sede: 'CEN' });
  const mPaga = (await venderMembresia(g, paga, { plan: plan.id })).membership;
  const mConserva = (await venderMembresia(g, conserva, { plan: plan.id })).membership;
  await g.put(`/memberships/${mConserva.id}/price-protection`, { protected: true, reason: `Convenio de prueba ${L}` });
  r.ok(true, `datos de la corrida: «${NOMBRE}» (${CODIGO}, $400) con ${paga.memberCode} y ${conserva.memberCode}, que conserva su precio; producto «Termo ${L}» ($30)`);

  const ger = await r.como('gerencia');

  // ── 1. La tarjeta del plan dice quién conserva su precio ──────────────────
  r.paso('quién conserva su precio');
  await ger.goto(`${PANEL}/planes`, { waitUntil: 'networkidle' });
  const tarjeta = ger.locator('.card').filter({ has: ger.getByText(CODIGO, { exact: true }) }).filter({ has: ger.getByRole('button', { name: 'Editar' }) }).last();
  await tarjeta.waitFor({ timeout: T.respuesta });
  const enlace = tarjeta.getByRole('button', { name: '1 conserva su precio' });
  r.ok(await aparece(enlace, T.respuesta), 'la tarjeta del plan dice «1 conserva su precio»');
  await enlace.click();
  const prot = ger.getByRole('dialog', { name: `Conservan su precio · ${NOMBRE}` });
  const lista = prot.getByTestId('precios-protegidos');
  r.ok(await aparece(lista.getByText(conserva.lastName), T.respuesta) && (await lista.innerText()).includes(`Convenio de prueba ${L}`), 'su lista nombra al socio, con el motivo');
  r.ok(await lista.getByText(paga.lastName).count() === 0, 'y no al que paga el precio de lista');
  await r.captura(ger, 'precios-1-conservan');
  await prot.getByRole('button', { name: 'Cerrar' }).last().click();

  // ── 2. Cambiar el precio: vista previa y decisión obligatoria ─────────────
  r.paso('vista previa del aumento');
  await tarjeta.getByRole('button', { name: 'Editar' }).click();
  const dlg = ger.getByRole('dialog', { name: `Editar ${NOMBRE}` });
  await dlg.waitFor({ timeout: T.ui });
  await asentado(ger);
  const previa = respuesta(ger, new RegExp(`/api/plans/${plan.id}/impact\\?newPriceCents=45000`), { metodo: 'GET', que: 'la vista previa del precio nuevo' });
  previa.catch(() => undefined);
  await dlg.getByLabel('Precio por periodo').fill('450');
  const visto = (await (await previa).json()).priceChange;
  const imp = dlg.getByTestId('plan-impacto');
  await imp.getByText('Les sube con 15 días de aviso').waitFor({ timeout: T.respuesta });
  const texto = (await imp.innerText()).replace(/\s+/g, ' ');
  r.ok(texto.includes('2 socios tienen este plan'), 'dice cuántos tienen el plan (2)');
  r.ok(texto.includes('$400 → $450') && /Para las ventas nuevas/.test(texto), 'el precio de lista pasa de $400 a $450 para las ventas nuevas');
  r.ok(visto.touched === 1 && /Les sube con 15 días de aviso Cada quien paga \$50 más por periodo 1 socio/.test(texto), `a 1 socio le sube $50, con 15 días de aviso (4.20; la API dice ${visto.touched})`);
  r.ok(/El primero lo paga el/.test(texto) && /Nadie lo paga antes del/.test(texto), 'dice cuándo lo paga el primero y que nadie antes de los 15 días (4.20)');
  r.ok(visto.protected === 1 && /Conservan su precio No cambian solos: tú decides abajo 1 socio/.test(texto), `y 1 conserva su precio: «No cambian solos: tú decides abajo» (la API dice ${visto.protected})`);
  r.ok(/queda en Mensajes/.test(texto), 'avisa que el aviso de cada socio queda en Mensajes');
  const conservan = dlg.getByTestId('plan-conservan');
  r.ok(await aparece(conservan.getByText('¿Y el socio que conserva su precio?'), T.ui), 'y pregunta: «¿Y el socio que conserva su precio?»');
  await r.captura(ger, 'precios-2-vista-previa');
  await dlg.getByLabel('Motivo').fill(`Ajuste anual de prueba ${L}`);
  let guardados = 0;
  const cuenta = (req) => { if (req.method() === 'PATCH' && req.url().includes(`/api/plans/${plan.id}`)) guardados++; };
  ger.on('request', cuenta);
  await dlg.getByRole('button', { name: 'Guardar cambios' }).click();
  r.ok(await aparece(dlg.getByText('Elige qué pasa con quienes conservan su precio').first(), T.ui) && guardados === 0, 'sin elegir no guarda: «Elige qué pasa con quienes conservan su precio»');
  await conservan.getByRole('radio', { name: /^Conserva su precio/ }).click();
  const guardado = await accion(ger, () => dlg.getByRole('button', { name: 'Guardar cambios' }).click(), `/api/plans/${plan.id}`, { metodo: 'PATCH', que: 'el cambio de precio' });
  ger.off('request', cuenta);
  r.ok(guardado.ok(), `eligiendo «Conserva su precio», guarda (${guardado.status()})`);
  r.ok(await aparece(ger.getByText(/^Plan actualizado\. 1 socio paga el precio nuevo desde su primer pago a partir del .+; sus avisos quedaron en Mensajes\.$/), T.respuesta), 'avisa: «1 socio paga el precio nuevo desde su primer pago a partir del …; sus avisos quedaron en Mensajes.» (4.20)');

  // ── 3. Lo que quedó ───────────────────────────────────────────────────────
  r.paso('lo que paga cada quien');
  const membresia = async (socio, id) => (await g.get(`/members/${socio.id}/memberships`)).find((m) => m.id === id);
  const [a, b] = [await membresia(paga, mPaga.id), await membresia(conserva, mConserva.id)];
  // 4.20: el aumento espera 15 días: hoy sigue en $400.00 y la API dice a cuánto pasa.
  r.ok(a?.periodPriceCents === '40000' && a?.pendingPrice?.toPriceCents === '45000' && b?.periodPriceCents === '40000' && !b?.pendingPrice && b?.priceProtected === true, `por la API: ${paga.memberCode} paga $400.00 y pasa a $450.00 con 15 días de aviso; ${conserva.memberCode} sigue en $400.00 y conserva su precio`);
  await ger.goto(`${PANEL}/socios/${conserva.id}`, { waitUntil: 'networkidle' });
  const pp = ger.getByTestId('paga-por-periodo');
  r.ok(await aparece(pp, T.respuesta) && /\$400\.00/.test(await pp.innerText()) && /Conserva su precio/.test(await pp.innerText()), `la ficha de quien conserva: «${(await pp.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()}»`);
  await r.captura(ger, 'precios-3-ficha-conserva');
  await ger.goto(`${PANEL}/socios/${paga.id}`, { waitUntil: 'networkidle' });
  r.ok(await aparece(pp, T.respuesta) && /\$400\.00/.test(await pp.innerText()) && /pasa a \$450\.00/.test(await pp.innerText()) && !/Conserva/.test(await pp.innerText()), `la ficha del otro: «Paga por periodo ${(await pp.innerText().catch(() => '')).trim()}»`);
  await ger.getByRole('button', { name: 'Renovar', exact: true }).click();
  const ren = ger.getByRole('dialog', { name: `Renovar a ${paga.firstName}` });
  r.ok(await aparece(ren.getByText('$400.00').first(), T.respuesta) && await aparece(ren.getByTestId('renovar-aumento-por-llegar'), T.ui), '«Renovar» hoy cotiza $400.00 y dice que el aumento a $450.00 llega después (4.20)');
  await r.captura(ger, 'precios-4-renovar');
  await ren.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await ger.goto(`${PANEL}/mensajes`, { waitUntil: 'networkidle' });
  const mensaje = ger.getByTestId('mensaje').filter({ hasText: paga.lastName });
  r.ok(await aparece(mensaje.first(), T.respuesta), 'su aviso de cambio de precio está en Mensajes');
  const textoMsj = (await mensaje.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  r.ok(/450/.test(textoMsj), `y dice el precio nuevo: «${textoMsj.slice(0, 220)}»`);
  r.ok(await ger.getByTestId('mensaje').filter({ hasText: conserva.lastName }).count() === 0, 'a quien conserva su precio no se le arma aviso');
  await r.captura(ger, 'precios-5-mensajes');

  // ── 4. Producto con precio de socio y costo ───────────────────────────────
  r.paso('precio de socio y costo');
  await ger.goto(`${PANEL}/productos`, { waitUntil: 'networkidle' });
  const fila = ger.locator('tr').filter({ hasText: `Termo ${L}` });
  await fila.waitFor({ timeout: T.respuesta });
  await fila.getByRole('button', { name: 'Editar' }).click();
  const pd = ger.getByRole('dialog', { name: `Editar Termo ${L}` });
  await pd.getByLabel('Precio de socio').fill('20');
  await pd.getByLabel('Costo').fill('12');
  r.ok(await aparece(pd.getByText('Deja $18.00 por pieza a precio de público.'), T.ui), 'al capturar el costo dice «Deja $18.00 por pieza a precio de público.»');
  await r.captura(ger, 'precios-6-producto');
  const prodGuardado = await accion(ger, () => pd.getByRole('button', { name: /^Guardar/ }).click(), `/api/products/${producto.id}`, { metodo: 'PATCH', que: 'el producto' });
  r.ok(prodGuardado.ok(), `el producto se guarda (${prodGuardado.status()})`);
  await pd.waitFor({ state: 'hidden', timeout: T.respuesta });
  await asentado(ger);
  const textoFila = (await fila.innerText()).replace(/\s+/g, ' ');
  r.ok(/\$30\.00/.test(textoFila) && /\$20\.00/.test(textoFila) && /\$12\.00/.test(textoFila) && /\$18\.00/.test(textoFila), `la tabla muestra Precio $30.00, Socios $20.00, Costo $12.00 y Deja $18.00: «${textoFila.slice(0, 140)}»`);

  const rec = await r.como('recepcion');
  const lista2 = respuesta(rec, (url) => new URL(url).pathname === '/api/products', { metodo: 'GET', que: 'el catálogo que recibe recepción' });
  lista2.catch(() => undefined);
  await rec.goto(`${PANEL}/punto-de-venta?socio=${paga.id}`, { waitUntil: 'networkidle' });
  const recibido = (await (await lista2).json()).products.find((p) => p.id === producto.id);
  r.ok(recibido && recibido.costCents == null && recibido.memberPriceCents === '2000', `a recepción la API no le manda el costo (costCents ${recibido?.costCents ?? 'nulo'}) y sí el precio de socio`);
  r.ok(await aparece(rec.getByText(/a precio de socio/).first(), T.respuesta), 'el punto de venta dice «Venta para …, a precio de socio»');
  await rec.getByLabel('Buscar producto').fill(`Termo ${L}`);
  const boton = rec.locator('.pos-producto:not([disabled])').filter({ hasText: `Termo ${L}` });
  await boton.first().click();
  const ticket = rec.getByTestId('pos-ticket');
  r.ok(await aparece(ticket.getByText('$20.00 c/u · precio de socio'), T.ui), 'el ticket cobra «$20.00 c/u · precio de socio»');
  r.ok(await aparece(ticket.getByTestId('pos-ahorro'), T.ui) && /\$10\.00 menos/.test(await ticket.getByTestId('pos-ahorro').innerText()), 'y dice «Con precio de socio: $10.00 menos que al público.»');
  await ticket.getByText('Transferencia', { exact: true }).click();
  await ticket.getByLabel('Referencia de la transferencia').fill(`TDA${sufijo().toUpperCase()}`);
  await r.captura(rec, 'precios-7-pos-socio');
  const venta = await accion(rec, () => ticket.getByRole('button', { name: 'Cobrar $20.00' }).click(), (url) => new URL(url).pathname === '/api/pos/sales', { metodo: 'POST', que: 'la venta a precio de socio' });
  r.ok(venta.ok(), `la venta se cobra en $20.00 (${venta.status()})`);
  const v = await venta.json();
  r.ok(v.totalCents === '2000' && v.lines?.[0]?.priceKind === 'MEMBER', 'la API la guarda como venta a precio de socio ($20.00)');
  await rec.goto(`${PANEL}/recibo/venta/${v.id}`, { waitUntil: 'networkidle' });
  r.ok(await aparece(rec.getByText(/\$20\.00 c\/u · precio de socio/), T.respuesta), 'y el ticket impreso dice «precio de socio»');
  await r.captura(rec, 'precios-8-ticket');
  await rec.goto(`${PANEL}/productos`, { waitUntil: 'networkidle' }).catch(() => undefined);
  await asentado(rec);
  r.ok(await rec.getByRole('columnheader', { name: 'Costo' }).count() === 0 && await rec.getByText('$12.00').count() === 0, 'recepción no ve la columna «Costo» en Productos (si es que la pantalla le abre)');
}, { erroresDePagina: 'informa' });
