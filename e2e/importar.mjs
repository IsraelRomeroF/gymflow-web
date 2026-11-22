// Importar la base de socios del sistema anterior con revisión de duplicados.
// Datos propios (fase 1.17a): el socio que «ya existe» y que el archivo trae
// con otro formato de nombre y teléfono es de esta corrida (antes, el primero
// del padrón con teléfono). Cada decisión espera la respuesta que la guarda.
import { writeFileSync } from 'node:fs';
import { recorrido, crearSocio, accion, asentado, hoy, letras, PANEL, T } from './lib/index.mjs';

await recorrido('importar', async (r) => {
  const ya = await crearSocio(await r.api('gerencia'), { sede: 'CEN', nombre: 'Graciela', apellidos: `Zamora ${letras(5)}` });
  const p = await r.como('gerencia');
  const sufijo = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const tel = (n) => `99${String(Date.now()).slice(-6)}${n}${n}`;
  const codigo = (n) => `X${sufijo}${n}`;
  const csv = [
    'No. Socio;Nombre completo;Teléfono;Correo electrónico;Sucursal;Fecha de alta;Saldo;Plan;Vence',
    `${codigo(1)};LAURA ${sufijo.toUpperCase()} GÓMEZ RÍOS;${tel(1)};laura.${sufijo}@correo.mx;Centro;15/03/2021;$650.00;MENSUAL;30/12/2030`,
    `${codigo(2)};${ya.firstName.toUpperCase()} ${ya.lastName.toUpperCase()};${ya.phoneE164.slice(3, 6)} ${ya.phoneE164.slice(6, 9)} ${ya.phoneE164.slice(9)};;Centro;01/01/2012;0;;`,
    `${codigo(3)};Mateo ${sufijo} ${ya.lastName};${ya.phoneE164.slice(3)};;Centro;;;;`,
    `${codigo(4)};Pedro ${sufijo} Luna Sol;${tel(4)};;Norte;2020-06-01;100;MENSUAL;`,
    `N-${codigo(4)};Pedro ${sufijo} Luna Sol;${tel(4)};;Centro;2018-06-01;-50;;`,
    `${codigo(6)};;5555555555;;Centro;;;;`,
  ].join('\n');
  const ruta = new URL(`./archivos/socios-${sufijo}.csv`, import.meta.url).pathname;
  writeFileSync(ruta, csv);

  r.paso('subir y revisar');
  await p.goto(`${PANEL}/importar`, { waitUntil: 'networkidle' });
  const nueva = p.getByTestId('nueva-importacion');
  if (!(await nueva.count())) await p.getByRole('button', { name: 'Nueva importación' }).click();
  await p.getByLabel('Archivo de socios').setInputFiles(ruta);
  await p.getByLabel('Qué trae la columna No. Socio').waitFor();
  r.ok(await p.getByLabel('Qué trae la columna No. Socio').inputValue() === 'legacyCode'
    && await p.getByLabel('Qué trae la columna Nombre completo').inputValue() === 'fullName'
    && await p.getByLabel('Qué trae la columna Vence').inputValue() === 'periodEnd', 'reconoce cada columna por su encabezado');
  // La fecha de corte ya no nace en «hoy» y cargar el archivo ya no pide motivo (fase 2 · 2.7).
  await p.getByLabel('Fecha de corte').fill(hoy());
  await p.getByRole('button', { name: /Revisar 6 filas/ }).click();
  await p.waitForURL(/\/importar\/[0-9a-f-]{36}$/, { timeout: T.respuesta });
  await p.getByTestId('importar-resumen').waitFor({ timeout: T.respuesta });
  await r.captura(p, 'importar-1-revision', { full: true });

  // Lo dudoso (el familiar con el mismo celular) espera a una persona.
  r.paso('decidir los casos');
  r.ok(await p.getByText(/coincidencia espera tu decisión|coincidencias esperan tu decisión/).count() === 1, 'avisa que hay coincidencias por revisar');
  r.ok(await p.getByRole('button', { name: /Faltan? \d+ por revisar/ }).isDisabled(), 'no deja aplicar mientras haya algo sin decidir');
  const casos = p.locator('[data-caso]');
  await casos.first().waitFor();
  const nCasos = await casos.count();
  for (let i = 0; i < nCasos; i++) {
    await accion(p, () => casos.nth(i).getByRole('button', { name: 'Son distintas' }).click(), /\/api\/member-imports\/[^/]+\/rows\/[^/]+$/, { metodo: 'PUT', que: 'la decisión del caso' });
    await asentado(p);
  }
  r.ok(await p.locator('[data-caso][data-decision="CREATE"]').count() === nCasos, 'decide cada caso lado a lado');

  await p.getByRole('tab', { name: /Ya son socios/ }).click();
  await p.locator('[data-caso]').first().waitFor();
  r.ok(await p.locator('[data-caso]').first().getByText(ya.memberCode).count() >= 1, 'muestra con qué socio coincide, con su código');
  await p.getByRole('tab', { name: /Repetidos en el archivo/ }).click();
  await p.locator('[data-caso]').first().waitFor();
  r.ok(await p.locator('[data-caso]').count() === 1, 'detecta a la misma persona repetida en dos sucursales del archivo');

  // El plan del archivo va a la mensualidad de GymFlow.
  r.paso('aplicar');
  const plan = p.getByTestId('asignaciones').getByLabel(/MENSUAL/);
  const opciones = await plan.locator('option').allInnerTexts();
  const nombrePlan = opciones.find((o) => /mensual/i.test(o)) ?? opciones[1];
  await plan.selectOption({ label: nombrePlan });
  await accion(p, () => p.getByTestId('asignaciones').getByRole('button', { name: 'Guardar' }).click(), /\/api\/member-imports\/[^/]+\/maps$/, { metodo: 'PUT', que: 'las asignaciones' });
  await asentado(p);

  // Aplicar abre su confirmación (fase 2 · 2.7): resumen de dinero, EL motivo y el cotejo contra la cartera.
  await p.getByTestId('aplicar').getByRole('button', { name: /^Aplicar \d+ filas/ }).click();
  const confirmar = p.getByRole('dialog');
  await confirmar.getByLabel('Motivo').fill('Corte firmado por el dueño');
  r.ok(await confirmar.getByText('Adeudo que se carga').count() === 1, 'antes de aplicar repite el dinero que entra');
  await confirmar.getByLabel(/Cotejé el adeudo/).check();
  await confirmar.getByRole('button', { name: /^Aplicar \d+ filas$/ }).click();
  await p.getByText('Importación aplicada', { exact: true }).waitFor({ timeout: 2 * T.navegacion });
  r.ok(true, 'aplica la importación por lotes');
  await r.captura(p, 'importar-2-aplicada', { full: true });

  // El código del sistema anterior encuentra al socio; la nueva entró con su vigencia y su saldo.
  r.paso('lo que quedó');
  const busca = await (await p.request.get(`${PANEL}/api/members/search?q=${codigo(1)}`)).json();
  r.ok(busca.results[0]?.lastName === 'Gómez Ríos', 'el código anterior encuentra al socio primero, con su nombre bien escrito');
  const laura = busca.results[0];
  await p.goto(`${PANEL}/socios/${laura.id}`, { waitUntil: 'networkidle' });
  // Desde 2.12 hay dos: el de la cabecera y el del paso «Cobrar» de «Para terminar su alta».
  await p.getByRole('button', { name: /Cobrar \$650/ }).first().waitFor({ timeout: T.respuesta });
  r.ok(true, 'la ficha trae su saldo inicial ($650) listo para cobrar');
  r.ok(await p.getByText(nombrePlan, { exact: false }).count() > 0 && await p.getByText(/2030/).count() > 0, 'y su membresía con la vigencia del sistema anterior');
  const pedro1 = (await (await p.request.get(`${PANEL}/api/members/search?q=${codigo(4)}`)).json()).results[0];
  const pedro2 = (await (await p.request.get(`${PANEL}/api/members/search?q=N-${codigo(4)}`)).json()).results[0];
  r.ok(!!pedro1 && pedro1.id === pedro2?.id, 'la persona repetida en el archivo quedó en una sola ficha, con sus dos códigos');

  // Volver a subir el mismo archivo no duplica: todos se reconocen por su código.
  r.paso('reimportar');
  await p.goto(`${PANEL}/importar`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Nueva importación' }).click();
  await p.getByLabel('Archivo de socios').setInputFiles(ruta);
  await p.getByLabel('Fecha de corte').fill(hoy());
  await p.getByRole('button', { name: /Revisar 6 filas/ }).click();
  await p.waitForURL(/\/importar\/[0-9a-f-]{36}$/, { timeout: T.respuesta });
  await p.getByTestId('importar-resumen').waitFor({ timeout: T.respuesta });
  r.ok(await p.getByRole('tab', { name: /^Nuevos/ }).count() === 0, 'reimportar el mismo archivo no trae a nadie como nuevo');
  await p.getByRole('button', { name: 'Descartar importación' }).click();
  // Descartar también confirma (fase 2 · 2.7).
  await p.getByRole('dialog').getByRole('button', { name: 'Descartar', exact: true }).click();
  await p.getByText('Cancelada').first().waitFor();
}, { erroresDePagina: 'falla' });
