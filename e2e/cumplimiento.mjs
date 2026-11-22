// Cumplimiento (PS-07, PS-08) y lo que la gerencia hace con un socio y una
// sede: plazo de supresión, solicitud ARCO con plazo, portal cerrado en sus
// teléfonos, venta ligada, cajas que se renombran, cerrar una sede, cerrar el
// mes con la firma de la dueña, arranque y bitácora.
//
// Fase 1.17a: la solicitud ARCO y el portal son de un socio propio de la
// corrida (antes, el primero del padrón); y si cierra el mes pasado, al
// terminar lo vuelve a abrir en gymflow_pruebas, para que `firmas` y la
// siguiente corrida lo encuentren abierto (antes dependía de que `firmas`
// corriera justo antes y lo dejara cerrado).
import { recorrido, socioAlCorriente, accion, asentado, aparece, sql, hoy, PANEL, T, CLAVE_PRUEBAS } from './lib/index.mjs';

await recorrido('cumplimiento', async (r) => {
  const socio = await socioAlCorriente(await r.api('gerencia'), { sede: 'CEN' });
  const [y, m] = hoy().split('-').map(Number);
  const mesPasado = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);

  const g = await r.como('gerencia');

  // 1. Cumplimiento: bandeja ARCO y plazo de supresión (PS-07, PS-08).
  r.paso('plazo de supresión');
  await g.goto(`${PANEL}/consentimientos`, { waitUntil: 'networkidle' });
  await g.getByTestId('bandeja-arco').waitFor({ timeout: T.respuesta });
  await g.getByTestId('plazo-supresion').waitFor();
  await g.getByTestId('plazo-supresion').getByLabel('Meses tras la baja').fill('24');
  await g.getByTestId('plazo-supresion').getByRole('button', { name: 'Guardar' }).click();
  await g.getByText(/Plazo guardado: 24 meses/).waitFor({ timeout: T.respuesta });
  r.ok(true, 'la gerencia fija el plazo de supresión en meses');
  await r.captura(g, 'cumpl-1-cumplimiento', { full: true });

  // 2. En la ficha: solicitud ARCO con plazo, resolverla, y retirar un consentimiento opcional si lo hay.
  r.paso('solicitud ARCO en la ficha');
  await g.goto(`${PANEL}/socios/${socio.id}?tab=consentimientos`, { waitUntil: 'networkidle' });
  await g.getByText('Solicitudes ARCO').first().waitFor({ timeout: T.respuesta });
  await g.getByRole('button', { name: 'Registrar solicitud' }).click();
  let d = g.getByRole('dialog');
  // 1.10: se elige qué pide (ya nada viene marcado) y se confirma la identidad; sin eso no registra en el mostrador.
  await d.getByRole('radio', { name: /Rectificación/ }).click();
  await d.getByLabel('Qué dijo (opcional)').fill('Quiere que corrijan su apellido');
  await d.getByLabel(/Verifiqué su identidad/).check();
  await d.getByRole('button', { name: 'Registrar' }).click();
  await g.getByText(/Solicitud registrada/).waitFor({ timeout: T.respuesta });
  await g.getByText(/Vence el/).first().waitFor({ timeout: T.respuesta });
  r.ok(true, 'la solicitud ARCO queda con su fecha de vencimiento');
  await r.captura(g, 'cumpl-2-arco-ficha', { full: true });
  // 1.10: al registrar se abre la constancia (folio y plazo); se cierra para seguir.
  await g.getByTestId('constancia-arco').waitFor({ timeout: T.respuesta });
  await g.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await g.getByRole('button', { name: 'Resolver' }).first().click();
  d = g.getByRole('dialog');
  // 1.10: primero «Procede» o «No procede»; lo que procede y no es inmediato se cierra con «Ya quedó hecho».
  await d.getByRole('button', { name: 'Procede', exact: true }).click();
  await d.getByLabel('Qué se hizo').fill('Apellido corregido en la ficha');
  await d.getByRole('button', { name: 'Marcar resuelta' }).click();
  await g.getByText(/Solicitud resuelta/).waitFor({ timeout: T.respuesta });
  await g.getByRole('button', { name: 'Ya quedó hecho' }).first().click();
  d = g.getByRole('dialog');
  await d.getByLabel('Qué se hizo').fill('Apellido corregido en la ficha');
  await d.getByRole('button', { name: 'Cerrar solicitud' }).click();
  await g.getByText(/^Resuelta /).first().waitFor({ timeout: T.respuesta });
  r.ok(await g.getByText(/Apellido corregido en la ficha/).count() > 0, 'y al resolverla queda la fecha y lo que se hizo');
  const retirar = g.getByRole('button', { name: 'Retirar' });
  r.ok(true, `consentimientos retirables en esta ficha: ${await retirar.count()}`);

  // 3. Teléfono perdido y venta ligada al socio, desde "Más".
  r.paso('portal y venta ligada');
  await g.getByRole('button', { name: 'Más' }).click();
  // Fase 2.2: un solo diálogo «Portal de {nombre}». Cerrar solo se ofrece si lo tiene abierto en algún teléfono.
  await g.getByRole('menuitem', { name: /^Portal de / }).click();
  d = g.getByRole('dialog');
  await d.locator('[data-testid="portal-telefonos"][data-estado="listo"]').waitFor({ timeout: T.respuesta });
  const cerrarPortal = d.getByRole('button', { name: 'Cerrar el portal en sus teléfonos' });
  if (await cerrarPortal.count() > 0) {
    await cerrarPortal.click();
    await d.getByRole('button', { name: 'Cerrar en todos' }).click();
    await g.getByText(/Portal cerrado|No tenía el portal abierto/).waitFor({ timeout: T.respuesta });
    r.ok(true, 'recepción cierra el portal en todos los teléfonos del socio');
  } else {
    r.ok(await d.getByText('Ahora mismo no tiene el portal abierto en ningún teléfono.').count() === 1, 'el diálogo dice que no tiene el portal abierto en ningún teléfono (no hay qué cerrar)');
  }
  r.ok(await d.getByRole('button', { name: 'Generar código' }).count() === 1, 'el mismo diálogo ofrece darle el código');
  await d.locator('.dialog-foot').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await g.getByRole('button', { name: 'Más' }).click();
  await g.getByRole('menuitem', { name: 'Venderle producto' }).click();
  await g.waitForURL('**/punto-de-venta?socio=**');
  await g.getByText('Venta para').waitFor({ timeout: T.respuesta });
  r.ok(true, 'desde la ficha se vende producto con la venta ligada al socio');
  await r.captura(g, 'cumpl-3-pos-socio');

  // 4. Sucursales: cajas que se renombran, y conteos antes de cerrar una sede.
  r.paso('sucursales');
  await g.goto(`${PANEL}/sucursales`, { waitUntil: 'networkidle' });
  await g.locator('.chip').first().waitFor({ timeout: T.respuesta });
  await g.locator('.chip').first().click();
  d = g.getByRole('dialog');
  await d.getByLabel('Nombre').waitFor();
  const viejo = await d.getByLabel('Nombre').inputValue();
  await d.getByLabel('Nombre').fill('Caja principal');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await g.getByText('Caja renombrada').waitFor({ timeout: T.respuesta });
  // La lista se recarga después del aviso: se espera al nombre nuevo, no se cuenta al instante.
  r.ok(await aparece(g.getByText('Caja principal').first(), T.ui), `una caja se renombra ("${viejo}" → "Caja principal")`);
  // Se deja como estaba: otros recorridos la buscan por su nombre.
  await g.getByText('Caja principal').first().click();
  await g.getByRole('dialog').getByLabel('Nombre').fill(viejo);
  await g.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await g.getByText('Caja renombrada').waitFor({ timeout: T.respuesta });
  await g.getByRole('button', { name: 'Agregar caja' }).first().click();
  d = g.getByRole('dialog');
  r.ok((await d.getByLabel('Nombre').inputValue()).length > 0, '"Agregar caja" propone un nombre y lo deja cambiar');
  await d.getByRole('button', { name: 'Cancelar' }).click();
  // Cerrar una sede tiene su propio diálogo con motivo (1.14, 19-06): antes era
  // desmarcar «Sucursal abierta» en «Editar». Lo que se comprueba es lo mismo:
  // antes de cerrar, dice qué se lleva por delante.
  await g.getByRole('button', { name: 'Editar' }).first().click();
  d = g.getByRole('dialog');
  await d.getByRole('button', { name: /^Cerrar sucursal/ }).click();
  const cierre = g.getByRole('dialog', { name: /^Cerrar / });
  await cierre.getByText(/Al cerrarla|Tiene caja abierta/).first().waitFor({ timeout: T.respuesta });
  r.ok(true, 'al pedir «Cerrar sucursal…» dice qué se lleva por delante cerrar la sede');
  await r.captura(g, 'cumpl-4-cerrar-sede');
  await cierre.getByRole('button', { name: 'Volver' }).click();

  // 5. Tablero: Exportar y Cerrar mes con la firma del dueño.
  r.paso('cerrar el mes pasado');
  await g.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  await g.getByRole('button', { name: 'Mes pasado' }).click();
  // El tablero conserva las cifras anteriores mientras carga: se espera a que termine.
  await g.locator('.tablero-cifras:not([aria-busy])').waitFor({ timeout: T.respuesta });
  await g.getByText('Cobrado').first().waitFor({ timeout: T.respuesta });
  r.ok(await g.getByRole('button', { name: 'Exportar' }).count() === 1, 'el tablero se exporta a CSV');
  const cerrar = g.getByRole('button', { name: 'Cerrar mes' });
  if (await cerrar.count()) {
    r.alFinal(async () => {
      const abiertos = await sql(`delete from monthly_closes where month = $1::date
          and "organizationId" = (select id from organizations where "tradeName" = 'Gimnasio Demo') returning id`, [mesPasado]);
      if (abiertos.length) r.nota(`se abre de nuevo el mes pasado (${mesPasado.slice(0, 7)}) en gymflow_pruebas: el cierre de esta corrida no se queda`);
    });
    await cerrar.click();
    d = g.getByRole('dialog');
    await d.getByRole('button', { name: 'Cerrar el mes' }).click();
    // 2.10 (20-14): con una sola persona que firma, ya está elegida; no se teclea su correo.
    const au = g.getByRole('dialog').filter({ hasText: 'Su contraseña' });
    await au.getByText(/^Firma: /).waitFor();
    await au.getByLabel('Su contraseña').fill(CLAVE_PRUEBAS);
    await au.getByRole('button', { name: 'Autorizar' }).click();
    await g.getByText(/quedó cerrado/).waitFor({ timeout: T.respuesta });
    await g.getByText(/Mes cerrado el/).waitFor({ timeout: T.respuesta });
    r.ok(true, 'el gerente cierra el mes pasado con la firma del dueño y el tablero lo marca');
    r.ok(await g.getByRole('button', { name: 'Cerrar mes' }).count() === 0, 'un mes cerrado ya no ofrece cerrarse');
  } else r.ok(await g.getByText(/Mes cerrado el/).count() > 0, 'el mes pasado ya estaba cerrado');
  await r.captura(g, 'cumpl-5-tablero-cerrado', { full: true });

  // 6. Arranque y bitácora.
  r.paso('arranque y bitácora');
  await g.goto(`${PANEL}/arranque`, { waitUntil: 'networkidle' });
  await g.getByText('Importar la base de socios').waitFor({ timeout: T.respuesta });
  r.ok(await g.getByText('El dueño ya entró y cambió su contraseña').count() === 1, 'el arranque tiene los pasos de importar y del dueño');
  r.ok(await g.getByText('Revisar qué módulos usa tu gimnasio').count() === 0, 'y ya no el paso que siempre estaba hecho');
  await g.goto(`${PANEL}/bitacora`, { waitUntil: 'networkidle' });
  await g.getByRole('button', { name: 'GymFlow' }).waitFor({ timeout: T.respuesta });
  await accion(g, () => g.getByRole('button', { name: 'GymFlow' }).click(), '/api/audit', { metodo: 'GET', que: 'la bitácora de GymFlow' });
  await asentado(g);
  r.ok(await g.locator('.callout-danger').count() === 0 && await g.getByText(/^(?!.*GymFlow).*(registró|cobró|vendió|abrió|cerró|dio de alta)/).count() === 0, 'la categoría GymFlow solo deja lo que hizo la plataforma');
}, { erroresDePagina: 'ok' });
