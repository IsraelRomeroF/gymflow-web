// Módulos (ADR-036): la gerencia apaga Prospectos con motivo y lo vuelve a
// encender, deja de usar Clases en Norte y lo retoma; recepción y la dueña ven
// lo que les toca; el buscador no ofrece lo apagado; y la bitácora lo cuenta.
// Fase 1.17a: si el recorrido se cae con algo apagado, al terminar lo enciende
// (antes, una corrida a medias dejaba Prospectos apagado y la siguiente fallaba
// en «nueve de diez módulos encendidos»).
import { recorrido, abrirMenu, asentado, PANEL, T } from './lib/index.mjs';

await recorrido('modulos', async (r) => {
  const ok = r.ok;
  const api = await r.api('gerencia');
  // Lo que estaba encendido al empezar es lo que se vuelve a encender si se queda apagado.
  const antes = (await api.get('/organization/modules')).modules;
  const sedesConClases = new Set((antes.find((x) => x.key === 'classes')?.branches ?? []).filter((b) => b.enabled).map((b) => b.branchId));
  r.alFinal(async () => {
    const { modules } = await api.get('/organization/modules');
    const pros = modules.find((x) => x.key === 'prospects');
    if (antes.find((x) => x.key === 'prospects')?.enabled && pros && !pros.enabled) { await api.put('/organization/modules/prospects', { enabled: true }); r.nota('Prospectos se encendió al terminar: el recorrido lo había dejado apagado'); }
    for (const b of modules.find((x) => x.key === 'classes')?.branches ?? []) {
      if (!b.enabled && sedesConClases.has(b.branchId)) { await api.put(`/organization/modules/classes/branches/${b.branchId}`, { enabled: true }); r.nota(`Clases vuelve a usarse en ${b.name} al terminar`); }
    }
  });
  const entrar = async (p, quien) => { await r.entrar(p, quien); await p.locator('.side-nav .side-link').first().waitFor(); };
  const nueva = (vp) => r.nueva(vp ? { viewport: vp } : {});
  // Solo el menú lateral: las tarjetas del inicio también enlazan a secciones.
  const enlace = (p, nombre) => p.locator('.side-nav').getByRole('link', { name: nombre, exact: true });
  const fila = (p, clave) => p.locator(`[data-modulo="${clave}"]`);

  // La gerencia general abre Módulos: todo encendido salvo el monitor de accesos.
  const g = await nueva();
  await entrar(g, 'gerencia');
  await abrirMenu(g);
  ok(await enlace(g, 'Accesos').count() === 0, 'el monitor de accesos nace apagado: no está en el menú');
  // 2.12: Sucursales y Módulos son una entrada del menú, «Mi gimnasio»; Módulos es su pestaña.
  await enlace(g, 'Mi gimnasio').click();
  await g.getByRole('tab', { name: 'Módulos', exact: true }).click();
  await g.getByRole('heading', { name: 'Módulos', exact: true }).waitFor({ timeout: T.respuesta });
  await fila(g, 'classes').waitFor();
  ok((await g.getByTestId('resumen-modulos').innerText()).startsWith('9 de 10'), 'nueve de diez módulos encendidos');
  ok(await fila(g, 'cash').count() === 1 && await fila(g, 'member_portal').count() === 1, 'Caja y Portal del socio también se apagan');
  ok(await fila(g, 'pos').getByText(/Necesita: Caja/).count() === 1, 'Punto de venta dice que necesita Caja');
  ok(await g.getByText('Siempre encendido').count() === 1 && await g.getByText(/obligatorio por ley/).count() === 1, 'lo básico va aparte, con su razón');
  await r.captura(g, 'modulos-1-pantalla', { full: true });

  // Altas digitales tiene solicitudes por revisar: no se apaga encima de quien espera.
  await fila(g, 'intake').getByRole('switch').click();
  ok(await g.getByRole('dialog').getByText(/Antes de apagar Altas digitales/).count() === 1, 'con altas por revisar, primero pide resolverlas');
  await r.captura(g, 'modulos-2-bloqueo');
  await g.getByRole('dialog').getByRole('button', { name: 'Volver' }).click();

  // Prospectos se apaga con motivo y avisa lo que se conserva.
  await fila(g, 'prospects').getByRole('switch').click();
  let d = g.getByRole('dialog');
  ok(await d.getByText(/No se borra nada/).count() === 1 && await d.getByText(/prospectos? en seguimiento/).count() === 1, 'el diálogo dice qué se conserva');
  ok(await d.getByRole('button', { name: 'Apagar Prospectos' }).isDisabled(), 'sin motivo no se apaga');
  await d.getByRole('button', { name: 'Lo llevamos en otra herramienta' }).click();
  await r.captura(g, 'modulos-3-apagar');
  await d.getByRole('button', { name: 'Apagar Prospectos' }).click();
  await g.getByText(/Prospectos se apagó/).waitFor({ timeout: T.respuesta });
  ok(await fila(g, 'prospects').getByRole('switch').getAttribute('aria-checked') === 'false', 'la tarjeta queda apagada');
  ok(await fila(g, 'prospects').getByText(/Apagado por .* «Lo llevamos en otra herramienta»/).count() === 1, 'y dice quién lo apagó y por qué');
  await abrirMenu(g);
  ok(await enlace(g, 'Prospectos').count() === 0, 'Prospectos desaparece del menú en el acto');
  await r.captura(g, 'modulos-4-apagado', { full: true });

  // Quien llega por un enlace guardado lee qué pasó, no un vacío falso.
  await g.goto(`${PANEL}/prospectos`, { waitUntil: 'networkidle' });
  await g.getByText(/Prospectos está apagado en/).waitFor({ timeout: T.respuesta });
  ok(await g.getByText(/No se borró nada/).count() === 1, 'la pantalla apagada dice que nada se borró');
  ok(await g.getByRole('link', { name: 'Encender Prospectos' }).count() === 1, 'a la gerencia general le ofrece encenderlo');
  await r.captura(g, 'modulos-5-pantalla-apagada');

  // Recepción: tampoco lo ve, y su enlace guardado le dice a quién pedirlo.
  const rc = await nueva();
  await entrar(rc, 'recepcion');
  await abrirMenu(rc);
  ok(await enlace(rc, 'Prospectos').count() === 0, 'recepción ya no ve Prospectos');
  ok(await enlace(rc, 'Mi gimnasio').count() === 0, 'recepción no ve «Mi gimnasio» (ahí está Módulos)');
  await rc.goto(`${PANEL}/prospectos`, { waitUntil: 'networkidle' });
  await rc.getByText(/Prospectos está apagado en/).waitFor({ timeout: T.respuesta });
  ok(await rc.getByText(/pídeselo al dueño/).count() === 1, 'a recepción le dice a quién pedirlo');
  // Una pantalla de otro puesto no se ve como "vacía": se dice de quién es (2026-10-06). La puerta revisa
  // primero el puesto y después la llave (fase 0.8): recepción en Personal ve «Tu rol no ve esta pantalla».
  await rc.goto(`${PANEL}/personal`, { waitUntil: 'networkidle' });
  await rc.getByText('Tu rol no ve esta pantalla').waitFor({ timeout: T.respuesta });
  ok(await rc.getByText(/Personal es para/).count() === 1, 'una pantalla ajena dice de quién es, no "Sin personal"');
  await r.captura(rc, 'modulos-6-sin-acceso');

  // La dueña ve los módulos y el motivo, sin poder cambiarlos.
  const o = await nueva();
  await entrar(o, 'duena');
  await o.goto(`${PANEL}/modulos`, { waitUntil: 'networkidle' });
  await fila(o, 'prospects').waitFor({ timeout: T.respuesta });
  ok(await o.getByText('Solo el gerente puede cambiar los módulos.').count() === 1, 'la dueña lo ve en solo lectura');
  // Modo consulta (UX7): sin interruptor apagado; el estado lo dice la insignia.
  ok(await fila(o, 'prospects').getByRole('switch').count() === 0 && await fila(o, 'prospects').getByText('Apagado', { exact: true }).count() === 1, 'la dueña ve la insignia, no un interruptor apagado');
  ok(await fila(o, 'prospects').getByText(/«Lo llevamos en otra herramienta»/).count() === 1, 'y lee el motivo');

  // El buscador encuentra pantallas, y no las apagadas.
  await g.goto(`${PANEL}/panel`, { waitUntil: 'networkidle' });
  await g.keyboard.press('Control+k');
  await g.getByRole('dialog').getByRole('textbox').fill('gastos');
  ok(await g.getByRole('dialog').getByText('Ir a Movimientos').count() === 1, 'el buscador encuentra pantallas por lo que hacen');
  await g.getByRole('dialog').getByRole('textbox').fill('prospectos');
  await asentado(g);
  ok(await g.getByRole('dialog').getByText('Ir a Prospectos').count() === 0, 'y no ofrece la que está apagada');
  await g.keyboard.press('Escape');

  // Volver a encender: sin motivo, y todo regresa.
  await g.goto(`${PANEL}/modulos`, { waitUntil: 'networkidle' });
  await fila(g, 'prospects').getByRole('switch').click();
  d = g.getByRole('dialog');
  ok(await d.getByText(/Regresa lo que había/).count() === 1, 'encender dice que regresa lo que había');
  await d.getByRole('button', { name: 'Encender Prospectos' }).click();
  await g.getByText('Prospectos se encendió.').waitFor({ timeout: T.respuesta });
  await abrirMenu(g);
  ok(await enlace(g, 'Prospectos').count() === 1, 'Prospectos vuelve al menú');
  await enlace(g, 'Prospectos').click();
  await g.getByRole('heading', { name: 'Prospectos' }).waitFor({ timeout: T.respuesta });
  ok(await g.locator('tbody tr, .list-item, .card').count() > 0, 'y sus datos siguen ahí');

  // Por sucursal: Norte deja de dar clases sin apagarlas en el gimnasio.
  await g.goto(`${PANEL}/modulos`, { waitUntil: 'networkidle' });
  await fila(g, 'classes').waitFor();
  ok(await fila(g, 'classes').getByRole('button', { name: /Norte/ }).count() === 1, 'Clases se puede decidir por sucursal');
  await fila(g, 'classes').getByRole('button', { name: /Norte/ }).click();
  d = g.getByRole('dialog');
  await d.getByRole('heading', { name: 'Dejar de usar Clases en Norte' }).waitFor();
  ok(await d.getByText(/Clases sigue en/).count() === 1, 'el diálogo dice dónde sigue');
  await d.getByRole('button', { name: 'Esta sede no tiene el espacio' }).click();
  await d.getByRole('button', { name: 'Dejar de usar en Norte' }).click();
  await g.getByText('Clases dejó de usarse en Norte.').waitFor({ timeout: T.respuesta });
  ok(await fila(g, 'classes').locator('.chip-sede[aria-pressed="false"]', { hasText: 'Norte' }).count() === 1, 'la tarjeta marca a Norte sin Clases');
  ok(await fila(g, 'classes').getByRole('switch').getAttribute('aria-checked') === 'true', 'y en el gimnasio sigue encendido');
  const yo = await g.evaluate(async () => (await (await fetch('/api/auth/me')).json()));
  const norteId = Object.keys(yo.disabledByBranch).find((b) => yo.disabledByBranch[b].includes('classes'));
  ok(!!norteId && yo.modules.includes('classes'), 'la sesión sabe qué sede dejó de usar Clases');
  await r.captura(g, 'modulos-8-por-sucursal');
  await fila(g, 'classes').locator('.chip-sede', { hasText: 'Norte' }).click();
  await g.getByRole('dialog').getByRole('button', { name: 'Usar en Norte' }).click();
  await g.getByText('Clases vuelve a usarse en Norte.').waitFor({ timeout: T.respuesta });

  // Queda en la bitácora.
  await g.goto(`${PANEL}/bitacora`, { waitUntil: 'networkidle' });
  await g.getByRole('heading', { name: 'Bitácora' }).waitFor({ timeout: T.respuesta });
  ok(await g.getByText('apagó el módulo Prospectos').count() >= 1 && await g.getByText('encendió el módulo Prospectos').count() >= 1, 'la bitácora dice quién apagó y encendió qué, en palabras');
  ok(await g.getByText('Motivo: Lo llevamos en otra herramienta').count() >= 1, 'con su motivo');
  await r.captura(g, 'modulos-7-bitacora');
});
