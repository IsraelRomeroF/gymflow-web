// Avisos y permisos del socio en su teléfono (PS-03, PS-07, PS-02): la campana
// marca el teléfono nuevo, abrirla los deja leídos, la pestaña Cuenta muestra lo que
// firmó y pide una corrección ARCO que la gerencia ve en su bandeja.
// Datos propios (fase 1.17a): el socio es de esta corrida (antes, el cuarto
// del padrón, que pudo haber abierto su portal en otra corrida).
import { recorrido, socioAlCorriente, invitacionPortal, asentado, aparece, PANEL, PORTAL, T } from './lib/index.mjs';

await recorrido('avisos', async (r) => {
  const g = await r.api('gerencia');
  const socio = await socioAlCorriente(g, { sede: 'CEN' });
  const code = await invitacionPortal(g, socio);
  r.ok(/^[A-Z0-9-]{6,}$/.test(code), 'recepción emitió el código del portal');

  const page = await r.nueva({ movil: true, etiqueta: 'portal' });
  const shot = (n) => r.captura(page, `avisos-${n}`);
  await page.goto(`${PORTAL}/activar`, { waitUntil: 'networkidle' });
  await page.getByLabel('Código de activación').fill(code);
  await page.getByRole('button', { name: /Activar/ }).click();
  await page.waitForURL(`${PORTAL}/`);
  await page.getByText('Cómo entras').waitFor({ timeout: T.respuesta });

  // La campana: el teléfono nuevo ya es un aviso.
  r.paso('la campana');
  await page.getByTestId('campana').waitFor({ timeout: T.respuesta });
  await page.getByTestId('campana').locator('span').first().waitFor({ timeout: T.respuesta }).catch(() => undefined);
  const etiqueta = await page.getByTestId('campana').getAttribute('aria-label');
  r.ok(/sin leer/.test(etiqueta ?? ''), `la campana marca avisos sin leer (${etiqueta})`);
  await shot('1-campana');
  await page.getByTestId('campana').click();
  await page.getByText('Tu portal se activó en un teléfono').first().waitFor({ timeout: T.respuesta });
  r.ok(true, 'el aviso dice que el portal se abrió en un teléfono nuevo');
  await shot('2-avisos');
  await page.keyboard.press('Escape');
  await page.getByText('Tu portal se activó en un teléfono').first().waitFor({ state: 'hidden', timeout: T.ui }).catch(() => undefined);
  // Abrirla manda «leídos» a la API: se espera esa respuesta, no un rato.
  await asentado(page);
  const despues = await page.getByTestId('campana').getAttribute('aria-label');
  r.ok(!/sin leer/.test(despues ?? ''), 'al abrirlos quedan leídos');

  // Tu cuenta: permisos y solicitudes.
  r.paso('tu cuenta');
  // «Tu cuenta» era una hoja tras un ícono; desde la fase 2 (bloque 2.8) es la pestaña Cuenta.
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Cuenta' }).click();
  await page.getByTestId('tus-permisos').waitFor({ timeout: T.respuesta });
  await page.getByTestId('tus-permisos').locator('.item').first().waitFor({ timeout: T.respuesta });
  r.ok(await page.getByTestId('tus-permisos').getByText('Aviso de privacidad').count() === 1, 'el socio ve lo que firmó, en palabras');
  await page.getByRole('button', { name: 'Pedir que corrijan o borren mis datos' }).click();
  await page.getByLabel('Detalle').fill('Mi apellido está mal escrito');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await page.getByText(/Recibido/).waitFor({ timeout: T.respuesta });
  r.ok(true, 'pide una corrección desde el teléfono y le dicen el plazo');
  await shot('3-permisos');
  r.ok(await page.getByRole('button', { name: 'Cerrar sesión en este teléfono' }).count() === 1, 'puede cerrar sesión en este teléfono');

  // En el panel, la solicitud ya está en la bandeja de cumplimiento con su plazo.
  r.paso('la bandeja ARCO del panel');
  const staff = await r.como('gerencia', { etiqueta: 'panel' });
  await staff.goto(`${PANEL}/consentimientos`, { waitUntil: 'networkidle' });
  await staff.getByTestId('bandeja-arco').getByText(/Vence el/).first().waitFor({ timeout: T.respuesta });
  r.ok(await staff.getByTestId('bandeja-arco').getByText('Desde su teléfono').count() > 0, 'la gerencia ve la solicitud del teléfono en su bandeja');
}, { erroresDePagina: 'ok' });
