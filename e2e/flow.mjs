// Biometría en la ficha (bloque 2.3): recepción registra el rostro con el
// asistente nuevo (comprobación previa, consentimiento, captura de frente
// revisada), lo revoca con motivo y el consentimiento biométrico queda firmado.
//
// La cámara falsa del navegador de pruebas no tiene un rostro real y el motor
// facial de pruebas puede no estar encendido: se simulan las TRES respuestas
// del motor (estado, revisión de la captura y registro). El registro simulado
// crea de verdad un enrolamiento por la ruta del lector, para que la pestaña,
// la revocación y el consentimiento se prueben contra la API. El motor real lo
// cubren las pruebas del servidor (test/rostro.test.ts, test/biometria-asistente.test.ts)
// y la prueba de humo del motor (motor-facial/probar.sh).
// Datos propios (fase 1.17a): el socio sin biometría es de esta corrida.
import { recorrido, socioAlCorriente, asentado, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('flow', async (r) => {
  const gerencia = await r.api('gerencia');
  const socio = await socioAlCorriente(gerencia, { sede: 'CEN' });
  const page = await r.como('recepcion', { permissions: ['camera'] });
  const shot = (n) => r.captura(page, `flow-${n}`);

  let motorEncendido = false;
  await page.route('**/api/access/face/status', (x) => x.fulfill({ json: motorEncendido
    ? { disponible: true, motivo: null, modelo: 'buffalo_sc', umbral: 0.38, margen: 0.05, alcance: 'branch' }
    : { disponible: false, motivo: 'El motor facial no está encendido en este equipo.', modelo: null, umbral: 0.38, margen: 0.05, alcance: 'branch' } }));
  await page.route('**/api/access/face/check', (x) => x.fulfill({ json: { ok: true, problema: null, cuadrosConRostro: 6, cuadrosDeFrente: 6 } }));
  await page.route('**/api/members/*/biometric-enrollments/face', async (x) => {
    const { branchId } = x.request().postDataJSON();
    const e = await gerencia.post(`/members/${socio.id}/biometric-enrollments`, {
      modality: 'FACE', branchId, templateRef: `simulado-${Date.now()}`, algorithmVendor: 'lector-sucursal', reason: 'Recorrido flow: registro simulado',
    });
    await x.fulfill({ status: 201, json: { ...e, consentVersion: null } });
  });

  // Recepción abre la ficha de un socio de su sucursal, sin biometría, en la pestaña Biometría.
  r.paso('comprobación previa');
  await page.goto(`${PANEL}/socios/${socio.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Biometría/ }).click();
  await asentado(page);
  const registrar = page.getByRole('button', { name: 'Registrar rostro', exact: true });
  await registrar.first().waitFor();
  r.ok(await registrar.count() > 0, 'recepción ve «Registrar rostro»');
  r.ok(await aparece(page.getByTestId('bio-motor-apagado'), T.ui), 'con el motor apagado, la pestaña lo dice antes del botón');
  await registrar.first().click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByTestId('bio-no-se-puede').waitFor({ timeout: T.respuesta });
  r.ok(await dialogo.getByRole('switch').count() === 0, 'con el motor apagado el asistente no pide la firma');
  await shot('0-no-se-puede');

  // Se enciende el motor: «Volver a comprobar» pasa al consentimiento.
  r.paso('registrar');
  motorEncendido = true;
  await dialogo.getByRole('button', { name: 'Volver a comprobar' }).click();
  await dialogo.getByRole('switch').waitFor({ timeout: T.respuesta });
  const cont = dialogo.getByRole('button', { name: 'Continuar' });
  r.ok(await cont.isDisabled(), 'no avanza sin aceptación del socio');
  r.ok(await dialogo.getByLabel('Motivo').count() === 0, 'registrar un rostro no pide motivo');
  await dialogo.getByRole('switch').check();
  await cont.click();
  const confirmar = dialogo.getByRole('button', { name: 'Registrar rostro', exact: true });
  r.ok(await confirmar.isDisabled(), 'no registra hasta que la captura se revisa');
  await dialogo.getByRole('button', { name: 'Capturar', exact: true }).click();
  await dialogo.getByText('Rostro detectado').waitFor({ timeout: T.respuesta });
  await shot('1-capturado');
  await confirmar.click();
  await page.getByTestId('rostro-registrado').waitFor({ timeout: T.respuesta });
  await shot('2-completo');
  await page.getByRole('button', { name: 'Listo' }).click();
  await asentado(page);
  r.ok(await aparece(page.getByText('Activo', { exact: true }).first(), T.ui), 'la tarjeta muestra el registro activo');
  await shot('3-activo');

  // Revocar
  r.paso('revocar');
  await page.getByRole('button', { name: 'Revocar' }).first().click();
  const revBtn = page.getByRole('dialog').getByRole('button', { name: 'Revocar' });
  r.ok(await revBtn.isDisabled(), 'revocar exige motivo');
  await page.getByRole('dialog').getByRole('button', { name: 'El socio retiró su consentimiento' }).click();
  await revBtn.click();
  await page.getByTestId('bio-historial').waitFor({ timeout: T.respuesta });
  await shot('4-revocado');
  r.ok(await aparece(page.getByText(/Pendiente · quedan 30 días/).first(), T.ui), 'historial con plazo de borrado (registro de lector)');

  // Pestaña consentimientos: el biométrico quedó firmado
  r.paso('consentimiento biométrico');
  await page.getByRole('tab', { name: /Consentimientos/ }).click();
  await asentado(page);
  r.ok(await page.getByText('Consentimiento biométrico').count() > 0, 'consentimiento biométrico registrado');
  await shot('5-consentimientos');
}, { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
