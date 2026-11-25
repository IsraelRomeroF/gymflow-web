// Dirección (fase 2, bloque 2.7; recorrido de 2.14): la Lista de precios es de
// consulta —recepción la abre desde su menú y ve el precio de SU sede, sin
// nada que editar; la gerencia elige la sucursal y ve el precio propio de cada
// una (16-02, 16-03)—; «Mi gimnasio» son tres pestañas (Datos, Sucursales,
// Módulos) que conservan sus direcciones `/gimnasio`, `/sucursales` y
// `/modulos` (19-02, D-27); y al editar un plan, antes de guardar, la pantalla
// dice a quién afecta el cambio (`GET /plans/:id/impact`, 16-01).
//
// No cambia nada: lo que espera sale de la API de pruebas en el momento (qué
// sede tiene recepción, cuánto cuesta ahí la Mensualidad, cuántos socios la
// tienen), y el plan se edita sin guardar («Cancelar»); al final se comprueba
// que su precio y sus sedes siguen como estaban.
import { recorrido, irPorMenu, respuesta, asentado, aparece, PANEL, T } from './lib/index.mjs';

/** «$650» como lo pinta el panel sin centavos, a partir de centavos en texto. */
const pesos = (centavos) => `$${(Number(centavos) / 100).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;

await recorrido('direccion-precios', async (r) => {
  const g = await r.api('gerencia');
  const recApi = await r.api('recepcion');
  const sedes = (await g.get('/branches')).filter((b) => b.isActive);
  // La sede de recepción se pregunta, no se supone.
  const alcance = (await recApi.get('/auth/me')).branchScopes ?? [];
  const suSede = sedes.find((b) => b.id === alcance[0]);
  if (alcance.length !== 1 || !suSede) throw new Error(`Recepción ya no tiene una sola sede (${alcance.length}): el recorrido espera la cuenta sembrada`);
  const enSuSede = (await recApi.get(`/plans?branchId=${suSede.id}`)).find((p) => p.code === 'MEN');
  const antes = (await g.get('/plans')).find((p) => p.code === 'MEN');
  const impacto = await g.get(`/plans/${antes.id}/impact`);
  // Una sede abierta donde la Mensualidad tiene precio propio (en la semilla, Frontera).
  const conPropio = impacto.branches.find((b) => b.isOpen && b.isAvailable && b.hasOwnPrice && b.branchId !== suSede.id);

  // ── 1. Recepción: la lista de precios de su sede, de consulta ─────────────
  r.paso('recepción abre la lista de precios');
  const rec = await r.como('recepcion');
  await irPorMenu(rec, 'Lista de precios');
  await rec.waitForURL('**/precios', { timeout: T.navegacion });
  const lista = rec.getByTestId('lista-de-precios');
  await lista.waitFor({ timeout: T.respuesta });
  await asentado(rec);
  r.ok(await rec.getByRole('heading', { name: 'Lista de precios' }).count() === 1 && await rec.getByText(`Lo que se vende hoy en ${suSede.name} y cuánto cuesta ahí.`, { exact: false }).count() === 1, `recepción llega por su menú a la Lista de precios de ${suSede.name}`);
  const filaRec = lista.locator('tr[data-plan="MEN"]');
  r.ok((await filaRec.innerText()).includes(pesos(enSuSede.effectivePriceCents)), `la Mensualidad sale con el precio de su sede (${pesos(enSuSede.effectivePriceCents)})`);
  r.ok(await lista.getByText(`Los precios son los de ${suSede.name}.`, { exact: false }).count() === 1, 'y al pie dice de qué sucursal son los precios');
  r.ok(await rec.getByRole('button', { name: /Editar|Nuevo plan|Guardar/ }).count() === 0 && await rec.getByRole('link', { name: 'Cambiar planes y precios' }).count() === 0, 'sin botón de editar ni enlace a «Cambiar planes y precios»');
  r.ok(await rec.locator('main').getByRole('group', { name: 'Sucursal' }).count() === 0, 'con una sola sede no hay selector de sucursal');
  await r.captura(rec, 'dp-1-precios-recepcion');
  // Mi gimnasio no es de recepción.
  await rec.goto(`${PANEL}/gimnasio`, { waitUntil: 'networkidle' });
  r.ok(await aparece(rec.getByText('Tu rol no ve esta pantalla'), T.respuesta) && await rec.getByTestId('datos-del-gimnasio').count() === 0, 'recepción no entra a los datos del gimnasio');

  // ── 2. La gerencia: elige sucursal y ve el precio propio ──────────────────
  r.paso('la gerencia ve el precio de cada sede');
  const ger = await r.como('gerencia');
  await ger.goto(`${PANEL}/precios`, { waitUntil: 'networkidle' });
  const listaG = ger.getByTestId('lista-de-precios');
  await listaG.waitFor({ timeout: T.respuesta });
  r.ok(await ger.getByRole('link', { name: 'Cambiar planes y precios' }).count() === 1, 'la gerencia sí tiene «Cambiar planes y precios»');
  if (conPropio) {
    const pedida = respuesta(ger, (u) => u.includes(`/api/plans?branchId=${conPropio.branchId}`), { metodo: 'GET', que: `los precios de ${conPropio.name}` });
    pedida.catch(() => undefined);
    const selector = ger.locator('main').getByRole('group', { name: 'Sucursal' });
    await selector.getByRole('button', { name: conPropio.name, exact: true }).click();
    await pedida;
    await ger.getByText(`Los precios son los de ${conPropio.name}.`, { exact: false }).waitFor({ timeout: T.respuesta });
    const texto = await listaG.locator('tr[data-plan="MEN"]').innerText();
    r.ok(texto.includes(pesos(conPropio.listPriceCents)) && conPropio.listPriceCents !== antes.priceCents, `al elegir ${conPropio.name}, la Mensualidad cuesta ahí ${pesos(conPropio.listPriceCents)} (de lista ${pesos(antes.priceCents)})`);
    await r.captura(ger, 'dp-2-precios-gerencia-otra-sede');
  } else r.nota('ninguna sede abierta tiene precio propio para la Mensualidad: no se comprueba el precio por sede');

  // ── 3. Mi gimnasio: Datos, y las pestañas conservan su dirección ──────────
  r.paso('Mi gimnasio');
  const perfil = await g.get('/organization/profile');
  // El menú de la gerencia tiene una sola entrada, «Mi gimnasio» (2.12); a cuál pestaña llega no importa aquí.
  await irPorMenu(ger, 'Mi gimnasio');
  const pestanas = ger.getByTestId('mi-gimnasio');
  await pestanas.waitFor({ timeout: T.navegacion });
  const nombres = (await pestanas.getByRole('tab').allInnerTexts()).map((t) => t.trim());
  r.ok(nombres.join(' · ') === 'Datos · Sucursales · Módulos' && ['/gimnasio', '/sucursales', '/modulos'].includes(new URL(ger.url()).pathname), `«Mi gimnasio» del menú abre sus tres pestañas (${nombres.join(' · ')}) en ${new URL(ger.url()).pathname}`);
  await pestanas.getByRole('tab', { name: 'Datos' }).click();
  await ger.waitForURL('**/gimnasio', { timeout: T.navegacion });
  const datos = ger.getByTestId('datos-del-gimnasio');
  await datos.waitFor({ timeout: T.respuesta });
  await asentado(ger);
  const textoDatos = await datos.innerText();
  r.ok(textoDatos.includes(perfil.tradeName) && textoDatos.includes(perfil.legalName), `Datos muestra el nombre comercial y la razón social (${perfil.tradeName} · ${perfil.legalName})`);
  r.ok(new RegExp(`${perfil.branches.open} abiertas?`).test(textoDatos), `y cuántas sucursales tiene abiertas (${perfil.branches.open})`);
  r.ok(await ger.getByText('Estos datos los cambia GymFlow, no el panel').count() === 1 && await ger.locator('main').getByRole('button', { name: /Editar|Guardar|Cambiar/ }).count() === 0 && await datos.getByRole('textbox').count() === 0, 'es de consulta: dice quién los cambia y no hay campos ni botón de editar');
  r.ok(await pestanas.getByRole('tab', { name: 'Datos' }).getAttribute('aria-selected') === 'true', 'la pestaña Datos queda marcada en /gimnasio');
  await r.captura(ger, 'dp-3-gimnasio-datos');
  await pestanas.getByRole('tab', { name: 'Módulos' }).click();
  await ger.waitForURL('**/modulos', { timeout: T.navegacion });
  await ger.getByTestId('mi-gimnasio').getByRole('tab', { name: 'Módulos', selected: true }).waitFor({ timeout: T.respuesta });
  r.ok(new URL(ger.url()).pathname === '/modulos', 'la pestaña Módulos conserva su dirección /modulos');
  await ger.getByTestId('mi-gimnasio').getByRole('tab', { name: 'Sucursales' }).click();
  await ger.waitForURL('**/sucursales', { timeout: T.navegacion });
  await ger.getByTestId('mi-gimnasio').getByRole('tab', { name: 'Sucursales', selected: true }).waitFor({ timeout: T.respuesta });
  r.ok(new URL(ger.url()).pathname === '/sucursales', 'y Sucursales, la suya /sucursales');
  await ger.getByTestId('mi-gimnasio').getByRole('tab', { name: 'Datos' }).click();
  await ger.waitForURL('**/gimnasio', { timeout: T.navegacion });
  r.ok(await aparece(ger.getByTestId('datos-del-gimnasio'), T.respuesta), 'de vuelta en Datos, /gimnasio');

  // ── 4. Editar un plan dice a quién afecta, antes de guardar ───────────────
  r.paso('el impacto de cambiar un plan');
  await ger.goto(`${PANEL}/planes`, { waitUntil: 'networkidle' });
  const tarjeta = ger.locator('.card').filter({ has: ger.getByText(antes.code, { exact: true }) }).filter({ has: ger.getByRole('button', { name: 'Editar' }) }).last();
  await tarjeta.waitFor({ timeout: T.respuesta });
  // Lo que la pantalla diga se compara con lo que ELLA recibió de la API (otros recorridos venden Mensualidades a la vez).
  const pedido = respuesta(ger, `/api/plans/${antes.id}/impact`, { metodo: 'GET', que: 'el impacto del plan' });
  pedido.catch(() => undefined);
  await tarjeta.getByRole('button', { name: 'Editar' }).click();
  const dlg = ger.getByRole('dialog', { name: `Editar ${antes.name}` });
  await dlg.waitFor({ timeout: T.ui });
  const visto = await (await pedido).json();
  await asentado(ger);
  r.ok(await dlg.getByTestId('plan-impacto').count() === 0, 'sin cambios no hay aviso de impacto');
  const nuevo = Number(antes.priceCents) / 100 + 40;
  await dlg.getByLabel('Precio por periodo').fill(String(nuevo));
  const imp = dlg.getByTestId('plan-impacto');
  await imp.getByText(/tienen? este plan|Nadie tiene este plan/).waitFor({ timeout: T.respuesta });
  const n = visto.liveMemberships.toLocaleString('es-MX');
  // D-19 (bloque 3.6): la vista previa del cambio de precio se pide aparte; se espera a que llegue.
  // 4.20: un aumento dice «Les sube con 15 días de aviso»; «Les cambia en su siguiente pago» si a nadie le toca.
  await imp.getByText(/en su siguiente pago|días de aviso/).first().waitFor({ timeout: T.respuesta });
  const textoImp = (await imp.innerText()).replace(/\s+/g, ' ');
  r.ok(visto.liveMemberships > 0 && textoImp.includes(`${n} ${visto.liveMemberships === 1 ? 'socio tiene' : 'socios tienen'} este plan`), `al cambiar el precio dice cuántos lo tienen (${n}, lo mismo que la API)`);
  r.ok(textoImp.includes(`${pesos(antes.priceCents)} → ${pesos(nuevo * 100)}`) && /Para las ventas nuevas/.test(textoImp), `el precio de lista pasa de ${pesos(antes.priceCents)} a ${pesos(nuevo * 100)} para las ventas nuevas`);
  r.ok(/Les sube con 15 días de aviso|Les cambia en su siguiente pago/.test(textoImp), 'y dice a cuántos socios les sube, con 15 días de aviso (D-19; 4.20)');
  const propia = visto.branches.find((x) => x.isOpen && x.hasOwnPrice);
  if (propia) r.ok(textoImp.includes(`${propia.name} (${pesos(propia.listPriceCents)})`) && /precio propio y no cambia/.test(textoImp), `avisa que ${propia.name} tiene su precio propio y no cambia`);
  await r.captura(ger, 'dp-4-plan-impacto-precio');
  // Dejar de venderlo en una sede: dice cuántos lo tienen ahí y que lo conservan.
  const sedeApagada = visto.branches.find((b) => b.isOpen && b.isAvailable && b.liveMemberships > 0) ?? null;
  if (sedeApagada) {
    await dlg.getByRole('switch', { name: sedeApagada.name, exact: true }).uncheck();
    const aviso = imp.getByText(new RegExp(`En ${sedeApagada.name} hay ${sedeApagada.liveMemberships.toLocaleString('es-MX')} socios? con este plan vendido ahí`));
    r.ok(await aparece(aviso, T.ui) && /lo conservan y siguen renovando a su precio/.test(await imp.innerText()), `al apagar ${sedeApagada.name} dice que ${sedeApagada.liveMemberships} lo tienen ahí y lo conservan`);
    await r.captura(ger, 'dp-5-plan-impacto-sede');
  } else r.nota('ninguna sede tiene socios con la Mensualidad: no se comprueba el aviso de dejar de venderla ahí');
  // No se guarda nada.
  await dlg.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await dlg.waitFor({ state: 'hidden', timeout: T.ui });
  const despues = await g.get(`/plans/${antes.id}/impact`);
  const enVenta = (i) => i.branches.filter((x) => x.isAvailable).map((x) => `${x.branchId}:${x.listPriceCents}`).sort().join(',');
  r.ok(despues.priceCents === impacto.priceCents && enVenta(despues) === enVenta(impacto) && despues.isActive === impacto.isActive, `al cancelar, el plan queda como estaba: ${pesos(despues.priceCents)} y a la venta en las mismas sedes`);
}, { erroresDePagina: 'falla' });
