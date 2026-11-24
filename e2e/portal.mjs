// Portal del socio de punta a punta: la gerencia genera el código en el panel
// y el socio activa su teléfono, ve cómo entra, paga todo lo pendiente «solo
// esta vez», reserva y cancela una clase (y conserva su lugar), ve su
// asistencia y el formulario de alta.
// Reserva DESPUÉS de pagar (fase 3, bloque 3.5, D-16): quien debe su
// mensualidad no aparta una clase suelta desde el teléfono, y antes de pagar
// el portal se lo dice en vez de ofrecerle el botón.
//   node e2e/portal.mjs dark    con el esquema oscuro (capturas)
// Elige por estado al socio que DEBE SU CUOTA y tiene biometría (la biometría
// no se puede sembrar desde un recorrido): pagar le devuelve la entrada. Las
// esperas son a la respuesta del pago y de la reserva, no un rato.
import { recorrido, respuesta, accion, asentado, aparece, PANEL, PORTAL, T } from './lib/index.mjs';

const scheme = process.argv[2] ?? 'light';

await recorrido('portal', async (r) => {
  // 1. La gerencia genera el código en el panel, en la ficha de un socio con
  // biometría y con adeudo si lo hay (el caso más completo para enseñar).
  r.paso('código del portal');
  const staff = await r.como('gerencia', { colorScheme: scheme, etiqueta: 'panel' });
  // Se busca al socio que DEBE SU CUOTA (membresía en mora o suspendida) y tiene
  // biometría: es a quien pagar le devuelve la entrada. Uno que solo debe una
  // clase suelta paga y sigue igual, y la aserción de "Hoy entras" no aplica.
  const elegido = await staff.evaluate(async () => {
    const socios = (await (await fetch('/api/members?status=ACTIVE&limit=100')).json()).members;
    let conBio = null; let conDeuda = null;
    for (const s of socios.slice(0, 80)) {
      const bio = (await (await fetch(`/api/members/${s.id}/biometric-enrollments`)).json()).enrollments.filter((e) => !e.revokedAt);
      if (bio.length === 0) continue;
      conBio ??= { id: s.id, cuota: false };
      if (BigInt(s.balanceCents) <= 0n) continue;
      conDeuda ??= { id: s.id, cuota: false };
      const ms = await (await fetch(`/api/members/${s.id}/memberships`)).json();
      const viva = (Array.isArray(ms) ? ms : ms.memberships ?? []).find((m) => m.status === 'PAST_DUE' || m.status === 'SUSPENDED');
      if (viva) return { id: s.id, cuota: true };
    }
    return conDeuda ?? conBio;
  });
  const memberId = elegido.id;
  const debeCuota = elegido.cuota;
  if (!debeCuota) r.nota('ningún socio con biometría debe su cuota: se usa uno con biometría y se omite «Hoy entras»');
  await staff.goto(`${PANEL}/socios/${memberId}`, { waitUntil: 'networkidle' });
  await staff.getByRole('button', { name: 'Más' }).click();
  // Fase 2.2: un solo diálogo «Portal de {nombre}»; el código se genera dentro.
  await staff.getByRole('menuitem', { name: /^Portal de / }).click();
  await staff.getByRole('dialog').getByRole('button', { name: 'Generar código' }).click();
  await staff.getByText(/Código para/).waitFor({ timeout: T.respuesta });
  await r.captura(staff, `${scheme}-p0-panel-codigo`);
  const code = (await staff.locator('.dialog .mono').innerText()).trim();
  r.ok(/^[A-Z0-9-]{6,}$/.test(code), `el panel generó un código (${code})`);

  // 2. El socio, en su teléfono.
  r.paso('el socio activa su teléfono');
  const page = await r.nueva({ movil: true, colorScheme: scheme, etiqueta: 'portal' });
  const shot = (n, full = false) => r.captura(page, `${scheme}-p${n}`, { full });
  await page.goto(`${PORTAL}/`, { waitUntil: 'networkidle' });
  r.ok(page.url().endsWith('/activar'), 'sin sesión lleva a Activar');
  await shot('1-activar');
  await page.getByLabel('Código de activación').fill(code);
  await page.getByRole('button', { name: /Activar/ }).click();
  await page.waitForURL(`${PORTAL}/`);
  await page.waitForLoadState('networkidle');
  await page.getByText('Cómo entras').waitFor({ timeout: T.respuesta });
  await shot('2-inicio');
  await shot('2b-inicio-completo', true);
  r.ok(await page.getByText('Cómo entras').count() > 0, 'inicio muestra cómo entra');
  r.ok(await page.getByText(/Con tu (rostro|huella)/).count() > 0, 'muestra su biometría real');

  r.paso('con adeudo, la clase suelta no se ofrece');
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Clases' }).click();
  await page.waitForLoadState('networkidle');
  await asentado(page);
  await shot('3-clases');
  if (debeCuota) {
    const avisos = await page.getByTestId('solo-pagando').allInnerTexts();
    r.ok(await page.getByRole('button', { name: 'Reservar · se paga en recepción' }).count() === 0 && avisos.every((t) => /Debes tu mensualidad/.test(t)),
      `debiendo su mensualidad no se le ofrece apartar una clase suelta sin pagar (${avisos.length} del día dicen por qué)`);
  }

  r.paso('pagar todo lo pendiente');
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Pagos' }).click();
  await page.waitForLoadState('networkidle');
  await asentado(page);
  await shot('4-pagos', true);
  const antes = await page.locator('.big-stat').first().innerText();
  // Ya no se ofrece domiciliar (auditoría 8, 25-02 y D25-01): nadie cobra solo el
  // día de corte todavía. Sin tarjeta guardada se paga «solo esta vez».
  r.ok(await page.getByRole('button', { name: /domicili/i }).count() === 0 && await page.getByTestId('mandato').count() === 0, 'Pagos ya no ofrece domiciliar la mensualidad (25-02)');
  // Se paga TODO lo pendiente: la cuota del periodo y lo demás que deba.
  // Cada vuelta espera la respuesta de SU pago.
  const pagar = page.getByRole('button', { name: 'Pagar', exact: true });
  const hoja = page.getByTestId('hoja-pago');
  let hojaVista = false;
  for (let i = 0; i < 4; i++) {
    await asentado(page);
    if (!(await pagar.first().isVisible())) break;
    if (await pagar.first().isDisabled()) {
      console.log('botón deshabilitado; aviso:', await page.locator('.callout').allInnerTexts());
      await r.captura(page, `${scheme}-debug-pagar`, { full: true });
      break;
    }
    const pago = respuesta(page, /\/api\/portal\/charges\/[^/]+\/pay$/, { metodo: 'POST', que: 'el pago' });
    pago.catch(() => undefined);
    await pagar.first().click();
    // Sin tarjeta guardada, una hoja dice cuánto y qué, y se paga solo esta vez (no se guarda).
    const primero = await Promise.race([hoja.waitFor({ timeout: T.respuesta }).then(() => 'hoja', () => 'nada'), pago.then(() => 'pago', () => 'nada')]);
    if (primero === 'hoja') {
      if (!hojaVista) r.ok(/solo esta vez y no se guarda/.test(await hoja.innerText()), 'sin tarjeta guardada, la hoja dice que se paga solo esta vez y no se guarda');
      hojaVista = true;
      await hoja.getByRole('button', { name: /solo esta vez$/ }).click();
    }
    await pago;
  }
  await asentado(page);
  const despues = await page.locator('.big-stat').first().innerText();
  r.ok(despues === 'Al corriente', `pagar todo deja el saldo al corriente (${antes} → ${despues})`);
  // «Pagada hasta» es lo pagado, no el fin del periodo (auditoría 8, 3-01).
  const pagado = page.getByTestId('pagado-hasta');
  r.ok(await aparece(pagado, T.ui) && /pagada hasta el \d/.test(await pagado.innerText()), `Pagos dice hasta cuándo está pagada: «${(await pagado.innerText().catch(() => '')).trim()}»`);
  await shot('4b-pagos-pagado', true);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Inicio' }).click();
  await page.waitForLoadState('networkidle');
  await asentado(page);
  r.ok(await page.locator('.tab-dot').count() === 0, 'tras pagar desaparece el aviso de pago pendiente');
  // Se espera a que la tarjeta se actualice, no un tiempo fijo.
  if (debeCuota) {
    r.ok(await aparece(page.locator('.member-card').getByText('Hoy entras').first(), T.respuesta), 'tras pagar la membresía la tarjeta dice "Hoy entras"');
  } else r.ok(true, 'este socio no debía su cuota: pagar no cambia su entrada (no se afirma "Hoy entras")');
  await shot('4c-inicio-reactivado');

  // Ya al corriente, reserva: una incluida en su plan o una suelta con más de una hora de margen
  // (la que empieza antes ya no trae botón). Se prefiere el segundo día: ahí ninguna empieza en minutos.
  r.paso('reservar y conservar el lugar');
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Clases' }).click();
  await page.waitForLoadState('networkidle');
  await asentado(page);
  const reservar = page.getByRole('button', { name: /^Reservar/ }).first();
  const fichas = page.getByRole('group', { name: 'Día' }).getByRole('button');
  if (await fichas.count() > 1) {
    await fichas.nth(1).click();
    if (await reservar.count() === 0) await fichas.nth(0).click();
  }
  r.ok(await reservar.count() > 0, 'al corriente, el portal le ofrece reservar una clase');
  if (await reservar.count()) {
    await accion(page, () => reservar.click(), /\/api\/portal\/classes\/[^/]+\/book$/, { metodo: 'POST', que: 'la reserva' });
    await asentado(page);
    await shot('3b-clases-reservada');
    r.ok(await page.getByText('Tu lugar').count() > 0, 'reservar marca la clase como suya');
    // Cancelar se confirma diciendo qué pasa (auditoría 8, 11-10); aquí se conserva el lugar.
    await page.getByRole('button', { name: 'Cancelar reserva' }).first().click();
    const confirma = page.getByTestId('confirmar-cancelar');
    r.ok(await aparece(confirma, T.ui) && /lugar queda libre|cuenta como falta/.test(await confirma.innerText()), 'cancelar la reserva pide confirmar y dice qué pasa con su lugar');
    await confirma.getByRole('button', { name: 'No, conservar mi lugar' }).click();
    await confirma.waitFor({ state: 'hidden', timeout: T.ui });
    r.ok(await page.getByText('Tu lugar').count() > 0, '«No, conservar mi lugar» lo deja como estaba');
  }
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Inicio' }).click();
  await page.waitForLoadState('networkidle');
  await asentado(page);

  r.paso('asistencia y alta');
  // Asistencia dejó de ser pestaña (fase 2, bloque 2.8): se llega desde «Este mes» de Inicio.
  r.ok(await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Asistencia' }).count() === 0 && await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Cuenta' }).count() === 1, 'las pestañas son Inicio · Clases · Rutina · Pagos · Cuenta (Asistencia ya no es pestaña)');
  await page.getByRole('link', { name: 'Asistencia', exact: true }).click();
  await page.waitForURL(`${PORTAL}/asistencia`);
  await page.waitForLoadState('networkidle');
  await asentado(page);
  await shot('5-asistencia', true);
  r.ok(await page.locator('.cal-day.is-in').count() > 0, 'el calendario marca días con visita');

  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Inicio' }).click();
  await page.waitForLoadState('networkidle');
  await shot('6-inicio-con-clase');

  // Alta digital pública
  const sede = await staff.evaluate(async () => (await (await fetch('/api/branches')).json())[0].id);
  await page.goto(`${PORTAL}/alta/${sede}`, { waitUntil: 'networkidle' });
  await shot('7-alta');
});
