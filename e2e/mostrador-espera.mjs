// Mostrador sin errores de dedo (auditoría 8, fase 0.7: 5-01, 2-06, 5-10, 5-22).
// Mientras llega la respuesta de lo último tecleado, la lista anterior queda
// «en espera» y no registra nada sobre el socio anterior; el código exacto y
// Enter (lo que manda un lector de código de barras) registra la entrada del
// socio correcto aunque el Enter llegue antes que la respuesta; «Cargar más» no
// deja insignias en «…»; y un rechazo que otra persona ya resolvió se dice como
// resuelto (409 ALREADY_RESOLVED), sin otra entrada ni otro cobro.
//
// Datos propios (fase 1.17a): los dos al corriente y el suspendido son de esta
// corrida (antes, de la semilla, evitando los que tomaba `adeudo`). Las esperas
// de «no pasa nada» (Ctrl+Enter, Enter en espera) ya no son 500-700 ms: se
// espera a que la página pinte lo que la tecla iba a cambiar.
import { recorrido, socioAlCorriente, socioSuspendido, motivoDeExcepcion, respuesta, asentado, cuadros, aparece, hasta, PANEL, T } from './lib/index.mjs';

await recorrido('mostrador-espera', async (r) => {
  const json = (p, url, init) => p.evaluate(async ([u, i]) => { const x = await fetch(u, i); return { status: x.status, body: await x.json().catch(() => null) }; }, [url, init]);
  const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const g = await r.api('gerencia');
  const a = await socioAlCorriente(g, { sede: 'CEN', nombre: 'Andrea' });
  const b = await socioAlCorriente(g, { sede: 'CEN', nombre: 'Bruno' });
  const deudor = await socioSuspendido(g, { sede: 'CEN', mesesAtras: 0, nombre: 'Daniel' });
  r.ok(!!a && !!b && !!deudor, `socios de prueba: ${a.firstName}, ${b.firstName} y ${deudor.firstName} (suspendido), de esta corrida`);

  const rec = await r.como('recepcion');
  const inicio = new Date().toISOString();

  // La red lenta solo para una búsqueda: su respuesta se detiene hasta soltarla.
  // Así se ve el estado «en espera» sin depender de la velocidad de la máquina.
  // `detenida` se cumple cuando esa búsqueda ya salió y quedó frenada (el
  // buscador espera 160 ms antes de pedirla): soltar antes no soltaría nada.
  let soltar = () => undefined;
  const frenar = async (q) => {
    await rec.unrouteAll({ behavior: 'wait' });
    let avisar;
    const detenida = new Promise((listo) => { avisar = listo; });
    await rec.route((u) => u.pathname === '/api/members/search' && u.searchParams.get('q') === q, async (route) => {
      await new Promise((listo) => { soltar = listo; avisar(); setTimeout(listo, T.respuesta); });
      await route.continue();
    });
    return { detenida };
  };
  const yaFrenada = (f) => new Promise((listo, no) => {
    const tope = setTimeout(() => no(new Error(`la búsqueda frenada no salió en ${T.ui / 1000} s`)), T.ui);
    f.detenida.then(() => { clearTimeout(tope); listo(); });
  });

  // 1. En espera: se buscó a A y luego se tecleó a B, cuya respuesta no llega.
  r.paso('lista en espera');
  await rec.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  const buscador = rec.getByLabel('Buscar en el padrón');
  const resultados = rec.getByTestId('resultados');
  await buscador.fill(a.memberCode);
  await resultados.getByText(a.firstName).first().waitFor({ timeout: T.respuesta });
  const nombreB = `${b.firstName} ${b.lastName}`;
  const frenoB = await frenar(nombreB);
  await buscador.fill(nombreB);
  const enEspera = rec.locator('[data-en-espera]');
  r.ok(await aparece(enEspera, T.ui), 'al teclear a otro socio, la lista anterior queda «en espera»');
  r.ok(await rec.getByText(`Buscando «${nombreB}»…`).count() === 1, 'la línea de conteo dice «Buscando «…»…»');
  r.ok(await enEspera.getByRole('button', { name: 'Entrada', exact: true }).first().isDisabled(), '«Entrada» de la lista anterior está desactivado');
  await r.captura(rec, 'espera-1-en-espera', { red: false });
  await yaFrenada(frenoB);
  await buscador.press('Control+Enter');
  await cuadros(rec, 3);
  r.ok(await rec.getByRole('dialog').count() === 0, 'Ctrl+Enter en espera no registra la entrada del socio anterior');
  soltar();
  await enEspera.waitFor({ state: 'detached', timeout: T.respuesta });
  await resultados.getByText(b.lastName).first().waitFor({ timeout: T.respuesta });
  await asentado(rec);
  r.ok(await rec.getByRole('dialog').count() === 0, 'al llegar la lista nueva, un nombre (no un código) espera a que recepción elija');

  // 2. Código exacto + Enter: el Enter llega antes que la respuesta y registra al socio correcto.
  r.paso('código exacto y Enter');
  await buscador.fill('');
  const frenoCodigo = await frenar(b.memberCode);
  await buscador.fill(b.memberCode);
  await buscador.press('Enter');
  await yaFrenada(frenoCodigo);
  await cuadros(rec, 3);
  r.ok(await rec.getByRole('dialog').count() === 0, 'con la respuesta en camino, el Enter no actúa sobre la lista anterior');
  soltar();
  const dlgB = rec.getByRole('dialog', { name: new RegExp(`^Entrada · ${b.firstName}`) });
  r.ok(await aparece(dlgB, T.respuesta), `código exacto + Enter abre la entrada de ${b.firstName}`);
  await motivoDeExcepcion(rec, 'El lector de código de barras (recorrido de prueba)');
  await rec.getByText(`${b.firstName} puede pasar`).waitFor({ timeout: T.respuesta });
  await r.captura(rec, 'espera-2-codigo-enter', { red: false });
  await dlgB.waitFor({ state: 'hidden', timeout: T.ui });
  r.ok(await buscador.inputValue() === '', 'el verde se cierra solo y deja el buscador vacío');
  await rec.unrouteAll({ behavior: 'wait' });
  const deB = (await json(rec, `/api/access/decisions?memberId=${b.id}&limit=5`)).body.decisions.filter((d) => d.at >= inicio);
  const deA = (await json(rec, `/api/access/decisions?memberId=${a.id}&limit=5`)).body.decisions.filter((d) => d.at >= inicio);
  r.ok(deB.length === 1 && deB[0].outcome === 'GRANTED', `quedó UNA entrada de ${b.firstName} (${deB.length})`);
  r.ok(deA.length === 0, `y ninguna de ${a.firstName}, el socio anterior (${deA.length})`);

  // 3. «Cargar más» dos veces: las insignias llegan por lotes de 100 y ninguna se queda en «…».
  r.paso('cargar más');
  const resumenes = [];
  rec.on('response', (x) => { if (x.url().includes('/api/members/access-summary')) resumenes.push({ status: x.status(), ids: new URL(x.url()).searchParams.get('ids')?.split(',').length ?? 0 }); });
  await rec.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  const padron = rec.getByTestId('padron');
  const filas = padron.locator('tbody tr');
  await filas.first().waitFor({ timeout: T.respuesta });
  for (let i = 0; i < 2; i++) {
    const mas = padron.getByRole('button', { name: 'Cargar más' });
    if (!(await mas.count())) break;
    const antes = await filas.count();
    await mas.click();
    await hasta(rec, ([n]) => document.querySelectorAll('[data-testid="padron"] tbody tr').length > n, [antes], { timeout: T.respuesta, que: '«Cargar más»' });
  }
  const n = await filas.count();
  const sinPuntos = () => rec.waitForFunction((sel) => ![...document.querySelectorAll(sel)].some((e) => e.textContent.trim() === '…'), '[data-testid="padron"] tbody .badge', { timeout: T.respuesta }).then(() => true, () => false);
  r.ok(n > 100, `el padrón pasa de 100 socios tras «Cargar más» (${n})`);
  r.ok(await sinPuntos(), 'todas las insignias de acceso cargan: ninguna se queda en «…»');
  r.ok(await padron.getByText('Sin dato', { exact: true }).count() === 0, 'ningún lote falló («Sin dato»)');
  r.ok(resumenes.length > 0 && resumenes.every((x) => x.status === 200 && x.ids <= 100), `el resumen de acceso va por lotes de hasta 100 (${resumenes.map((x) => `${x.ids}:${x.status}`).join(' ')})`);
  await r.captura(rec, 'espera-3-cargar-mas');
  await buscador.fill('mart');
  await resultados.locator('li').first().waitFor({ timeout: T.respuesta });
  r.ok(await rec.waitForFunction(() => ![...document.querySelectorAll('[data-testid="resultados"] .badge')].some((e) => e.textContent.trim() === '…'), null, { timeout: T.respuesta }).then(() => true, () => false), 'después de «Cargar más», buscar «mart» tampoco deja insignias en «…»');
  await buscador.fill('');

  // 4. Un rechazo se resuelve UNA vez: otra persona lo deja pasar primero.
  r.paso('rechazo ya resuelto');
  const ger = await r.como('gerencia');
  const saldoAntes = (await json(rec, `/api/members/${deudor.id}/statement`)).body?.outstandingCents;
  await buscador.fill(deudor.memberCode);
  await resultados.getByText(deudor.firstName).first().waitFor({ timeout: T.respuesta });
  // Ruta exacta (1.4): el diálogo pregunta antes a `/access/attempts/preview`, que no registra nada ni trae `decisionId`.
  const intento = respuesta(rec, /\/api\/access\/attempts$/, { metodo: 'POST', que: 'el intento de entrada' });
  await resultados.getByRole('button', { name: 'Entrada', exact: true }).first().click();
  await motivoDeExcepcion(rec);
  const rechazo = await (await intento).json();
  await rec.getByText('No puede pasar').waitFor({ timeout: T.respuesta });
  r.ok(rechazo.outcome === 'DENIED' && rechazo.overridable, `${deudor.firstName} no puede pasar y el rechazo se puede levantar`);
  const otra = await json(ger, `/api/access/decisions/${rechazo.decisionId}/grant`, post({ reason: 'Lo dejó pasar la gerencia desde su equipo (recorrido)' }));
  r.ok(otra.status === 201, `otra persona (gerencia) lo deja pasar primero (${otra.status})`);
  await rec.getByRole('button', { name: 'Dejar pasar con motivo' }).click();
  await rec.getByLabel(/^Motivo \(queda registrado/).fill('Paga al salir (recorrido de prueba)');
  await rec.getByRole('button', { name: 'Dejar pasar', exact: true }).click();
  const ya = rec.getByTestId('entrada-ya-resuelta');
  r.ok(await aparece(ya, T.respuesta), 'recepción ve «Este rechazo ya se había resuelto» en lugar de otra entrada');
  const textoYa = (await ya.innerText().catch(() => '')).replace(/\n/g, ' ');
  r.ok(/lo resolvió .+ a las \d{1,2}:\d{2}/.test(textoYa), `dice quién lo resolvió y a qué hora: «${textoYa}»`);
  await r.captura(rec, 'espera-4-ya-resuelto');
  const cobro = await json(rec, `/api/access/decisions/${rechazo.decisionId}/collect`, post({ method: 'CARD_TERMINAL', amountCents: '100', externalRef: 'recorrido' }));
  r.ok(cobro.status === 409 && cobro.body?.detail === 'ALREADY_RESOLVED', `«Cobrar y abrir» sobre el mismo rechazo responde 409 ALREADY_RESOLVED (${cobro.status} ${cobro.body?.detail ?? ''})`);
  const decisiones = (await json(rec, `/api/access/decisions?memberId=${deudor.id}&limit=20`)).body.decisions;
  r.ok(decisiones.filter((d) => d.resolvesDecisionId === rechazo.decisionId).length === 1, 'el rechazo quedó resuelto por UNA sola entrada');
  r.ok((await json(rec, `/api/members/${deudor.id}/statement`)).body?.outstandingCents === saldoAntes, 'y no se cobró nada');
  await rec.getByRole('dialog').getByRole('button', { name: 'Listo' }).click();
  await rec.getByRole('dialog').waitFor({ state: 'hidden', timeout: T.ui });
  r.ok(await buscador.inputValue() === '', 'al cerrar el rechazo ya resuelto, el buscador queda vacío (5-22)');
}, { erroresDePagina: 'falla' });
