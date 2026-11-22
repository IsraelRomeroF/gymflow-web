// Altas digitales: recepción saca el QR y el cartel; la persona llena el
// formulario en su teléfono (con la antigüedad cuando viene del sistema
// anterior y la salud solo con su consentimiento); recepción corrige, aprueba
// y vende; la nota de salud la ve quien tiene permiso; y el historial.
import { recorrido, celular, letras, elegirCaja, asentado, PANEL, T } from './lib/index.mjs';

await recorrido('altas', async (r) => {
  // 1. Recepción saca el QR del formulario
  r.paso('QR y cartel');
  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/altas`, { waitUntil: 'networkidle' });
  // Con la bandeja vacía el botón del encabezado se oculta y el QR sale del aviso.
  await rec.getByRole('button', { name: /^(Formulario de alta|Ver el QR del formulario)$/ }).first().click();
  await rec.getByRole('dialog').locator('svg[aria-label="Código QR"]').waitFor();
  const enlace = await rec.getByRole('dialog').locator('input.mono').inputValue();
  r.ok(/\/alta\/demo-centro$/.test(enlace), `el panel da el enlace corto del formulario (${enlace})`);
  await r.captura(rec, 'a1-qr');

  // El cartel imprimible
  const cartel = await r.nueva({ viewport: { width: 1100, height: 1400 } });
  await cartel.goto(`${PANEL}/cartel/${enlace.split('/').pop()}`, { waitUntil: 'networkidle' });
  await cartel.getByText(/Inscríbete desde/).waitFor();
  r.ok(await cartel.getByText(/Centro/).count() > 0, 'el cartel dice la sucursal');
  await r.captura(cartel, 'a2-cartel');

  // 2. La persona escanea y llena el formulario en su teléfono
  r.paso('formulario en el teléfono');
  const tel = await r.nueva({ movil: true });
  await tel.goto(enlace, { waitUntil: 'networkidle' });
  await tel.getByLabel('Nombre(s)').waitFor({ timeout: T.respuesta });
  // La antigüedad se pregunta siempre, con sí o no (bloque 2.4, 9-07): ya no depende de `?antiguedad=1`,
  // que ningún QR ni cartel llevaba. La fecha solo aparece para quien ya venía.
  r.ok(await tel.getByText('¿Ya venías a este gimnasio?').count() >= 1 && await tel.getByLabel('¿Desde cuándo vienes al gimnasio?').count() === 0, 'a todos se les pregunta si ya venían, y la fecha solo a quien dice que sí');
  r.ok(await tel.getByText(/Leí y acepto: aviso de privacidad/i).count() === 1, 'cada casilla dice qué se acepta');
  await tel.getByRole('button', { name: 'Sí, ya venía' }).click();
  const nombre = `Valeria${letras(4).toLowerCase()}`;
  await tel.getByLabel('Nombre(s)').fill(nombre);
  await tel.getByLabel('Apellidos').fill('Montes Ibarra');
  await tel.getByLabel('Celular').fill(celular());
  await tel.getByLabel('¿Desde cuándo vienes al gimnasio?').fill('2023-03-15');
  await tel.locator('#en').fill('Rosa Ibarra');
  await tel.locator('#ep').fill('5512345678');
  r.ok(await tel.locator('#hn').count() === 0, 'la pregunta de salud no aparece sin su consentimiento');
  const checks = tel.getByRole('checkbox');
  for (let i = 0; i < await checks.count(); i++) await checks.nth(i).check();
  await tel.locator('#hn').waitFor();
  r.ok(true, 'al aceptar el consentimiento de salud aparece su pregunta');
  await tel.locator('#hn').fill('Tendinitis en el hombro izquierdo');
  await r.captura(tel, 'a3-formulario', { full: true });
  await tel.getByRole('button', { name: 'Enviar mis datos' }).click();
  await tel.getByText('Solo falta pasar a recepción').waitFor({ timeout: T.respuesta });
  await r.captura(tel, 'a4-enviado');
  r.ok(true, 'el formulario se envía');
  const folio = (await tel.getByTestId('folio-alta').locator('.folio-alta-codigo').innerText()).trim();
  r.ok(/^[0-9A-F]{6}$/.test(folio), `y da un folio para decir en recepción (${folio})`);

  // 3. Recepción aprueba y vende
  r.paso('recepción corrige, aprueba y vende');
  await rec.goto(`${PANEL}/altas`, { waitUntil: 'networkidle' });
  // Recepción la encuentra por el folio que le dictan (bloque 2.4, 9-06).
  await rec.getByLabel('Buscar alta').fill(folio);
  await rec.getByText(nombre).first().click();
  await rec.getByRole('heading', { name: new RegExp(nombre) }).waitFor();
  // Rechazar pide confirmar nombrando a la persona (auditoría 8, fase 0.10); aquí se cancela.
  await rec.getByRole('button', { name: 'Rechazar', exact: true }).click();
  const rechazo = rec.getByRole('dialog', { name: `Rechazar el alta de ${nombre} Montes Ibarra` });
  r.ok(await rechazo.waitFor({ timeout: T.ui }).then(() => true, () => false), 'rechazar un alta pide confirmar y nombra a la persona');
  await rechazo.getByRole('button', { name: 'Cancelar', exact: true }).click();
  // Recepción completa lo que faltó antes de aprobar (2026-10-09).
  await rec.getByRole('button', { name: 'Corregir o completar' }).click();
  await rec.getByTestId('corregir-alta').waitFor();
  await rec.getByLabel('Contacto de emergencia').fill('Hermana · completado en recepción');
  await rec.getByRole('button', { name: 'Aprobar con los cambios' }).click();
  await rec.getByText('Alta aprobada').waitFor({ timeout: T.respuesta });
  r.ok(true, 'recepción corrige o completa el alta y aprueba con los cambios');
  // Lo que sigue es una lista de pasos por el estado del socio (9-01): el primero, vender.
  await rec.getByTestId('pasos-del-alta').waitFor({ timeout: T.respuesta });
  r.ok(await rec.getByTestId('pasos-del-alta').locator('[data-paso="SELL"][data-siguiente="true"]').count() === 1, 'el alta aprobada dice los pasos que faltan, y el que sigue es vender');
  await r.captura(rec, 'a5-aprobada');
  await rec.getByRole('button', { name: 'Vender membresía' }).click();
  await rec.waitForURL('**/socios/**');
  await rec.getByRole('dialog').getByText('Mensualidad', { exact: true }).waitFor({ timeout: T.respuesta });
  r.ok(true, 'aprobar lleva a la ficha con la venta abierta');
  await rec.getByRole('dialog').getByText('Mensualidad', { exact: true }).click();
  await rec.getByRole('dialog').getByRole('button', { name: 'Continuar' }).click();
  await rec.getByRole('dialog').getByText('Total').waitFor({ timeout: T.respuesta });
  await asentado(rec);
  await elegirCaja(rec.getByRole('dialog'));
  await rec.getByRole('dialog').getByRole('button', { name: /^Cobrar/ }).click();
  await rec.getByText(/ya puede entrar/).waitFor({ timeout: T.respuesta });
  await rec.getByRole('button', { name: 'Listo' }).click();
  await asentado(rec);
  r.ok(await rec.getByText('15 mar 2023').count() > 0, 'la ficha conserva la antigüedad declarada');
  r.ok(await rec.getByText('Hermana · completado en recepción').count() > 0, 'y el contacto de emergencia corregido en recepción');
  r.ok(await rec.getByText('Tendinitis').count() === 0, 'recepción NO ve la nota de salud');
  await r.captura(rec, 'a6-ficha');
  const url = rec.url().split('?')[0];

  // La gerencia sí ve la nota de salud
  const duena = await r.como('gerencia');
  await duena.goto(url, { waitUntil: 'networkidle' });
  await duena.getByText('Tendinitis en el hombro izquierdo').waitFor({ timeout: T.respuesta });
  r.ok(true, 'quien tiene permiso de salud sí la ve');

  // 4. Historial
  r.paso('historial');
  await rec.goto(`${PANEL}/altas`, { waitUntil: 'networkidle' });
  await rec.getByRole('button', { name: 'Aprobadas' }).click();
  await rec.getByText(new RegExp(nombre)).first().waitFor({ timeout: T.respuesta });
  r.ok(true, 'el alta aparece en el historial de aprobadas');
  await r.captura(rec, 'a7-historial');
});
