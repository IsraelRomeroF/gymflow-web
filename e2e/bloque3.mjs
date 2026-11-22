// Mostrador, venta, caja, clases, rutinas y alta digital de punta a punta
// (bloque 3): recepción registra entradas, cobra a un suspendido, da de alta y
// vende; el gerente retira efectivo con la firma de la dueña; recepción
// inscribe a clases; el coach arma y asigna una rutina que el socio ve en su
// teléfono; y un alta digital de alguien que ya es socio se vincula a su ficha.
//
// Datos propios (fase 1.17a): el socio al corriente, el suspendido con deuda y
// la clase son de esta corrida (lib/datos.mjs). Antes tomaba los primeros de
// la semilla y una sesión cualquiera: después de `clases` no quedaban sesiones
// que inscribir, su socio ya estaba inscrito de la corrida anterior, y había
// que regenerar la base. Al terminar retira su clase (con sus reservas), le
// quita el coach a su socio y archiva su rutina.
import {
  recorrido, socioAlCorriente, socioSuspendido, crearClase, retirarClase, letras, celular,
  motivoDeExcepcion, invitacionPortal, elegirCaja, accion, asentado, aparece, PANEL, PORTAL, T, CLAVE_PRUEBAS,
} from './lib/index.mjs';

await recorrido('bloque3', async (r) => {
  const g = await r.api('gerencia');
  const activo = await socioAlCorriente(g, { sede: 'CEN' });
  const deudor = await socioSuspendido(g, { sede: 'CEN', mesesAtras: 0 });
  const clase = await crearClase(g, { sede: 'CEN', nombre: `Funcional ${letras(4)}`, dias: [1, 2], hora: '20:00' });
  r.alFinal(() => retirarClase(g, clase.tipo));
  r.alFinal(() => g.put(`/members/${activo.id}/coach`, { coachUserId: null }));
  r.ok(!!activo && !!deudor, `hay un socio al corriente (${activo.firstName}) y uno suspendido con deuda (${deudor.firstName}), de esta corrida`);
  const shot = (p, n) => r.captura(p, `b3-${n}`);
  const fila = (p, texto) => p.locator('li.sesion-fila').filter({ hasText: texto });

  // 1. Entrada desde Recepción: al corriente pasa.
  r.paso('entrada del socio al corriente');
  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  await rec.locator('input.input-lg').fill(activo.memberCode);
  await rec.getByRole('button', { name: 'Entrada' }).first().click();
  await motivoDeExcepcion(rec);
  await rec.getByText(`${activo.firstName} puede pasar`).waitFor({ timeout: T.respuesta });
  r.ok(true, 'registrar entrada: el socio al corriente puede pasar');
  await shot(rec, '1-entrada-ok');
  // El verde se cierra solo (UX5-M-01): sin clic en "Listo".
  await rec.getByRole('dialog').waitFor({ state: 'hidden', timeout: T.ui });
  r.ok(true, 'la entrada verde se cierra sola y el buscador queda listo');

  // 2. Suspendido con deuda: no pasa, y se le puede cobrar y abrir.
  r.paso('cobrar y abrir al suspendido');
  await rec.locator('input.input-lg').fill(deudor.memberCode);
  await rec.getByRole('button', { name: 'Entrada' }).first().click();
  await motivoDeExcepcion(rec);
  await rec.getByText('No puede pasar').waitFor({ timeout: T.respuesta });
  r.ok(await rec.getByRole('button', { name: /^Cobrar .* y abrir$/ }).count() > 0, 'suspendido: ofrece cobrar y abrir');
  await shot(rec, '2-entrada-negada');
  await rec.getByRole('button', { name: /^Cobrar .* y abrir$/ }).click();
  await rec.getByRole('dialog').getByText('Efectivo', { exact: true }).click();
  await asentado(rec);
  await elegirCaja(rec.getByRole('dialog'));
  await rec.getByRole('button', { name: /Cobrar .*y dejar pasar/ }).click();
  await rec.getByText(/Puede pasar\./).waitFor({ timeout: T.respuesta });
  r.ok(true, 'cobrar y dejar pasar resuelve el rechazo en el mostrador');
  await rec.getByRole('button', { name: 'Listo' }).click();

  // 3. Nuevo socio desde una búsqueda sin resultados.
  r.paso('alta desde la búsqueda');
  const nombre = `Rodrigo Q${letras(4).toLowerCase()}`;
  await rec.locator('input.input-lg').fill(nombre);
  await rec.getByRole('button', { name: new RegExp(`Registrar a «${nombre}»`) }).first().click();
  const dlg = rec.getByRole('dialog');
  r.ok((await dlg.locator('#sf-fn').inputValue()) === 'Rodrigo', 'el alta arranca con el nombre que se buscó');
  await dlg.locator('#sf-ph').fill(celular());
  await dlg.locator('#sf-en').fill('Ana Q');
  await dlg.getByRole('button', { name: 'Leer texto' }).first().click();
  r.ok(await dlg.locator('.doc-texto').count() > 0, 'el texto del aviso se puede leer completo');
  for (const c of await dlg.getByRole('switch').all()) await c.check();
  await shot(rec, '3-nuevo-socio');
  await dlg.getByRole('button', { name: 'Dar de alta' }).click();
  await rec.waitForURL('**/socios/**', { timeout: T.respuesta });
  await rec.getByRole('dialog').getByText('Mensualidad', { exact: true }).waitFor({ timeout: T.respuesta });
  r.ok(true, 'tras el alta se abre la venta de membresía');
  await rec.keyboard.press('Escape');
  await rec.waitForURL((u) => !u.search.includes('vender=1'), { timeout: T.ui }).catch(() => undefined);
  r.ok(!rec.url().includes('vender=1'), 'la dirección ya no lleva ?vender=1 (recargar no reabre la venta)');

  // 4. Editar datos desde la ficha: es de la gerencia; recepción atiende y consulta.
  r.paso('editar datos');
  await rec.getByRole('button', { name: 'Más' }).click();
  r.ok(await rec.getByRole('menuitem', { name: 'Editar datos' }).count() === 0, 'recepción no edita la ficha');
  await rec.keyboard.press('Escape');
  const ger = await r.como('gerencia');
  await ger.goto(rec.url().split('?')[0], { waitUntil: 'networkidle' });
  await ger.getByRole('button', { name: 'Más' }).click();
  await ger.getByRole('menuitem', { name: 'Editar datos' }).click();
  await ger.getByRole('dialog').locator('#sf-en').fill('Ana Quintero');
  await ger.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await ger.getByText('Ana Quintero').waitFor({ timeout: T.respuesta });
  r.ok(true, 'la gerencia edita y el contacto de emergencia cambia en la ficha');
  await ger.close();
  await rec.reload({ waitUntil: 'networkidle' });
  await rec.getByText('Ana Quintero').waitFor({ timeout: T.respuesta });
  await shot(rec, '4-ficha-acciones');

  // 5. Venta con cobro → comprobante.
  r.paso('venta con comprobante');
  await rec.getByRole('button', { name: 'Vender membresía' }).first().click();
  await rec.getByRole('dialog').getByText('Mensualidad', { exact: true }).click();
  await rec.getByRole('dialog').getByRole('button', { name: 'Continuar' }).click();
  await rec.getByRole('dialog').getByText('Total').waitFor({ timeout: T.respuesta });
  await asentado(rec);
  await elegirCaja(rec.getByRole('dialog'));
  await rec.getByRole('dialog').getByRole('button', { name: /^Cobrar/ }).click();
  await rec.getByText(/ya puede entrar/).waitFor({ timeout: T.respuesta });
  const hrefRecibo = await rec.getByRole('link', { name: 'Comprobante' }).getAttribute('href');
  r.ok(!!hrefRecibo, 'la venta cobrada ofrece el comprobante');
  const recibo = await r.nueva({ viewport: { width: 700, height: 900 } });
  await recibo.context().addCookies(await rec.context().cookies());
  await recibo.goto(`${PANEL}${hrefRecibo}`, { waitUntil: 'networkidle' });
  await recibo.getByText('Total pagado').waitFor({ timeout: T.respuesta });
  r.ok(await recibo.getByText(/Folio/).count() > 0, 'el comprobante trae folio, líneas y total');
  await r.captura(recibo, 'b3-5-recibo');
  await rec.getByRole('button', { name: 'Listo' }).click();

  // 6. Retiro de caja: lo pide el gerente de sede (recepción ya no retira) y
  // lo autoriza la gerencia general tecleando su contraseña.
  r.paso('retiro de caja con firma');
  await rec.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  r.ok(await rec.getByRole('button', { name: 'Retiro o gasto' }).count() === 0, 'recepción no retira efectivo');
  const gte = await r.como('gerente');
  await gte.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  await gte.getByRole('button', { name: 'Retiro o gasto' }).first().waitFor({ timeout: T.respuesta });
  await gte.getByRole('button', { name: 'Retiro o gasto' }).first().click();
  let d = gte.getByRole('dialog');
  await d.getByLabel('Importe').fill('100');
  await d.getByLabel('Motivo').fill('Retiro de prueba a caja fuerte');
  await d.getByRole('button', { name: 'Pedir autorización' }).click();
  d = gte.getByRole('dialog');
  await d.getByText(/Pueden autorizar:/).waitFor({ timeout: T.respuesta });
  r.ok(/Mariana|Villaseñor/i.test(await d.getByText(/Pueden autorizar:/).innerText()), 'el diálogo dice desde el principio quién puede autorizar: el dueño');
  // 2.10 (20-14): la dueña ya está elegida; para probar con otra cuenta se pide «Otra persona» y se teclea su correo.
  await d.getByText(/^Firma: /).waitFor();
  await d.getByRole('button', { name: 'Otra persona' }).click();
  await d.getByLabel('Correo de quien autoriza').fill('gerencia@demo.mx');
  await d.getByLabel('Su contraseña').fill(CLAVE_PRUEBAS);
  await d.getByRole('button', { name: 'Autorizar' }).click();
  await d.getByText(/la da el dueño/i).waitFor({ timeout: T.respuesta });
  r.ok(true, 'otro gerente no firma: la segunda firma es del dueño');
  await d.getByLabel('Correo de quien autoriza').fill('owner@demo.mx');
  await d.getByRole('button', { name: 'Autorizar' }).click();
  await gte.getByText(/Retiro a caja fuerte: \$100\.00/).waitFor({ timeout: T.respuesta });
  await asentado(gte);
  r.ok(await gte.getByText('Retiro de prueba a caja fuerte').count() > 0, 'el retiro autorizado aparece en el turno');
  await shot(gte, '6-caja-retiro');
  await gte.close();

  // 7. Clases: lista de la sesión y reservar por el socio (en la clase de esta corrida).
  r.paso('inscribir desde la sesión');
  await rec.goto(`${PANEL}/clases`, { waitUntil: 'networkidle' });
  // Cada sesión que se imparte trae su botón "Inscribir" a la vista.
  await fila(rec, clase.tipo.name).first().getByRole('button', { name: 'Inscribir', exact: true }).click();
  d = rec.getByRole('dialog');
  await d.getByPlaceholder(/Inscribir a un socio/).fill(activo.memberCode);
  await d.getByRole('button', { name: 'Inscribir', exact: true }).first().click();
  // Antes de cargar nada dice si va incluida o cuánto cuesta.
  // «No va en su plan: clase suelta $X» o «Sin plan vigente: clase suelta $X» (fase 0.10).
  const aviso = d.getByText(/Incluida en su plan|clase suelta \$/i);
  await aviso.waitFor({ timeout: T.respuesta });
  r.ok(true, `antes de reservar avisa: "${(await aviso.textContent())?.trim()}"`);
  await accion(rec, () => d.getByRole('button', { name: /Confirmar inscripción|Inscribir y (cargar|cobrar)/ }).click(), /\/api\/classes\/schedules\/[^/]+\/bookings$/, { metodo: 'POST', que: 'la reserva' });
  await asentado(rec);
  // Clase suelta: se ofrece cobrarla ahí mismo (MC-02); aquí se deja en su cuenta.
  const cobroClase = rec.getByRole('dialog', { name: /Cobrar la clase de/ });
  if (await cobroClase.count()) {
    r.ok(true, 'al inscribir a una clase suelta ofrece cobrarla en el mismo paso');
    await cobroClase.getByRole('button', { name: 'Cobrar después' }).click();
  }
  d = rec.getByRole('dialog');
  await d.getByText(activo.firstName, { exact: false }).first().waitFor({ timeout: T.respuesta });
  r.ok(true, 'recepción inscribe al socio desde la sesión y aparece en la lista');
  await shot(rec, '7-clase-lista');
  // «Quitar reserva» vive en el «Más» de la fila del socio (bloque 2.5): la acción a la vista es «Llegó» o «Cobrar».
  await d.getByRole('button', { name: /^Más acciones de/ }).first().click();
  await rec.getByRole('menuitem', { name: 'Quitar reserva' }).click();
  // Quitar libera el lugar: se confirma en un diálogo que nombra al socio (11-16, fase 0.10).
  const confirmaQuitar = rec.getByRole('dialog', { name: /¿Quitar la reserva de/ });
  await confirmaQuitar.waitFor({ timeout: T.ui });
  r.ok((await confirmaQuitar.getByRole('heading').first().innerText()).includes(activo.firstName), 'quitar la reserva pide confirmar y nombra al socio');
  await confirmaQuitar.getByRole('button', { name: 'Quitar reserva' }).click();
  await rec.getByText(/Reserva quitada/).waitFor({ timeout: T.respuesta });
  r.ok(true, 'recepción puede quitar la reserva');
  await rec.keyboard.press('Escape');

  // 7b. Desde Recepción: se busca al socio y se le inscribe a una clase sin salir de ahí.
  r.paso('inscribir desde la búsqueda');
  await rec.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  await rec.getByPlaceholder(/Nombre, código o teléfono/).fill(activo.memberCode);
  await rec.getByRole('button', { name: 'Clase', exact: true }).first().click();
  const ins = rec.getByTestId('inscribir-clase');
  await ins.locator('[data-sesion]').first().waitFor({ timeout: T.respuesta });
  r.ok(await ins.getByText(/lugares? libres?|Llena/).count() > 0, 'muestra las clases que se imparten con sus lugares libres');
  await ins.locator('[data-sesion]').filter({ hasText: clase.tipo.name }).first().getByRole('button', { name: 'Inscribir', exact: true }).click();
  await rec.getByRole('dialog').getByText(/Incluida en su plan|No va incluida|No tiene plan vigente|No se puede inscribir/).waitFor({ timeout: T.respuesta });
  const confirmar = rec.getByRole('dialog').getByRole('button', { name: /Confirmar inscripción|Inscribir y (cargar|cobrar)/ });
  if (await confirmar.count()) {
    await accion(rec, () => confirmar.click(), /\/api\/classes\/schedules\/[^/]+\/bookings$/, { metodo: 'POST', que: 'la reserva' });
    await asentado(rec);
    const cobro2 = rec.getByRole('dialog', { name: /Cobrar la clase de/ });
    if (await cobro2.count()) await cobro2.getByRole('button', { name: 'Cobrar después' }).click();
    await ins.getByText('Inscrito', { exact: true }).waitFor({ timeout: T.respuesta });
    r.ok(true, 'recepción inscribe al socio a una clase desde la búsqueda');
  } else r.ok(true, 'si no se puede inscribir, dice por qué antes de cargar nada');
  await rec.keyboard.press('Escape');

  // 8. Recepción le asigna su coach desde la ficha (el coach solo ve a sus socios).
  r.paso('coach y rutina');
  await rec.goto(`${PANEL}/socios/${activo.id}`, { waitUntil: 'networkidle' });
  const selCoach = rec.getByTestId('coach-socio');
  await selCoach.waitFor({ timeout: T.respuesta });
  await selCoach.selectOption({ index: 1 });
  await rec.getByText(/^Asignado a /).waitFor({ timeout: T.respuesta });
  r.ok(true, 'recepción asigna el coach del socio desde su ficha');
  // Coach: arma una rutina con el catálogo y la asigna.
  const coach = await r.como('coach');
  await coach.getByRole('link', { name: 'Rutinas' }).click();
  await coach.waitForURL('**/rutinas');
  await coach.getByText('Hipertrofia · torso / pierna').waitFor({ timeout: T.respuesta });
  r.ok(true, 'el coach ve las rutinas del gimnasio');
  const rutina = `Rutina de prueba ${letras(4)}`;
  await coach.getByRole('link', { name: 'Nueva rutina' }).first().click();
  await coach.locator('#rt-nombre').fill(rutina);
  await coach.getByLabel('Nombre del día').fill('Pecho');
  await coach.getByRole('button', { name: 'Agregar ejercicios' }).first().click();
  d = coach.getByRole('dialog');
  await d.getByText('Press de banca con barra').waitFor({ timeout: T.respuesta });
  r.ok(await d.locator('.rt-catalogo li').count() === 10, 'el bloque Pecho trae sus diez ejercicios precargados');
  await d.getByText('Press de banca con barra').click();
  await d.getByText('Aperturas con mancuernas').click();
  await shot(coach, '8-selector');
  await d.getByRole('button', { name: 'Agregar 2' }).click();
  await coach.getByRole('button', { name: 'Agregar día' }).click();
  await coach.getByLabel('Nombre del día').fill('Pierna');
  await coach.getByRole('button', { name: 'Agregar ejercicios' }).first().click();
  d = coach.getByRole('dialog');
  await d.getByRole('button', { name: 'Pierna' }).click();
  await d.getByText('Sentadilla con barra').click();
  await d.getByRole('button', { name: 'Agregar 1' }).click();
  await coach.locator('.rt-reps').first().fill('6-8');
  await shot(coach, '8-editor');
  await coach.getByRole('button', { name: 'Crear rutina' }).click();
  await coach.waitForURL(/\/rutinas\/[0-9a-f-]{36}$/, { timeout: T.respuesta });
  const rutinaId = coach.url().split('/').pop();
  r.alFinal(() => g.post(`/routines/${rutinaId}/archive`, {}));
  r.ok(true, 'la rutina se guarda con sus dos días');
  await coach.getByRole('button', { name: 'Asignar a un socio' }).click();
  d = coach.getByRole('dialog');
  await d.getByPlaceholder('Nombre, código o teléfono').fill(activo.memberCode);
  await d.locator('.list-item').first().click();
  await d.getByLabel('Nota para el socio (opcional)').fill('Sube peso cada semana');
  await d.getByRole('button', { name: 'Asignar' }).click();
  await coach.getByText(new RegExp(`ya ve «${rutina}»`)).waitFor({ timeout: T.respuesta });
  r.ok(true, 'el coach asigna la rutina al socio');

  // 9. El socio la ve en su teléfono.
  r.paso('el socio ve su rutina');
  const codigo = await invitacionPortal(g, activo);
  const tel = await r.nueva({ movil: true });
  await tel.goto(`${PORTAL}/activar`, { waitUntil: 'networkidle' });
  await tel.locator('input').first().fill(codigo);
  await tel.getByRole('button', { name: /Activar/ }).click();
  await tel.waitForURL(`${PORTAL}/`, { timeout: T.respuesta });
  await tel.getByRole('link', { name: 'Rutina' }).click();
  await tel.getByText(rutina).waitFor({ timeout: T.respuesta });
  r.ok(await tel.getByText('Press de banca con barra').count() > 0, 'el socio ve su rutina con sus ejercicios');
  r.ok(await tel.getByText('Sube peso cada semana').count() > 0, 'y la nota de su coach');
  await r.captura(tel, 'b3-9-portal-rutina', { full: true });
  await tel.getByRole('tab', { name: /Pierna/ }).click();
  r.ok(await aparece(tel.getByText('Sentadilla con barra'), T.ui), 'cambia de día');
  await r.captura(tel, 'b3-9-portal-pierna');

  // 10. Alta digital de alguien que ya es socio: se vincula a su ficha.
  r.paso('alta digital vinculada');
  const sede = activo.homeBranchId;
  const form = await r.nueva({ movil: true });
  await form.goto(`${PORTAL}/alta/${sede}`, { waitUntil: 'networkidle' });
  await form.getByLabel('Nombre(s)').fill(activo.firstName);
  await form.getByLabel('Apellidos').fill(activo.lastName);
  await form.getByLabel('Celular').fill(celular());
  for (const c of await form.getByRole('checkbox').all()) await c.check();
  await form.getByRole('button', { name: 'Enviar mis datos' }).click();
  await form.getByText('Solo falta pasar a recepción').waitFor({ timeout: T.respuesta });
  await rec.goto(`${PANEL}/altas`, { waitUntil: 'networkidle' });
  await rec.getByText(`${activo.firstName} ${activo.lastName}`).first().click();
  await rec.getByRole('button', { name: 'Es esta persona' }).first().waitFor({ timeout: T.respuesta });
  r.ok(await rec.getByRole('button', { name: /^Aprobar$/ }).count() === 0, 'con coincidencias ya no se ofrece "Aprobar" a secas');
  await shot(rec, '10-alta-coincide');
  await rec.getByRole('button', { name: 'Es esta persona' }).first().click();
  await rec.getByText('Alta vinculada a su ficha').waitFor({ timeout: T.respuesta });
  r.ok(true, 'el alta se vincula a la ficha existente');
});
