// Los plazos del gimnasio (fase 4, bloque 4.4 · D-18), vistos en el navegador:
//
//  1. La gerencia abre Retención → «Los plazos de este gimnasio»: los seis de
//     fábrica (21, 60, 30, 6 meses, 7 y 90) y «Son los de GymFlow».
//  2. «Cambiar…»: un cruce imposible (Perdido antes que Dejó de venir) lo dice
//     el pie; sin motivo no guarda; «Dejó de venir» en 28 con motivo → la
//     cifra «Dejaron de venir» dice «28 días o más» y la frase «(de fábrica: 21 días)».
//  3. «Cambiar con autorización…» (los de la deuda): 90 → 120 abre la firma;
//     con la contraseña de la dueña se guarda.
//  4. «Recuperar»: un socio de la corrida que canceló hoy sale con «Canceló su
//     membresía el …», «Se le busca hasta el …» y «Le llamé»; su ficha dice
//     «De baja desde el …».
//  5. Recepción no tiene Retención en su menú; la API no le deja cambiar plazos.
//
// Los plazos son del gimnasio entero: al empezar y al terminar (pase lo que
// pase) se vuelven a los de fábrica borrando su renglón de gymflow_pruebas,
// como cajon hace con los topes del cajón.
import { recorrido, socioAlCorriente, accion, asentado, aparece, firmar, irPorMenu, abrirMenu, sql, PANEL, T } from './lib/index.mjs';

await recorrido('plazos', async (r) => {
  const g = await r.api('gerencia');
  const rcp = await r.api('recepcion');
  const deFabrica = () => sql(`delete from member_term_settings where "organizationId" = (select id from organizations where "tradeName" = 'Gimnasio Demo') returning "organizationId"`);
  if ((await deFabrica()).length) r.nota('los plazos venían ajustados por una corrida que no terminó: se volvieron a los de fábrica');
  r.alFinal(async () => { await deFabrica(); });

  const antes = await g.get('/member-terms');
  r.ok(antes.terms.dormantDays === 21 && antes.terms.lostDays === 60 && antes.terms.lostDebtDays === 90 && antes.customized.length === 0, 'datos de la corrida: los plazos son los de fábrica (21, 60 … 90)');

  // Un socio de la corrida que cancela hoy: «Recuperar» lo busca.
  const socio = await socioAlCorriente(g);
  await g.post(`/memberships/${socio.membresiaId}/cancel`, { reason: 'Se muda de ciudad (recorrido de prueba)' });
  const nombre = `${socio.firstName} ${socio.lastName}`;

  // ── 1. Los plazos de fábrica ──────────────────────────────────────────────
  r.paso('los plazos de fábrica');
  const ger = await r.como('gerente');
  await irPorMenu(ger, 'Retención');
  await ger.waitForURL('**/retencion', { timeout: T.navegacion });
  const plazos = ger.getByTestId('plazos-del-gimnasio');
  await plazos.waitFor({ timeout: T.respuesta });
  const cifra = ger.locator('.stat').filter({ hasText: 'Dejaron de venir' }).first();
  r.ok(await aparece(cifra.getByText('21 días o más'), T.respuesta), 'la cifra «Dejaron de venir» dice «21 días o más»');
  await plazos.locator('summary').click();
  r.ok(await aparece(plazos.getByText('Son los de GymFlow: nadie los ha cambiado.'), T.ui), '«Son los de GymFlow: nadie los ha cambiado.»');
  const frase = async (k) => (await plazos.getByTestId(`plazo-${k}`).innerText()).trim();
  r.ok(/A los 21 días sin venir/.test(await frase('dormantDays')) && /A los 60 días/.test(await frase('lostDays')) && /30 días/.test(await frase('churnDays'))
    && /6 meses/.test(await frase('winbackMonths')) && /a los 7 días/.test(await frase('unpaidSaleDays')) && /A los 90 días/.test(await frase('lostDebtDays')),
  'seis frases con 21, 60, 30, 6 meses, 7 y 90');
  await r.captura(ger, 'plazos-1-de-fabrica', { full: true });

  // ── 2. Ajustar uno de retención, con motivo ───────────────────────────────
  r.paso('ajustar retención');
  await plazos.getByRole('button', { name: 'Cambiar…', exact: true }).click();
  let d = ger.getByRole('dialog', { name: 'Plazos de retención' });
  await d.waitFor({ timeout: T.ui });
  await d.getByLabel('Perdido (días)').fill('20');
  await d.getByLabel('Motivo').fill('Así viene la gente de este gimnasio');
  await d.getByRole('button', { name: 'Guardar' }).click();
  r.ok(await aparece(d.getByText(/«Perdido» tiene que ser más días que «Dejó de venir»/), T.ui), 'Perdido en 20 (menos que 21): el pie dice «“Perdido” tiene que ser más días que “Dejó de venir”»');
  await d.getByLabel('Perdido (días)').fill('60');
  await d.getByLabel('Dejó de venir (días)').fill('28');
  await d.getByLabel('Motivo').fill('');
  await d.getByRole('button', { name: 'Guardar' }).click();
  r.ok(await aparece(d.getByText('Escribe el motivo del cambio.'), T.ui), 'sin motivo no guarda: el campo lo pide');
  await d.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Así viene la gente de este gimnasio' }).click();
  await r.captura(ger, 'plazos-2-cambiar-retencion');
  const guardado = await accion(ger, () => d.getByRole('button', { name: 'Guardar' }).click(), '/api/member-terms/retention', { metodo: 'PUT', que: 'el cambio de retención' });
  r.ok(guardado.ok(), `se guarda con motivo y sin firma (${guardado.status()})`);
  r.ok(await aparece(ger.getByText('Plazos de retención actualizados'), T.respuesta), 'avisa «Plazos de retención actualizados»');
  await asentado(ger);
  r.ok(await aparece(cifra.getByText('28 días o más'), T.respuesta), 'la cifra pasa a «28 días o más»');
  if (!(await plazos.getAttribute('open') !== null)) await plazos.locator('summary').click();
  r.ok(/A los 28 días sin venir/.test(await frase('dormantDays')) && /\(de fábrica: 21 días\)/.test(await frase('dormantDays')), `la frase dice 28 y «(de fábrica: 21 días)»: «${await frase('dormantDays')}»`);
  r.ok(await aparece(plazos.getByText(/Los plazos de este gimnasio \(ajustados\)/), T.ui), 'el plegable dice «(ajustados)»');
  r.ok(/Último cambio: .*Héctor Salinas/.test(await plazos.innerText()), 'y quién lo cambió');
  const api1 = await g.get('/member-terms');
  r.ok(api1.terms.dormantDays === 28 && api1.customized.includes('dormantDays'), 'la API lo confirma (28, ajustado)');

  // ── 3. Ajustar uno de la deuda: con firma ─────────────────────────────────
  r.paso('ajustar la deuda con firma');
  await plazos.getByRole('button', { name: 'Cambiar con autorización…' }).click();
  d = ger.getByRole('dialog', { name: 'Plazos de la deuda' });
  await d.waitFor({ timeout: T.ui });
  r.ok(/siempre lo autoriza otra persona/i.test(await d.innerText()) && /ninguna deuda se borra/.test(await d.innerText()), 'el diálogo dice que lo autoriza otra persona y que ninguna deuda se borra');
  await d.getByLabel('Deuda que se da por perdida (días)').fill('120');
  await d.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Lo pidió el contador' }).click();
  await d.getByRole('button', { name: 'Pedir autorización' }).click();
  const f = await firmar(ger, 'Autorizar el cambio de los plazos de la deuda');
  await r.captura(ger, 'plazos-3-firma-deuda');
  const deuda = await accion(ger, () => f.autorizar(), '/api/member-terms/debt', { metodo: 'PUT', que: 'el cambio de la deuda' });
  r.ok(deuda.ok(), `con la firma (${f.quien}) se guarda (${deuda.status()})`);
  r.ok(await aparece(ger.getByText('Plazos de la deuda actualizados'), T.respuesta), 'avisa «Plazos de la deuda actualizados»');
  await asentado(ger);
  if (!(await plazos.getAttribute('open') !== null)) await plazos.locator('summary').click();
  r.ok(/A los 120 días de suspendida/.test(await frase('lostDebtDays')) && /\(de fábrica: 90 días\)/.test(await frase('lostDebtDays')), 'la frase de la deuda dice 120 y «(de fábrica: 90 días)»');
  const sinFirma = await g.crudo('PUT', '/member-terms/debt', { lostDebtDays: 100, reason: 'Sin firma (recorrido de prueba)' });
  r.ok(sinFirma.status === 428, `sin firma la API no lo cambia (${sinFirma.status})`);

  // ── 4. «Recuperar» ────────────────────────────────────────────────────────
  r.paso('recuperar');
  const fila = ger.getByTestId('por-recuperar').locator('li').filter({ hasText: nombre });
  r.ok(await aparece(fila, T.respuesta), `«Recuperar» trae a ${nombre}, que canceló hoy`);
  const texto = (await fila.innerText()).replace(/\s+/g, ' ');
  r.ok(/Canceló su membresía el /.test(texto) && /Se muda de ciudad/.test(texto) && /Se le busca hasta el /.test(texto), `con por qué y hasta cuándo: «${texto.slice(0, 200)}»`);
  r.ok(await fila.getAttribute('data-causa') === 'CANCELED' && await fila.getByText('Baja', { exact: true }).count() === 1, 'marcado como «Baja»');
  await fila.getByRole('button', { name: 'Le llamé' }).click();
  const c = ger.getByRole('dialog');
  await c.getByRole('radio', { name: 'Llamada' }).click();
  await c.getByRole('radio', { name: 'No contestó', exact: true }).click();
  await accion(ger, () => c.getByRole('button', { name: 'Registrar contacto' }).click(), `/api/members/${socio.id}/follow-ups`, { metodo: 'POST', que: 'el contacto' });
  r.ok(await aparece(fila.getByTestId('ultimo-contacto').filter({ hasText: 'No contestó' }), T.respuesta), '«Le llamé» deja el contacto en su fila');
  await r.captura(ger, 'plazos-4-recuperar');
  await fila.getByRole('link', { name: nombre }).click();
  await ger.waitForURL(`**/socios/${socio.id}`, { timeout: T.navegacion });
  const baja = ger.getByTestId('de-baja-desde');
  r.ok(await aparece(baja, T.respuesta) && /De baja desde el .*: canceló su membresía/.test(await baja.innerText()), `su ficha: «${(await baja.innerText().catch(() => '')).trim()}»`);

  // ── 5. Recepción ──────────────────────────────────────────────────────────
  r.paso('recepción');
  const rec = await r.como('recepcion');
  await abrirMenu(rec);
  r.ok(await rec.getByRole('link', { name: 'Retención', exact: true }).count() === 0, 'recepción no tiene Retención en su menú');
  const ajena = await rcp.crudo('PUT', '/member-terms/retention', { dormantDays: 30, reason: 'Recepción lo intenta (recorrido de prueba)' });
  r.ok(ajena.status === 403, `y la API no le deja cambiar los plazos (${ajena.status})`);
}, { erroresDePagina: 'informa' });
