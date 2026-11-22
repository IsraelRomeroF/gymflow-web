// ARCO de punta a punta: descargar, dar de baja y anonimizar (panel) y
// descargar mis datos (portal).
// Datos propios (fase 1.17a): el socio que se da de baja y se anonimiza, y el
// que entra al portal, son de esta corrida (antes se anonimizaba al último
// activo de la semilla, uno por corrida).
import { recorrido, socioAlCorriente, invitacionPortal, PANEL, PORTAL, T, CLAVE_PRUEBAS } from './lib/index.mjs';

await recorrido('privacidad', async (r) => {
  const api = await r.api('gerencia');
  const socio = await socioAlCorriente(api, { sede: 'CEN' });
  const otro = await socioAlCorriente(api, { sede: 'CEN' });

  const g = await r.como('gerente', { acceptDownloads: true });
  await g.goto(`${PANEL}/socios/${socio.id}`, { waitUntil: 'networkidle' });
  await g.getByText('Datos personales y baja').waitFor({ timeout: T.respuesta });

  // 1. Acceso: el archivo se descarga.
  r.paso('descargar sus datos');
  await g.getByRole('button', { name: 'Descargar sus datos' }).click();
  await g.getByRole('dialog').getByLabel('Motivo').fill('Lo pidió por escrito en recepción');
  const [descarga] = await Promise.all([g.waitForEvent('download'), g.getByRole('dialog').getByRole('button', { name: 'Descargar' }).click()]);
  r.ok(/datos-.*\.json/.test(descarga.suggestedFilename()), `descarga ${descarga.suggestedFilename()}`);

  // 2. Baja.
  r.paso('baja');
  await g.getByRole('button', { name: 'Dar de baja' }).click();
  await g.getByRole('dialog').getByLabel('Motivo').fill('Se mudó de ciudad');
  await g.getByRole('dialog').getByRole('button', { name: 'Dar de baja' }).click();
  await g.getByText(/quedó dado de baja/).waitFor({ timeout: T.respuesta });
  await g.getByRole('button', { name: 'Anonimizar' }).waitFor({ timeout: T.respuesta });
  r.ok(await g.getByText('Dado de baja').count() > 0, 'la ficha muestra que está dado de baja');

  // 3. Anonimizar con la autorización del dueño.
  r.paso('anonimizar');
  await g.getByRole('button', { name: 'Anonimizar' }).click();
  await g.getByRole('dialog').getByLabel('Motivo').fill('Solicitud de cancelación ARCO por escrito');
  await g.getByRole('dialog').getByRole('button', { name: 'Pedir autorización' }).click();
  const a = g.getByRole('dialog').last();
  // 2.10 (20-14): con una sola persona que firma, ya está elegida; no se teclea su correo.
  await a.getByText(/^Firma: /).waitFor();
  await a.getByLabel('Su contraseña').fill(CLAVE_PRUEBAS);
  await a.getByRole('button', { name: 'Autorizar' }).click();
  await g.getByRole('heading', { name: 'Socio anonimizado' }).waitFor({ timeout: T.respuesta });
  r.ok(true, 'la ficha queda como "Socio anonimizado"');
  await g.getByRole('button', { name: 'Anonimizar' }).waitFor({ state: 'detached', timeout: T.ui });
  r.ok(true, 'ya no ofrece anonimizar otra vez');
  await r.captura(g, 'arco-anonimizado');

  // 4. Portal: descargar mis datos desde la hoja de cuenta.
  r.paso('portal: descargar mis datos');
  const code = await invitacionPortal(api, otro);
  const p = await r.nueva({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await p.goto(`${PORTAL}/activar#${code}`, { waitUntil: 'networkidle' });
  r.ok(await p.getByLabel('Código de activación').inputValue() === code, 'el código del QR llega ya escrito');
  await p.getByRole('button', { name: /Activar/ }).click();
  await p.waitForURL(`${PORTAL}/`);
  // Desde la fase 2 (bloque 2.8) Cuenta es una pestaña, no una hoja.
  await p.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Cuenta' }).click();
  const [mia] = await Promise.all([p.waitForEvent('download'), p.getByRole('link', { name: 'Descargar mis datos' }).click()]);
  r.ok(mia.suggestedFilename().endsWith('.json'), 'el socio descarga sus datos');
  await p.getByRole('button', { name: 'Cerrar sesión en este teléfono' }).click();
  r.ok(await p.getByText('¿Cerrar sesión?').count() === 1, 'cerrar sesión pide confirmación');
  await r.captura(p, 'portal-cuenta');
});
