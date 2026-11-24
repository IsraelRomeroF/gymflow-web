// «Cuenta con GymFlow» (fase 3, bloques 3.11 y 3.12 · D-37), en el navegador:
// la dueña ve en su Inicio la tarjeta «Tu cuenta con GymFlow», llega a la
// pantalla por su menú y ahí consulta su mensualidad y sus facturas (solo
// consulta: no hay nada que pagar ni cambiar). El gerente no la tiene en su
// menú y, si teclea la dirección, la pantalla le dice de quién es.
//
// No cambia nada: solo lee.
import { recorrido, abrirMenu, irPorMenu, asentado, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('cuenta-gymflow', async (r) => {
  r.paso('la dueña');
  const duena = await r.como('duena');
  const tarjeta = duena.getByTestId('cuenta-gymflow-duena');
  r.ok(await aparece(tarjeta, T.respuesta), `el Inicio de la dueña trae «Tu cuenta con GymFlow» (estado ${await tarjeta.getAttribute('data-cobro').catch(() => '?')})`);
  r.ok(await tarjeta.getByRole('link', { name: 'Ver facturas y avisos' }).getAttribute('href') === '/cuenta-gymflow', 'con el enlace «Ver facturas y avisos»');
  await r.captura(duena, 'cuenta-gymflow-1-inicio', { full: true });
  await irPorMenu(duena, 'Cuenta con GymFlow');
  await duena.waitForURL('**/cuenta-gymflow', { timeout: T.navegacion });
  r.ok(await aparece(duena.getByRole('heading', { name: 'Cuenta con GymFlow' }), T.navegacion), 'su menú la lleva a «Cuenta con GymFlow»');
  const mensualidad = duena.getByTestId('mensualidad-gymflow');
  await mensualidad.waitFor({ timeout: T.respuesta });
  await asentado(duena);
  // Bloque 4.9 (D-39): con IVA la tabla trae además «Antes de IVA» e «IVA»; el total tiene su propio testid.
  const total = (await mensualidad.getByTestId('mensualidad-total').innerText()).replace(/\s+/g, ' ').trim();
  // En gymflow_pruebas el gimnasio sembrado no tiene precios de plataforma: el total es $0.00 y no hay conceptos. Se comprueba la tabla, no la cifra.
  r.ok(/^Total \$[\d,]+\.\d{2}$/.test(total), `«Tu mensualidad» trae su total («${total}», ${await mensualidad.locator('tbody tr').count() - 1} conceptos)`);
  const facturas = duena.getByTestId('facturas-gymflow');
  r.ok(await facturas.count() === 1 && (await facturas.locator('tr[data-folio]').count() > 0 || await facturas.getByText('Sin facturas todavía').count() === 1), `«Facturas»: ${await facturas.locator('tr[data-folio]').count()} a la vista`);
  r.ok(await duena.getByRole('button', { name: /pagar/i }).count() === 0 && /Solo consulta/.test(await duena.locator('main').innerText()), 'es solo consulta: no hay botón de pagar');
  await r.captura(duena, 'cuenta-gymflow-2-pantalla', { full: true });

  r.paso('el gerente');
  const ger = await r.como('gerente');
  await abrirMenu(ger);
  r.ok(await ger.getByRole('link', { name: 'Cuenta con GymFlow', exact: true }).count() === 0, 'el gerente no la tiene en su menú');
  r.ok(await ger.getByTestId('aviso-gymflow').count() === 0, 'ni le sale el aviso de cobro de GymFlow');
  await ger.goto(`${PANEL}/cuenta-gymflow`, { waitUntil: 'networkidle' });
  r.ok(await aparece(ger.getByText('Tu rol no ve esta pantalla'), T.navegacion) && await ger.getByText(/Cuenta con GymFlow es para la Dueña o el Dueño/).count() === 1, 'y si teclea la dirección: «Tu rol no ve esta pantalla · Cuenta con GymFlow es para la Dueña o el Dueño»');
  r.ok(await ger.getByTestId('facturas-gymflow').count() === 0, 'sin facturas ni importes a la vista');
});
