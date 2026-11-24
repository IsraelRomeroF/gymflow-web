// Bloque 4: punto de venta (recepción vende, la gerencia anula), producto con
// su mercancía, alta de personal con temporal y primer acceso, sucursal nueva
// con su caja, prospecto → inscripción, retención, y un cobro revertido con
// la firma de la dueña.
// Fase 1.17a: lo que la corrida crea y queda vivo se cierra al terminar: la
// recepcionista se da de baja y la sucursal se cierra (antes se quedaban, una
// de cada una por corrida, en Personal y en todos los selectores de sede).
import { recorrido, irPorMenu, abrirMenu, elegirContrasena, elegirCaja, accion, respuesta, asentado, aparece, celular, PANEL, T, CLAVE_PRUEBAS } from './lib/index.mjs';

await recorrido('bloque4', async (r) => {
  const sufijo = Date.now().toString(36).slice(-4).toUpperCase();
  // Los nombres de persona no llevan dígitos (la API los rechaza).
  const letras = sufijo.replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[Number(d)]);
  const email = `nueva.${sufijo.toLowerCase()}@demo.mx`;
  const codigo = `Z${sufijo.replace(/[0-9]/g, 'Q').slice(0, 2)}`;
  const g = await r.api('gerencia');
  r.alFinal(async () => {
    const u = (await g.get('/users')).users.find((x) => x.email === email && x.isActive);
    if (u) await g.patch(`/users/${u.id}`, { isActive: false, reason: 'Cuenta de un recorrido de prueba' });
    const b = (await g.get('/branches')).find((x) => x.code === codigo && x.isActive);
    if (b) await g.patch(`/branches/${b.id}`, { isActive: false, reason: 'Sucursal de un recorrido de prueba' });
  });
  const shot = (p, n) => r.captura(p, `b4-${n}`);

  // 1. Punto de venta (recepción).
  r.paso('punto de venta');
  const rec = await r.como('recepcion');
  await rec.getByRole('link', { name: 'Punto de venta' }).click();
  await rec.locator('.pos-producto').first().waitFor({ timeout: T.respuesta });
  await rec.locator('.pos-producto:not([disabled])').nth(0).click();
  await rec.locator('.pos-producto:not([disabled])').nth(0).click();
  await rec.locator('.pos-producto:not([disabled])').nth(1).click();
  await shot(rec, '1-pos');
  await rec.getByRole('button', { name: /^Cobrar \$/ }).click();
  // Estado "cobrado" (MC-06): total, cambio y ticket quedan a la vista.
  await rec.getByTestId('pos-cobrado').waitFor({ timeout: T.respuesta });
  r.ok(true, 'punto de venta: vende y cobra con la caja');
  r.ok(await rec.getByRole('link', { name: 'Ticket' }).count() === 1, 'tras cobrar ofrece el ticket de la venta');
  r.ok(await rec.getByRole('button', { name: 'Anular' }).count() === 0, 'recepción no anula ventas');
  // La venta de ESTE recorrido, por su folio: la primera fila de «Ventas de hoy» puede ser otra
  // (la siembra deja ventas con hora posterior y turno ya cerrado, que no se anulan).
  const folio = (await rec.getByTestId('pos-cobrado').innerText()).match(/[A-Z]{3}-C\d+-\d{6}/)?.[0];
  r.ok(!!folio, `la venta cobrada dice su folio (${folio})`);
  const anula = await r.como('gerencia');
  await anula.goto(rec.url(), { waitUntil: 'networkidle' });
  await anula.locator('tr', { hasText: folio }).getByRole('button', { name: 'Anular' }).click();
  await anula.getByRole('dialog').getByLabel('Motivo').fill('Se registró el producto equivocado');
  await anula.getByRole('dialog').getByRole('button', { name: 'Anular venta' }).click();
  await anula.getByText('Venta anulada').waitFor({ timeout: T.respuesta });
  r.ok(true, 'la venta del día la anula la gerencia, con motivo');
  await anula.close();

  // 2. Productos e inventario.
  r.paso('producto nuevo');
  const own = await r.como('gerencia');
  await irPorMenu(own, 'Productos');
  await own.getByRole('button', { name: 'Nuevo producto' }).first().click();
  let d = own.getByRole('dialog');
  await d.getByLabel('SKU').fill(`PRB-${sufijo}`);
  await d.getByLabel('Nombre').fill(`Barra de proteína ${sufijo}`);
  await d.getByLabel('Precio de público').fill('45');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await own.getByText(`Barra de proteína ${sufijo}`).waitFor({ timeout: T.respuesta });
  await own.getByRole('row', { name: new RegExp(`Barra de proteína ${sufijo}`) }).getByRole('button', { name: 'Existencias' }).click();
  d = own.getByRole('dialog');
  await d.getByLabel('Cantidad').fill('24');
  await d.getByLabel('Motivo').fill('Pedido del proveedor');
  await d.getByRole('button', { name: 'Registrar' }).click();
  await own.getByText(/Existencia de Barra de proteína .*: 24/).waitFor({ timeout: T.respuesta });
  r.ok(true, 'producto nuevo con su entrada de mercancía');
  await shot(own, '2-productos');

  // 3. Personal: alta con contraseña temporal y primer acceso.
  r.paso('alta de personal');
  await irPorMenu(own, 'Personal');
  await own.getByRole('button', { name: 'Dar de alta' }).click();
  d = own.getByRole('dialog');
  await d.getByLabel('Nombre completo').fill(`Laura Prueba ${letras}`);
  await d.getByLabel('Correo').fill(email);
  await d.getByRole('button', { name: 'Dar de alta' }).click();
  await own.getByText(/Contraseña temporal de/).waitFor({ timeout: T.respuesta });
  const temporal = (await own.locator('.dialog .mono').first().innerText()).trim();
  r.ok(/^GYM-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(temporal), `contraseña temporal legible, sin caracteres parecidos (${temporal})`);
  await shot(own, '3-personal-clave');
  await own.getByRole('button', { name: 'Ya la entregué' }).click();
  const nuevaP = await r.nueva();
  await nuevaP.goto(`${PANEL}/login`, { waitUntil: 'networkidle' });
  await nuevaP.locator('#email').fill(email);
  await nuevaP.locator('#password').fill(temporal);
  await nuevaP.getByRole('button', { name: /Entrar/ }).click();
  // Entró con una contraseña que le dio otra persona: el login le pide la suya
  // ahí mismo, antes de ver el panel (SEC2-08, A4-N1).
  const paso = nuevaP.getByTestId('elegir-contrasena');
  await paso.waitFor({ timeout: T.respuesta });
  r.ok(new URL(nuevaP.url()).pathname === '/login' && await paso.getByLabel('Contraseña actual').count() === 0,
    'la temporal se cambia antes de seguir, sin volver a pedirla');
  await elegirContrasena(nuevaP, 'LauraNueva.2026');
  await nuevaP.waitForURL('**/panel', { timeout: T.navegacion });
  r.ok(true, 'la nueva recepcionista entra con la temporal y la cambia');

  // 4. Sucursales: abrir una con su caja.
  r.paso('sucursal nueva');
  // 2.12: Sucursales es una pestaña de «Mi gimnasio» (una entrada del menú).
  await irPorMenu(own, 'Mi gimnasio');
  await own.getByRole('tab', { name: 'Sucursales', exact: true }).click();
  await own.getByRole('button', { name: 'Abrir sucursal', exact: true }).click();
  d = own.getByRole('dialog');
  await d.getByLabel('Código').fill(codigo);
  await d.getByLabel('Nombre').fill(`Prueba ${sufijo}`);
  await d.getByRole('button', { name: 'Abrir sucursal', exact: true }).click();
  await own.getByText(/abierta con su primera caja/).waitFor({ timeout: T.respuesta });
  await own.getByText(`Caja 1 ${codigo}`).waitFor({ timeout: T.respuesta });
  r.ok(true, 'la sucursal nueva nace con su caja');
  await shot(own, '4-sucursales');

  // 5. Prospecto → seguimiento → inscripción.
  r.paso('prospecto a socio');
  await rec.getByRole('link', { name: 'Prospectos' }).click();
  await rec.getByRole('button', { name: 'Nuevo prospecto' }).first().click();
  d = rec.getByRole('dialog');
  await d.getByLabel('Nombre').fill(`Mariana${letras}`);
  await d.getByLabel('Apellidos').fill('Prospecto');
  await d.getByLabel('Celular').fill(celular());
  await d.getByRole('button', { name: 'Registrar' }).click();
  await rec.getByText(`Mariana${letras} Prospecto`).waitFor({ timeout: T.respuesta });
  const fila = rec.getByRole('row', { name: new RegExp(`Mariana${letras}`) });
  // La etapa ya no se elige en un `select` (bloque 2.4): sale del contacto. Hablar en persona lo pasa a «Visitó».
  await fila.getByRole('button', { name: 'Contactar' }).click();
  d = rec.getByRole('dialog');
  await d.getByRole('radio', { name: 'En persona' }).click();
  await d.getByRole('radio', { name: 'Le interesa', exact: true }).click();
  await d.getByRole('button', { name: 'Mañana' }).click();
  await accion(rec, () => d.getByRole('button', { name: 'Registrar contacto' }).click(), /\/api\/prospects\/[^/]+\/follow-ups$/, { metodo: 'POST', que: 'el contacto con el prospecto' });
  await d.waitFor({ state: 'hidden', timeout: T.ui });
  r.ok(await aparece(fila.getByText('Visitó', { exact: true }), T.respuesta), 'el contacto en persona lo pasa a «Visitó», sin elegir la etapa a mano');
  await shot(rec, '5-prospectos');
  await fila.getByRole('button', { name: 'Inscribir' }).click();
  d = rec.getByRole('dialog');
  r.ok((await d.locator('#sf-ph').inputValue()).length === 10, 'la inscripción trae el celular del prospecto');
  await d.getByRole('button', { name: 'Leer texto' }).first().waitFor({ timeout: T.respuesta });
  for (const c of await d.getByRole('switch').all()) await c.check();
  await d.getByRole('button', { name: 'Dar de alta' }).click();
  await rec.waitForURL('**/socios/**', { timeout: T.respuesta });
  r.ok(true, 'el prospecto se inscribe y pasa a su ficha');
  const fichaUrl = rec.url().split('?')[0];
  await rec.getByRole('dialog').waitFor({ timeout: T.respuesta });
  await rec.keyboard.press('Escape');

  // 6. Retención: la ve la gerencia (recepción solo si el dueño se la libera, 2026-10-06).
  r.paso('retención');
  await abrirMenu(rec);
  r.ok(await rec.locator('.side-nav').getByRole('link', { name: 'Retención', exact: true }).count() === 0, 'recepción no ve Retención por su puesto');
  await irPorMenu(own, 'Retención');
  await own.getByRole('heading', { name: 'A quién llamar' }).waitFor();
  await own.locator('.list-item').first().waitFor({ timeout: T.respuesta });
  r.ok(await own.locator('.list-item').count() > 0, 'retención lista a quién llamar');
  await shot(own, '6-retencion');

  // 7. Correcciones: la gerencia vende en efectivo y lo revierte con autorización.
  // Con dos turnos abiertos en la sede (lo normal con dos cajas), revertir un
  // cobro en efectivo tiene que dejar elegir de qué caja sale el dinero, como
  // el cobro deja elegir en cuál entra. Ese caso se asegura con una caja y un
  // turno propios de la corrida, que se cierran al terminar.
  r.paso('revertir un cobro');
  const cen = (await g.get('/branches')).find((b) => b.code === 'CEN');
  const abiertas = (await g.get(`/cash-sessions?branchId=${cen.id}&status=OPEN`)).sessions;
  if (abiertas.length < 2) {
    const registros = (await g.get(`/cash-registers?branchId=${cen.id}`)).registers;
    let libre = registros.find((c) => c.isActive && !abiertas.some((x) => x.cashRegisterId === c.id));
    const propia = libre ? null : await g.post('/cash-registers', { branchId: cen.id, code: `CP${letras}`.slice(0, 8), name: `Caja de prueba ${letras}` });
    libre ??= propia;
    const turno = await g.post('/cash-sessions', { cashRegisterId: libre.id, openingFloatCents: '0' });
    r.alFinal(async () => {
      await g.post(`/cash-sessions/${turno.id}/close`, { countedCashCents: '0', varianceReason: 'Turno de un recorrido de prueba' });
      if (propia) await g.patch(`/cash-registers/${propia.id}`, { isActive: false });
    });
  }
  await own.goto(fichaUrl, { waitUntil: 'networkidle' });
  await own.getByRole('button', { name: 'Vender membresía' }).first().click();
  await own.getByRole('dialog').getByText('Mensualidad', { exact: true }).click();
  await own.getByRole('dialog').getByRole('button', { name: 'Continuar' }).click();
  await own.getByRole('dialog').getByText('Total').waitFor({ timeout: T.respuesta });
  await asentado(own);
  await elegirCaja(own.getByRole('dialog'));
  await own.getByRole('dialog').getByRole('button', { name: /^Cobrar/ }).click();
  await own.getByText(/ya puede entrar/).waitFor({ timeout: T.respuesta });
  await own.getByRole('button', { name: 'Listo' }).click();
  await own.getByRole('tab', { name: /Estado de cuenta/ }).click();
  // Fase 2.2: «Revertir» y «Reembolsar» son un solo diálogo, «Devolver dinero».
  await own.getByRole('button', { name: 'Devolver', exact: true }).first().click();
  d = own.getByRole('dialog');
  await d.getByLabel('Motivo').fill('Se cobró al socio equivocado');
  // Lo correcto: si hay varias cajas abiertas, el diálogo pide elegir de cuál sale.
  const pideCaja = await elegirCaja(d);
  await d.getByRole('button', { name: 'Pedir autorización' }).click();
  d = own.getByRole('dialog');
  // 2.10 (20-14): con una sola persona que firma, ya está elegida; no se teclea su correo.
  await d.getByText(/^Firma: /).waitFor();
  await d.getByLabel('Su contraseña').fill(CLAVE_PRUEBAS);
  const reversa = respuesta(own, /\/api\/payments\/[^/]+\/reverse$/, { metodo: 'POST', que: 'la reversa' });
  await d.getByRole('button', { name: 'Autorizar' }).click();
  const rr = await reversa;
  if (rr.status() >= 400) {
    const motivo = await rr.json().then((j) => j.message ?? '', () => '');
    await r.captura(own, 'b4-7-reversa-sin-caja', { red: false });
    r.ok(false, `con dos turnos abiertos en la sede, «Revertir» un cobro en efectivo ${pideCaja ? 'pidió la caja y aun así' : 'no deja elegir la caja y'} la API responde ${rr.status()}: «${motivo}» (DEFECTO, ver 1.17a-recorridos.md)`);
    return;
  }
  await own.getByText(/Pago revertido/).waitFor({ timeout: T.respuesta });
  await asentado(own);
  r.ok(await own.getByText('Reversa').count() > 0, 'la reversa aparece en el estado de cuenta');
  await shot(own, '7-reversa');
  await own.getByRole('tab', { name: /Resumen/ }).click();
  await asentado(own);
  r.ok(await own.getByText(/En gracia|Pago pendiente|mora/i).count() > 0, 'la membresía que pagó ese cobro vuelve a deber');
});
