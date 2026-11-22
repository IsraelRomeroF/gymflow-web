// La membresía en la ficha: congelar y descongelar, cambiar de plan cobrando,
// renovar en efectivo y cancelar. El estado vive solo en la insignia de la
// cabecera (ficha de estado único, UX7).
// Datos propios (fase 1.17a): un socio de Centro con su mensualidad pagada
// hace 12 días, de esta corrida (antes: el primero de la semilla que cumpliera,
// y llegó a tomar a uno que debía una clase suelta).
import { recorrido, crearSocio, venderMembresia, dia, elegirCaja, asentado, hasta, PANEL, T } from './lib/index.mjs';

await recorrido('membresia', async (r) => {
  const g = await r.api('gerencia');
  const socio = await crearSocio(g, { sede: 'CEN' });
  // Al corriente, con Mensualidad y de hace al menos 10 días: con la cuota
  // abierta (el día de corte) la tarjeta ya no ofrece «Renovar» sino «Cobrar
  // $X» (auditoría 8, 4-06); eso lo cubre dinero.mjs.
  await venderMembresia(g, socio, { plan: 'MEN', inicio: dia(-12), motivo: 'Historial del recorrido de prueba' });
  const page = await r.como('gerencia');
  const shot = (n) => r.captura(page, `m${n}`);
  // La insignia se recalcula al recargar la cuenta: se espera a que diga lo nuevo.
  const estado = async (re) => { await page.locator('.profile .badge').filter({ hasText: re }).first().waitFor({ timeout: T.respuesta }).catch(() => undefined); return page.locator('.profile .badge').first().innerText(); };
  r.ok(!!socio.id, 'hay un socio con mensualidad vigente');
  await page.goto(`${PANEL}/socios/${socio.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Renovar' }).waitFor({ timeout: T.respuesta });
  await shot('1-acciones');

  // Congelar y descongelar
  r.paso('congelar');
  await page.getByRole('button', { name: 'Congelar' }).click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('Viaje de trabajo');
  await shot('2-congelar');
  await page.getByRole('dialog').getByRole('button', { name: 'Congelar' }).click();
  await page.getByRole('button', { name: 'Descongelar' }).waitFor({ timeout: T.respuesta });
  r.ok((await estado(/Congelada/)).includes('Congelada'), 'congelar la deja congelada');
  await page.getByRole('button', { name: 'Descongelar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Descongelar' }).click();
  await page.getByRole('button', { name: 'Renovar' }).waitFor({ timeout: T.respuesta });
  r.ok((await estado(/Al corriente/)).includes('Al corriente'), 'descongelar la regresa a al corriente');

  // Cambiar de plan
  r.paso('cambiar de plan');
  await page.getByRole('button', { name: 'Cambiar de plan' }).click();
  const d = page.getByRole('dialog');
  await d.getByText('Multisede mensual').click();
  await d.getByLabel('Motivo').fill('Quiere entrar a todas las sucursales');
  await shot('4-cambiar-plan');
  await asentado(page);
  await elegirCaja(d);
  await d.getByRole('button', { name: 'Cambiar y cobrar' }).click();
  await page.getByText('Plan cambiado').waitFor({ timeout: T.respuesta }).catch(async (e) => {
    console.log('AVISOS:', await page.locator('.toast').allInnerTexts(), 'SOCIO:', socio.id);
    throw e;
  });
  await shot('5-plan-cambiado');
  r.ok(await page.getByText(/ahora tiene Multisede/).count() > 0, 'el cambio de plan se confirma con lo acreditado y cobrado');
  await page.getByRole('button', { name: 'Listo' }).click();
  await asentado(page);
  r.ok((await page.locator('.stat').filter({ hasText: 'Membresía' }).locator('.stat-value').innerText()).includes('Multisede'), 'la ficha muestra el plan nuevo');

  // Renovar cobrando en efectivo
  r.paso('renovar');
  const vigente = page.locator('.stat').filter({ hasText: 'Vigente hasta' }).locator('.stat-value');
  const antes = await vigente.innerText();
  await page.getByRole('button', { name: 'Renovar' }).click();
  await page.getByRole('dialog').getByText('Siguiente periodo').waitFor({ timeout: T.respuesta });
  await asentado(page);
  await elegirCaja(page.getByRole('dialog'));
  await shot('3-renovar');
  await page.getByRole('dialog').getByRole('button', { name: /^Renovar y cobrar/ }).click();
  await page.getByText(/Renovada hasta/).waitFor({ timeout: T.respuesta });
  // La cifra se recarga después del aviso: se espera a que cambie, con su tope.
  await hasta(page, (a) => [...document.querySelectorAll('.stat')].find((x) => /Vigente hasta/.test(x.textContent ?? ''))?.querySelector('.stat-value')?.textContent !== a, antes, { timeout: T.respuesta, que: 'La cobertura nueva en la ficha' }).catch(() => undefined);
  const despues = await vigente.innerText();
  r.ok(antes !== despues, `renovar mueve la cobertura (${antes} → ${despues})`);

  // Cancelar
  r.paso('cancelar');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('Se muda de ciudad');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar membresía' }).click();
  // Si quedó una cuota sin pagar, "Vender membresía" vive en el menú Más y la tarjeta dice que está cancelada.
  await page.getByText(/Cancelada: no se renueva/).or(page.getByRole('button', { name: 'Vender membresía' })).first().waitFor({ timeout: T.respuesta });
  // Cancelada ya no es «vigente»: la cifra dice hasta dónde pagó (auditoría 8, 3-01).
  r.ok((await page.locator('.stat').filter({ hasText: /Vigente hasta|Pagado hasta/ }).innerText()).includes('Cancelada'), 'cancelar la deja cancelada y ofrece vender una nueva');
  await shot('6-cancelada');
});
