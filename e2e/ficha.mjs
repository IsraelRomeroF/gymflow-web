// La ficha del socio (fase 2, bloque 2.2). La pestaña Historia cuenta lo que
// ha pasado con el socio (su entrada, su cobro) y se filtra por parte; el
// Estado de cuenta es una sola lista «Movimientos» con cargos y pagos;
// «Corregir» un cargo con un descuento que pasa del tope del gerente pide
// motivo y firma; «Devolver» un cobro por transferencia siempre pide firma y
// deja la reversa en la lista; y la hoja para el socio abre.
//
// Datos propios: un socio de esta corrida con su mensualidad pagada por
// transferencia (no toca ningún turno de caja), una entrada y un cargo a mano
// con el nombre de la corrida. Nada compartido cambia.
import { randomUUID } from 'node:crypto';
import { recorrido, socioAlCorriente, sedeDe, letras, accion, asentado, aparece, CLAVE_PRUEBAS, PANEL, T } from './lib/index.mjs';

await recorrido('ficha', async (r) => {
  const g = await r.api('gerencia');
  const L = letras(4);
  const concepto = `Casillero ${L}`;
  const socio = await socioAlCorriente(g, { sede: 'CEN' });
  const cen = await sedeDe(g, 'CEN');
  const entrada = await g.post('/access/attempts', { branchId: cen.id, memberId: socio.id, credentialKind: 'MANUAL', requestKey: randomUUID(), reason: 'Entrada de un recorrido de prueba' });
  await g.post(`/members/${socio.id}/charges`, { chargeType: 'MANUAL_ADJUSTMENT', concept: concepto, subtotalCents: '20000', branchId: cen.id, reason: 'Cargo de un recorrido de prueba', requestKey: randomUUID() });
  r.ok(entrada.outcome === 'GRANTED', `datos de la corrida: ${socio.memberCode} pagó su mensualidad, entró hoy y debe «${concepto}» ($200.00)`);

  /** La firma en el mostrador: quien autoriza teclea su contraseña (2.10: si solo hay una persona que firma, ya viene elegida). */
  async function firmar(p, titulo) {
    const d = p.getByRole('dialog', { name: titulo });
    await d.getByLabel('Su contraseña').waitFor({ timeout: T.respuesta });
    // Con una sola persona que firma dice «Firma: …»; con varias, se elige de «Quién autoriza» (viene una elegida).
    const lista = d.getByLabel('Quién autoriza');
    const quien = (await lista.count())
      ? `firma ${(await lista.locator('option:checked').innerText()).trim()}`
      : (await d.getByText(/^Firma: /).innerText()).trim();
    await d.getByLabel('Su contraseña').fill(CLAVE_PRUEBAS);
    return { d, quien };
  }

  const ger = await r.como('gerente');
  await ger.goto(`${PANEL}/socios/${socio.id}`, { waitUntil: 'networkidle' });

  // ── 1. Historia ───────────────────────────────────────────────────────────
  r.paso('historia');
  await ger.getByRole('tab', { name: /Historia/ }).click();
  const historia = ger.getByTestId('historia-socio');
  const renglon = historia.getByTestId('historia-renglon');
  await renglon.first().waitFor({ timeout: T.respuesta });
  await asentado(ger);
  r.ok(await historia.locator('[data-testid="historia-renglon"][data-parte="PUERTA"]').count() >= 1, 'la Historia trae su entrada de hoy');
  r.ok(await historia.locator('[data-testid="historia-renglon"][data-parte="DINERO"]').count() >= 1, 'y su cobro');
  await r.captura(ger, 'ficha-1-historia');
  await accion(ger, () => historia.getByRole('button', { name: 'Dinero', exact: true }).click(), new RegExp(`/api/members/${socio.id}/history\\?.*kind=DINERO`), { que: 'la historia filtrada por Dinero' });
  await renglon.first().waitFor({ timeout: T.respuesta });
  await asentado(ger);
  const soloDinero = await renglon.evaluateAll((lis) => lis.length > 0 && lis.every((li) => li.dataset.parte === 'DINERO'));
  r.ok(soloDinero, `el filtro «Dinero» deja solo lo de dinero (${await renglon.count()} renglones)`);

  // ── 2. Estado de cuenta: una lista «Movimientos» ──────────────────────────
  r.paso('movimientos');
  await ger.getByRole('tab', { name: /Estado de cuenta/ }).click();
  const movs = ger.getByTestId('cuenta-movimientos');
  await movs.getByTestId('mov-cargo').first().waitFor({ timeout: T.respuesta });
  await asentado(ger);
  r.ok(await movs.getByText('Movimientos', { exact: true }).count() === 1, 'el Estado de cuenta es una lista «Movimientos»');
  const cargo = movs.getByTestId('mov-cargo').filter({ hasText: concepto });
  const pago = movs.locator('[data-testid="mov-pago"][data-contra="no"]').first();
  r.ok(await cargo.count() === 1 && await pago.count() === 1, 'con sus cargos y sus pagos en la misma lista');
  r.ok(/Cubrió: /.test(await pago.getByTestId('pago-cubre').innerText().catch(() => '')), 'el pago dice qué cubrió');
  r.ok(/200\.00/.test(await ger.getByTestId('cuenta-totales').innerText()), 'y arriba, lo que debe ($200.00)');
  await r.captura(ger, 'ficha-2-movimientos', { full: true });

  // ── 3. Corregir un cargo: descuento con motivo y firma ────────────────────
  r.paso('corregir un cargo');
  await cargo.getByRole('button', { name: 'Corregir', exact: true }).click();
  const cor = ger.getByRole('dialog', { name: `Corregir «${concepto}»` });
  r.ok(await aparece(cor, T.ui), `«Corregir» nombra el cargo: «Corregir «${concepto}»»`);
  const descontar = cor.getByRole('radiogroup', { name: '¿Qué corrección es?' }).getByRole('radio', { name: /^Descontar/ });
  if (await descontar.count()) await descontar.click();
  const aplicar = cor.getByRole('button', { name: 'Aplicar descuento' });
  await aplicar.waitFor({ timeout: T.ui });
  r.ok(await aplicar.isDisabled(), 'sin motivo ni importe no se aplica');
  const primerMotivo = cor.getByRole('radiogroup', { name: '¿Qué descuento es?' }).getByRole('radio').first();
  const motivo = (await primerMotivo.innerText()).trim();
  await primerMotivo.click();
  await cor.getByRole('group', { name: 'Atajos de importe' }).getByRole('button', { name: 'La mitad' }).click();
  r.ok(await aparece(cor.getByText('Queda pendiente $100.00.'), T.ui), 'con «La mitad» dice cuánto queda pendiente ($100.00)');
  await r.captura(ger, 'ficha-3-corregir');
  // La mitad pasa del tope del gerente: la API pide firma (428) y la pantalla la pide ahí mismo.
  await aplicar.click();
  const f1 = await firmar(ger, 'Autorizar descuento');
  r.ok(true, `el descuento pasa de su tope y pide firma (${f1.quien})`);
  const ajuste = await accion(ger, () => f1.d.getByRole('button', { name: 'Autorizar' }).click(), /\/api\/charges\/[^/]+\/adjustments$/, { metodo: 'POST', que: 'el descuento autorizado' });
  r.ok(ajuste.ok(), `con la firma, el descuento se aplica (${ajuste.status()})`);
  await ger.getByText('Descuento aplicado').waitFor({ timeout: T.respuesta });
  await asentado(ger);
  r.ok(await aparece(cargo.getByText('Pendiente $100.00'), T.respuesta), 'el cargo queda con «Pendiente $100.00»');
  const ajustes = cargo.getByTestId('cargo-ajustes');
  await ajustes.locator('summary').click();
  const textoAjuste = await ajustes.innerText();
  r.ok(/Descuento de \$100\.00/.test(textoAjuste) && /Autorizó /.test(textoAjuste), `y su ajuste dice el motivo («${motivo}») y quién autorizó: «${textoAjuste.split('\n').slice(1).join(' ').trim().slice(0, 140)}»`);

  // ── 4. Devolver un cobro ──────────────────────────────────────────────────
  r.paso('devolver un cobro');
  await pago.getByRole('button', { name: 'Devolver', exact: true }).click();
  const dev = ger.getByRole('dialog', { name: 'Devolver dinero' });
  await dev.waitFor({ timeout: T.respuesta });
  r.ok(await dev.getByTestId('devolver-pago').count() === 1 && await dev.getByText('Lo que va a pasar').count() === 1, '«Devolver dinero» dice de qué pago se trata y lo que va a pasar');
  const pedir = dev.getByRole('button', { name: 'Pedir autorización' });
  r.ok(await pedir.isDisabled(), 'sin motivo no se pide la autorización');
  await dev.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Se cobró dos veces' }).click();
  await dev.getByLabel('Referencia de la devolución').fill(`DEV${L.toUpperCase()}`);
  await r.captura(ger, 'ficha-4-devolver');
  await pedir.click();
  const f2 = await firmar(ger, /^Autorizar la devolución de \$/);
  const reversa = await accion(ger, () => f2.d.getByRole('button', { name: 'Autorizar' }).click(), /\/api\/payments\/[^/]+\/reverse$/, { metodo: 'POST', que: 'la devolución' });
  r.ok(reversa.ok(), `con la firma (${f2.quien}), el cobro se devuelve (${reversa.status()})`);
  await ger.getByText(/Pago revertido/).waitFor({ timeout: T.respuesta });
  await asentado(ger);
  const contra = movs.locator('[data-testid="mov-pago"][data-contra="si"]');
  r.ok(await aparece(contra.first(), T.respuesta) && /Reversa/.test(await contra.first().innerText()), 'la reversa aparece en «Movimientos»');
  r.ok(new RegExp(`ref\\. DEV${L.toUpperCase()}`).test(await contra.first().innerText()), 'con el motivo y la referencia de la devolución');
  r.ok(await movs.locator('[data-testid="mov-pago"][data-contra="no"]').first().getByText('Revertido').count() === 1, 'y el pago original queda «Revertido»');
  await r.captura(ger, 'ficha-5-devuelto', { full: true });
  await ger.getByRole('tab', { name: /Historia/ }).click();
  await renglon.first().waitFor({ timeout: T.respuesta });
  await asentado(ger);
  r.ok(await historia.locator('[data-testid="historia-renglon"][data-parte="DINERO"]').filter({ hasText: /Autorizó/ }).count() >= 2, 'la Historia cuenta el descuento y la devolución, con quién autorizó');

  // ── 5. La hoja para el socio ──────────────────────────────────────────────
  r.paso('hoja para el socio');
  await ger.getByRole('tab', { name: /Estado de cuenta/ }).click();
  const enlace = movs.getByRole('link', { name: 'Imprimir para el socio' });
  await enlace.waitFor({ timeout: T.respuesta });
  r.ok((await enlace.getAttribute('href')) === `/recibo/estado/${socio.id}`, '«Imprimir para el socio» lleva a su hoja');
  // La hoja abre en otra pestaña; aquí se abre en una página propia del recorrido (misma sesión) para leerla.
  const hoja = await ger.context().newPage();
  await hoja.goto(`${PANEL}/recibo/estado/${socio.id}`, { waitUntil: 'networkidle' });
  const doc = hoja.getByTestId('estado-para-el-socio');
  r.ok(await aparece(doc, T.navegacion) && await doc.getByRole('heading', { name: 'Estado de cuenta' }).count() === 1, 'la hoja para el socio abre');
  const textoHoja = await doc.innerText().catch(() => '');
  r.ok(textoHoja.includes(socio.lastName) && textoHoja.includes(concepto), 'con su nombre y sus cargos');
  r.ok(await hoja.getByRole('button', { name: 'Imprimir o guardar como PDF' }).count() === 1, 'y el botón para imprimirla');
  await hoja.screenshot({ path: new URL('./shots/ficha-6-hoja.png', import.meta.url).pathname, fullPage: true });
}, { erroresDePagina: 'falla' });
