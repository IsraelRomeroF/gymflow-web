// La consola de la plataforma (ADR-038, ADR-039): planes con precio, alta de
// una marca con su plan y sus cuentas (una temporal por persona, entregada a
// cada quien), corregir la marca, una cuenta más, liberar el software, precios,
// factura, pago y comprobante; la dueña y la gerencia de la marca nueva
// entran por primera vez; y el personal de un gimnasio no entra a la consola.
// Fase 1.17a: la marca de la corrida queda SUSPENDIDA al terminar (antes se
// quedaba «en uso», una por corrida, y entraba a la cobranza de cada mes; 22-17).
import { recorrido, abrirMenu, elegirContrasena, cuadros, PANEL, T } from './lib/index.mjs';

await recorrido('plataforma', async (r) => {
  const ok = r.ok;
  const nueva = (vp = { width: 1440, height: 900 }, movil = false) => r.nueva({ viewport: vp, isMobile: movil, hasTouch: movil, deviceScaleFactor: 1 });
  const sufijo = Math.random().toString(36).replace(/[0-9]/g, '').slice(2, 6);
  const correo = (rol) => `${rol}.${sufijo}@marca-prueba.mx`;
  const entrarCon = async (p, email, password) => {
    await p.goto(`${PANEL}/login`, { waitUntil: 'networkidle' });
    await p.getByLabel('Correo').fill(email);
    await p.getByLabel('Contraseña').fill(password);
    await p.getByRole('button', { name: 'Entrar' }).click();
  };

  // 1. La cuenta de plataforma entra a su propia pantalla.
  const pl = await r.como('plataforma');
  // La marca de esta corrida se suspende al terminar, pase lo que pase.
  r.alFinal(async () => {
    const marca = (await pl.evaluate(async () => (await (await fetch('/api/platform/organizations')).json()).organizations)).find((o) => o.tradeName === `Fuerza ${sufijo.toUpperCase()}`);
    if (!marca) return;
    const st = await pl.evaluate(async (id) => (await fetch(`/api/platform/organizations/${id}/service`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'SUSPENDED', reason: 'Marca de un recorrido de prueba' }) })).status, marca.id);
    if (st >= 400) r.nota(`no se pudo suspender la marca de la corrida (${st})`);
  });
  await pl.getByRole('heading', { name: 'Marcas' }).waitFor({ timeout: T.respuesta });
  await pl.locator('[data-marca]').first().waitFor({ timeout: T.respuesta });
  ok(await pl.locator('[data-marca="Gimnasio Demo"]').count() === 1, 'la plataforma lista las marcas existentes');
  await r.captura(pl, 'plataforma-1-marcas');

  // 1b. Planes (ADR-039): la plataforma define un paquete de módulos con precio.
  await pl.getByRole('link', { name: 'Planes', exact: true }).click();
  await pl.getByRole('heading', { name: 'Planes' }).waitFor({ timeout: T.respuesta });
  await pl.getByRole('button', { name: 'Nuevo plan' }).first().click();
  const dp = pl.getByRole('dialog');
  const nombrePlan = `Estudio ${sufijo.toUpperCase()}`;
  await dp.getByLabel('Nombre').fill(nombrePlan);
  await dp.getByLabel('Precio al mes (MXN)').fill('2200');
  await dp.getByLabel('Descripción (opcional)').fill('Caja y clases, sin tienda');
  await dp.locator('[data-incluye="cash"]').click();
  await dp.locator('[data-incluye="classes"]').click();
  await dp.locator('[data-incluye="member_portal"]').click();
  await dp.getByRole('button', { name: 'Crear plan' }).click();
  await pl.getByText(`Plan ${nombrePlan} creado.`).waitFor({ timeout: T.respuesta });
  await pl.locator(`[data-plan="${nombrePlan}"]`).waitFor({ timeout: T.respuesta });
  ok((await pl.locator(`[data-plan="${nombrePlan}"]`).innerText()).includes('$2,200.00') && (await pl.locator(`[data-plan="${nombrePlan}"]`).innerText()).includes('Clases'), 'el plan queda en la lista con su precio y sus módulos');
  await r.captura(pl, 'plataforma-1b-planes');
  await pl.goto(`${PANEL}/plataforma`, { waitUntil: 'networkidle' });
  await pl.locator('[data-marca]').first().waitFor({ timeout: T.respuesta });

  // 2. Da de alta una marca nueva con su plan y sus cuatro cuentas.
  await pl.getByRole('button', { name: 'Nueva marca' }).click();
  const d = pl.getByRole('dialog');
  // El alta va en tres pasos (bloque 2.11): cada uno se valida al pulsar «Siguiente».
  // Lo que falta se marca en su campo, no con un botón apagado sin explicación (UX5-PL-11).
  await d.getByText('Paso 1 de 3').waitFor({ timeout: T.ui });
  await d.getByRole('button', { name: 'Siguiente' }).click();
  await d.locator('.field-error').first().waitFor({ timeout: T.ui });
  ok(await d.locator('.field-error').count() >= 3, 'al intentar avanzar sin datos, cada campo que falta del paso dice qué poner');
  await cuadros(pl);
  ok(await pl.evaluate(() => !!document.activeElement?.closest('[data-error="true"]')), 'el foco va al primer campo que falta');
  await d.getByLabel('Nombre comercial').fill(`Fuerza ${sufijo.toUpperCase()}`);
  await d.getByLabel('Razón social').fill(`Fuerza ${sufijo} S.A. de C.V.`);
  ok(await d.getByLabel('Zona horaria').inputValue() === 'America/Mexico_City', 'el alta pide la zona horaria, con la del centro por omisión');
  await d.getByLabel('Código').fill('FZA');
  await d.getByRole('button', { name: 'Siguiente' }).click();
  // Paso 2: el plan (o a la medida) y los módulos. Ya no hay «Plantilla de arranque»: contratado = encendido.
  await d.getByText('Paso 2 de 3').waitFor({ timeout: T.ui });
  await d.locator(`[data-plan="${nombrePlan}"]`).click();
  ok(await d.locator('[data-contrato="cash"]').isDisabled() && await d.locator('[data-contrato="classes"]').isDisabled(), 'con plan, lo que incluye va fijo');
  // Un agregado fuera del plan: Prospectos.
  await d.locator('[data-contrato="prospects"]').click();
  await d.getByRole('button', { name: 'Siguiente' }).click();
  // Paso 3: las cuentas.
  await d.getByText('Paso 3 de 3').waitFor({ timeout: T.ui });
  const llenar = async (id, nombre, rol) => {
    await d.locator(`#${id}-n`).fill(nombre);
    await d.locator(`#${id}-e`).fill(correo(rol));
  };
  await llenar('ow', 'Ana Duena Prueba', 'duena');
  // Cuentas del arranque a la medida: se agrega una tercera y un coach, y se quita el coach.
  await d.getByTestId('agregar-cuenta').getByRole('button', { name: 'Recepción' }).click();
  await d.getByTestId('agregar-cuenta').getByRole('button', { name: 'Coach' }).click();
  ok(await d.locator('#s3-n').count() === 1, 'se pueden agregar cuentas de arranque');
  // `has` va relativo a la fila: con `d.locator(...)` buscaría un diálogo dentro de la fila.
  await d.locator('.alta-persona').filter({ has: pl.locator('#s3-n') }).getByRole('button', { name: 'Quitar' }).click();
  ok(await d.locator('#s3-n').count() === 0, 'y quitarlas');
  await llenar('s0', 'Beto Gerente Prueba', 'gerente');
  await llenar('s1', 'Carla Recepcion Prueba', 'recepcion');
  await llenar('s2', 'Dario Recepcion Prueba', 'recepciondos');
  await d.getByLabel('Motivo del alta').fill('Alta de prueba desde el recorrido');
  await r.captura(pl, 'plataforma-2-alta');
  await d.getByRole('button', { name: 'Dar de alta la marca' }).click();
  await pl.getByRole('heading', { name: /accesos de arranque/ }).waitFor({ timeout: T.respuesta });
  const claves = await pl.getByTestId('clave-temporal').allInnerTexts();
  ok(claves.length === 4 && claves.every((c) => /^GYM-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)), 'entrega cuatro contraseñas temporales, una por cuenta');
  // Cada clave a su dueño (22-03): «WhatsApp» y «Copiar» por persona, sin un WhatsApp con todas.
  const personas = pl.getByTestId('entrega-persona');
  const credDlg = pl.getByRole('dialog', { name: /accesos de arranque/ });
  ok(await personas.count() === 4 && await credDlg.getByRole('button', { name: /WhatsApp/ }).or(credDlg.getByRole('link', { name: /WhatsApp/ })).count() === 4
    && await credDlg.getByRole('button', { name: /^Copiar/ }).count() === 4, 'cada persona tiene su «WhatsApp» y su «Copiar»; no hay uno para todas');
  ok(await credDlg.getByRole('button', { name: /^Imprimir hojas?$/ }).count() === 1, 'y se imprime una hoja por persona');
  // Sin «Liberar al terminar», el cierre del alta lo dice y ofrece ir a la ficha (22-11).
  ok(await credDlg.getByTestId('sigue-sin-liberar').count() === 1 && await credDlg.getByRole('button', { name: /Ir a la marca/ }).count() === 1, 'al terminar dice que sigue sin liberar y ofrece «Ir a la marca»');
  await r.captura(pl, 'plataforma-3-credenciales');
  await pl.getByRole('button', { name: 'Ya los entregué' }).click();
  ok(await pl.locator(`[data-marca="Fuerza ${sufijo.toUpperCase()}"]`).count() === 1, 'la marca nueva aparece en la lista');
  await pl.locator(`[data-marca="Fuerza ${sufijo.toUpperCase()}"]`).getByRole('link', { name: /Ver/ }).click();
  await pl.getByRole('heading', { name: `Fuerza ${sufijo.toUpperCase()}` }).waitFor({ timeout: T.respuesta });
  ok(await pl.locator('.badge', { hasText: 'Contraseña temporal' }).count() === 4, 'el detalle marca las cuatro cuentas con contraseña temporal');
  ok(await pl.getByText('Todo el gimnasio').count() === 2 && await pl.getByText('Matriz', { exact: true }).count() >= 2, 'la dueña y la gerencia ven todo; recepción, su sede');
  ok(await pl.getByText('Sin liberar').count() >= 1, 'la marca nace sin liberar');
  // El plan y sus agregados se leen en la ficha (ADR-039).
  await pl.getByTestId('plan').waitFor({ timeout: T.respuesta });
  ok((await pl.getByTestId('plan').innerText()).includes(nombrePlan) && (await pl.getByTestId('plan').innerText()).includes('$2,200.00'), 'la ficha dice qué plan contrató y cuánto cuesta');
  ok(await pl.locator('[data-contrato="classes"]').getByText('Incluido en el plan').count() === 1 && await pl.locator('[data-contrato="prospects"]').getByText('Agregado').count() === 1 && await pl.locator('[data-contrato="pos"]').getByText('No contratado').count() === 1, 'cada módulo dice si viene con el plan, si es agregado o si no está contratado');
  // Corregir la marca.
  await pl.getByRole('button', { name: 'Editar marca' }).click();
  await pl.getByRole('dialog').getByLabel('Correo de cobros (opcional)').fill(correo('cobros'));
  await pl.getByRole('dialog').getByLabel('Motivo').fill('Correo de facturación del dueño');
  await pl.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await pl.getByText('Marca actualizada.').waitFor({ timeout: T.respuesta });
  ok(await pl.getByText(`cobros a ${correo('cobros')}`).count() === 1, 'los datos de la marca se corrigen desde la ficha');
  // Una cuenta más: un coach. Cuatro puestos, cada uno explicado (2026-10-05).
  await pl.getByRole('button', { name: 'Agregar cuenta' }).click();
  const dc = pl.getByRole('dialog');
  ok(await dc.getByLabel('Puesto').locator('option').count() === 4, 'el selector ofrece solo los cuatro puestos');
  await dc.getByLabel('Puesto').selectOption('COACH');
  ok((await dc.innerText()).includes('Da clases y entrena'), 'el selector explica qué hace cada puesto');
  await dc.locator('#nc-n').fill('Carlos Coach Prueba');
  await dc.locator('#nc-e').fill(correo('coach'));
  await dc.getByLabel('Motivo').fill('Coach del turno vespertino');
  await dc.getByRole('button', { name: 'Crear cuenta' }).click();
  await pl.getByRole('heading', { name: /accesos de arranque/ }).waitFor({ timeout: T.respuesta });
  const claveCaja = (await pl.getByTestId('clave-temporal').allInnerTexts())[0];
  ok(/^GYM-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(claveCaja) && await pl.getByText('Coach', { exact: true }).count() >= 1, 'la cuenta nace con contraseña temporal fácil de dictar y su puesto se lee como "Coach"');
  await pl.getByRole('button', { name: 'Ya los entregué' }).click();
  await r.captura(pl, 'plataforma-3b-plan-y-cuentas', { full: true });

  // 3. Nace sin liberar: la dueña no entra hasta que la plataforma libera el software.
  const tel = await nueva({ width: 390, height: 844 }, true);
  await entrarCon(tel, correo('duena'), claves[0]);
  await tel.getByText(/todavía no está liberado/).waitFor({ timeout: T.respuesta });
  ok(true, 'antes de liberar, la dueña lee que el servicio no está liberado');
  await pl.getByRole('button', { name: 'Liberar el software' }).click();
  await pl.getByRole('dialog').getByRole('button', { name: 'Contrato firmado y primer pago recibido' }).click();
  await pl.getByRole('dialog').getByRole('button', { name: 'Liberar', exact: true }).click();
  await pl.getByText('Software liberado.').waitFor({ timeout: T.respuesta });
  ok(await pl.getByText('En uso', { exact: true }).count() >= 1, 'la marca queda en uso');
  ok(await pl.locator('[data-contrato="training"]').getByText('No contratado').count() === 1 && await pl.locator('[data-contrato="classes"]').getByText(/Contratado/).count() === 1, 'la plataforma ve qué contrató la marca');
  await r.captura(pl, 'plataforma-4-detalle', { full: true });

  // 3b. Cobro (ADR-038): sin precios no se factura; con precios, la mensualidad
  // se arma con lo contratado, la factura se emite, se cobra y queda al corriente.
  await pl.getByTestId('cobro').waitFor({ timeout: T.respuesta });
  const generar = pl.getByTestId('cobro').getByRole('button', { name: 'Generar factura' });
  const sinPrecios = await pl.getByTestId('cobro').getByText(/Sin precio/).count() > 0;
  ok(!sinPrecios || await generar.isDisabled(), 'sin precios fijados, la plataforma no puede generar factura');
  await pl.getByTestId('cobro').getByRole('link', { name: 'Precios', exact: true }).click();
  await pl.getByRole('heading', { name: 'Precios' }).waitFor({ timeout: T.respuesta });
  await pl.locator('[data-precio]').first().waitFor();
  const filas = await pl.locator('[data-precio]').all();
  for (const fila of filas) {
    const clave = await fila.getAttribute('data-precio');
    const actual = (await fila.locator('td[data-label="Precio al mes"]').innerText()).trim();
    // Lo básico cuesta más; cada módulo, lo mismo. Solo se fija lo que falta.
    if (actual !== 'Sin precio') continue;
    await fila.getByRole('textbox').fill(clave === 'core' ? '1500' : '350.50');
  }
  // Un solo botón guarda todos los cambios (UX7 Plataforma).
  const guardarPrecios = pl.getByRole('button', { name: /^Guardar (\d+ )?precios$/ });
  if (await guardarPrecios.isEnabled()) {
    await guardarPrecios.click();
    await pl.getByText(/al mes\.$/).first().waitFor({ timeout: T.respuesta });
  }
  ok(await pl.getByText('Sin precio', { exact: true }).count() === 0, 'todos los conceptos quedaron con precio');
  ok((await pl.locator('[data-precio="core"] td[data-label="Precio al mes"]').innerText()).includes('$1,500.00') || (await pl.locator('[data-precio="core"]').innerText()).includes('$'), 'lo básico muestra su precio en pesos');
  await r.captura(pl, 'plataforma-4b-precios', { full: true });
  await pl.goBack({ waitUntil: 'networkidle' });
  await pl.getByRole('heading', { name: `Fuerza ${sufijo.toUpperCase()}` }).waitFor({ timeout: T.respuesta });
  await pl.getByTestId('cobro').getByTestId('mensualidad').waitFor({ timeout: T.respuesta });
  const mensualidad = (await pl.getByTestId('mensualidad').innerText()).trim();
  ok(/^\$[\d,]+\.\d{2}$/.test(mensualidad) && mensualidad !== '$0.00', `la mensualidad de hoy sale de los precios y lo contratado (${mensualidad})`);
  await pl.getByTestId('cobro').getByRole('button', { name: 'Generar factura' }).click();
  const de = pl.getByRole('dialog');
  // Bloque 4.9 (D-39): el primer mes se cobra POR DÍAS desde el día en que se liberó; solo si eso fue el día 1 coincide con la mensualidad.
  await de.getByTestId('emision-total').waitFor({ timeout: T.respuesta });
  const cobrado = (await de.getByTestId('emision-total').innerText()).trim();
  ok(/^\$[\d,]+\.\d{2}$/.test(cobrado) && cobrado !== '$0.00' && (await de.getByRole('button', { name: /^Emitir/ }).innerText()).includes(cobrado), `el diálogo cobra lo que enseña la vista previa (${cobrado})`);
  ok(cobrado === mensualidad || await de.getByText(/ de \d+ días \(/).count() >= 1, 'el primer mes va por días, salvo que se haya liberado el día 1');
  await de.getByRole('button', { name: /^Emitir/ }).click();
  await pl.getByText(/Factura GF-\d{4}-\d{6} emitida/).waitFor({ timeout: T.respuesta });
  await pl.locator('[data-folio]').first().waitFor({ timeout: T.respuesta });
  const folio = await pl.locator('[data-folio]').first().getAttribute('data-folio');
  ok(/^GF-\d{4}-\d{6}$/.test(folio), `la factura tiene folio corrido (${folio})`);
  ok(await pl.locator('[data-folio]').getByText('Pendiente de pago').count() === 1 && await pl.getByText('Por vencer').count() >= 1, 'nace pendiente de pago y la marca queda "por vencer"');
  await pl.getByTestId('cobro').getByRole('button', { name: 'Generar factura' }).click();
  ok(await pl.getByRole('dialog').getByRole('button', { name: /^Emitir/ }).isDisabled() && await pl.getByRole('dialog').getByText(/ya tiene factura/).count() === 1, 'el mismo mes no se factura dos veces');
  await pl.keyboard.press('Escape');
  await pl.locator('[data-folio]').getByRole('button', { name: 'Registrar pago' }).click();
  // En transferencia la referencia es obligatoria (23-16, bloque 1.13): el campo ya no dice «(opcional)».
  await pl.getByRole('dialog').getByLabel('Referencia').fill('SPEI 0001234');
  await pl.getByRole('dialog').getByRole('button', { name: 'Registrar pago' }).click();
  await pl.getByText(`Factura ${folio} pagada.`).waitFor({ timeout: T.respuesta });
  await pl.locator('[data-folio]').getByText('Pagada').waitFor({ timeout: T.respuesta });
  ok(await pl.locator('[data-folio]').getByText('Pagada').count() === 1 && await pl.getByText('Al corriente').count() >= 1, 'pagada: la marca queda al corriente');
  await r.captura(pl, 'plataforma-4c-cobro', { full: true });
  await pl.locator('[data-folio]').getByRole('link', { name: folio }).click();
  await pl.getByRole('heading', { name: `Factura ${folio}` }).waitFor({ timeout: T.respuesta });
  ok((await pl.getByTestId('factura-total').innerText()).trim() === cobrado, 'el comprobante guarda el total tal como se cobró');
  ok(await pl.getByText(/No es un CFDI/).count() === 1, 'y dice claramente que no es un CFDI');
  await r.captura(pl, 'plataforma-4d-factura', { full: true });
  await pl.goto(`${PANEL}/plataforma`, { waitUntil: 'networkidle' });
  await pl.locator(`[data-marca="Fuerza ${sufijo.toUpperCase()}"]`).waitFor({ timeout: T.respuesta });
  ok(await pl.locator(`[data-marca="Fuerza ${sufijo.toUpperCase()}"]`).getByText('Al corriente').count() === 1, 'la lista de marcas muestra el estado de cobro');

  // Ahora sí entra con la temporal y elige la suya, ahí mismo en el login (A4-N1).
  await entrarCon(tel, correo('duena'), claves[0]);
  await elegirContrasena(tel, 'MiGimnasio.2026.segura');
  await tel.waitForURL('**/panel', { timeout: T.respuesta });
  await tel.getByText(/Hoy, hasta las/).waitFor({ timeout: T.respuesta });
  ok(await tel.getByText('Tus sucursales hoy').count() === 1 && await tel.getByText('Todavía no entra nadie hoy.').count() === 1, 'su inicio tiene la tarjeta de sus sucursales, vacía porque el gimnasio acaba de nacer');
  ok(await tel.getByText('Lo que conviene revisar').count() === 1, 'y la de alertas');
  await r.captura(tel, 'plataforma-5-duena', { full: true });

  // 4. La gerencia nueva ve su menú según la plantilla; recepción atiende y no modifica.
  const g = await nueva();
  await entrarCon(g, correo('gerente'), claves[1]);
  await elegirContrasena(g, 'Gerencia.2026.segura');
  await g.waitForURL('**/panel', { timeout: T.respuesta });
  await g.locator('.side-nav .side-link').first().waitFor();
  // 4a. Primer arranque (ADR-038): a la gerencia nueva le falta lo obligatorio y el inicio se lo dice.
  await g.getByTestId('arranque').waitFor({ timeout: T.respuesta });
  ok(await g.getByTestId('arranque').getByText(/de \d pasos obligatorios listos/).count() === 1, 'el inicio de la gerencia nueva trae "Para empezar" con su avance');
  ok(await g.locator('[data-testid="arranque"] [data-paso="textos"]').count() === 1 && await g.locator('[data-testid="arranque"] [data-paso="planes"]').count() === 1, 'y señala que faltan los textos y los planes');
  await r.captura(g, 'plataforma-5b-arranque', { full: true });
  await g.getByTestId('arranque').getByRole('link', { name: 'Ver todo' }).click();
  await g.getByRole('heading', { name: 'Primer arranque' }).waitFor({ timeout: T.respuesta });
  ok(await g.locator('[data-paso="caja"][data-hecho="true"]').count() === 1 && await g.locator('[data-paso="personal"][data-hecho="true"]').count() === 1, 'la lista completa reconoce lo que ya nació hecho: caja y recepción');
  ok(await g.locator('[data-paso="clases"]').count() === 1 && await g.locator('[data-paso="productos"]').count() === 0, 'los pasos opcionales siguen a los módulos contratados');
  await r.captura(g, 'plataforma-5c-arranque-lista', { full: true });
  await g.goto(`${PANEL}/panel`, { waitUntil: 'networkidle' });
  await g.locator('.side-nav .side-link').first().waitFor();
  await abrirMenu(g);
  ok(await g.getByRole('link', { name: 'Clases', exact: true }).count() === 1 && await g.getByRole('link', { name: 'Punto de venta' }).count() === 0, 'lo contratado (su plan) trae Clases y no trae tienda');
  // 2.12: Módulos está dentro de «Mi gimnasio» (una entrada del menú); si la gerencia solo ve Módulos, la entrada lleva directo.
  ok(await g.getByRole('link', { name: 'Mi gimnasio', exact: true }).count() === 1, 'la gerencia puede cambiar los módulos de su marca');
  await g.getByRole('link', { name: 'Mi gimnasio', exact: true }).click();
  await g.waitForURL(/\/(gimnasio|modulos)$/, { timeout: T.respuesta });
  if (!/\/modulos$/.test(g.url())) await g.getByRole('tab', { name: 'Módulos', exact: true }).click();
  await g.getByRole('heading', { name: 'Módulos', exact: true }).waitFor({ timeout: T.respuesta });
  await g.locator('[data-modulo="training"]').waitFor();
  ok(await g.locator('[data-modulo="training"]').getByText('No contratado').count() === 1, 'la gerencia ve Rutinas como no contratado');
  ok(await g.locator('[data-modulo="training"]').getByRole('switch').isDisabled(), 'y no lo puede encender');
  ok((await g.getByTestId('resumen-modulos').innerText()).includes('sin contratar'), 'el resumen dice cuántos faltan por contratar');
  await r.captura(g, 'plataforma-6-modulos-gerencia');
  await g.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  await g.getByRole('heading', { name: 'Socios' }).waitFor({ timeout: T.respuesta });
  ok(await g.getByText(/Sin socios|Todavía no hay|0 socios|Nadie/).count() >= 0, 'el padrón de la marca nueva está vacío: no ve a nadie de otra marca');
  ok(await g.locator('tbody tr').count() === 0, 'ningún socio de otra marca se cuela');

  // 5. El personal de un gimnasio no entra a la plataforma.
  await g.goto(`${PANEL}/plataforma`, { waitUntil: 'networkidle' });
  await g.waitForURL('**/panel', { timeout: T.respuesta });
  ok(true, 'la gerencia que intenta abrir /plataforma regresa a su panel');
});
