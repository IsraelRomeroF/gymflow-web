// «Quién debe» (fase 4, bloque 4.15), la lista de deudores con los dados de baja:
//
//  1. La gerencia llega desde el Tablero («Ver quién debe»): la cifra de «Por
//     cobrar» de la página es la del Tablero, y la lista más lo anonimizado
//     suma eso mismo.
//  2. Un socio de la corrida, suspendido con su cuota vencida y DADO DE BAJA,
//     sale con la insignia «Dado de baja»; «Abrir ficha» lleva a su ficha, que
//     le deja cobrar sin reactivarlo.
//  3. Apagar «Incluir dados de baja» lo quita de la lista.
//  4. La dueña: sin enlace, «El detalle de quién debe lo lleva la gerencia».
//
// El socio de la corrida se queda dado de baja y con su deuda: suma a «Por
// cobrar» de las pruebas, como la deja cualquier baja con adeudo.
import { recorrido, socioSuspendido, aparece, desaparece, PANEL, T } from './lib/index.mjs';

await recorrido('deudores', async (r) => {
  const g = await r.api('gerencia');
  const socio = await socioSuspendido(g, { mesesAtras: 0 });
  await g.post(`/members/${socio.id}/archive`, { reason: 'Se dio de baja con adeudo (recorrido de prueba)' });
  const ficha = await g.get(`/members/${socio.id}`);
  r.ok(ficha.status === 'ARCHIVED', `datos de la corrida: ${socio.memberCode} suspendido con su cuota vencida y dado de baja`);
  const aPesos = (texto) => Number(texto.replace(/[^0-9.]/g, ''));

  // ── 1. Desde el Tablero ───────────────────────────────────────────────────
  r.paso('desde el tablero');
  const ger = await r.como('gerencia');
  await ger.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  const cartera = ger.locator('.card').filter({ has: ger.getByRole('heading', { name: 'Cartera', exact: true }) }).first();
  const enlace = cartera.getByTestId('ver-quien-debe');
  await enlace.waitFor({ timeout: T.respuesta });
  const delTablero = aPesos(await cartera.locator('.row-between').filter({ hasText: 'Por cobrar' }).first().locator('.num').innerText());
  await enlace.click();
  await ger.waitForURL('**/tablero/deudores', { timeout: T.navegacion });
  await ger.getByRole('heading', { name: 'Quién debe' }).waitFor({ timeout: T.respuesta });
  const porCobrar = ger.getByTestId('deudores-por-cobrar');
  await porCobrar.waitFor({ timeout: T.respuesta });
  const deLaPagina = aPesos(await porCobrar.innerText());
  r.ok(Math.abs(Math.round(deLaPagina) - delTablero) <= 1, `«Por cobrar» de la página ($${deLaPagina}) es el del Tablero ($${delTablero}, sin centavos)`);
  const { summary } = await g.get('/portfolio/debtors?includeArchived=true&limit=50').catch(() => ({ summary: null }));
  if (summary) {
    const suma = BigInt(summary.listed.outstandingCents) + BigInt(summary.anonymized.outstandingCents);
    r.ok(suma === BigInt(summary.all.outstandingCents), `la lista ($${Number(summary.listed.outstandingCents) / 100}) más lo anonimizado ($${Number(summary.anonymized.outstandingCents) / 100}) suma «Por cobrar» ($${Number(summary.all.outstandingCents) / 100})`);
  }
  await r.captura(ger, 'deudores-1-quien-debe');

  // ── 2. El dado de baja con deuda ──────────────────────────────────────────
  r.paso('dado de baja');
  const lista = ger.getByTestId('deudores-lista');
  let fila = lista.getByTestId('deudor').filter({ hasText: socio.memberCode });
  // La lista va de quien más debe a quien menos, 50 por página: se pide más hasta encontrarlo.
  for (let i = 0; i < 20 && !(await fila.count()); i++) {
    const mas = ger.getByTestId('deudores-cargar-mas');
    if (!(await mas.count())) break;
    await mas.click();
    await ger.waitForResponse((x) => x.url().includes('/api/portfolio/debtors'), { timeout: T.respuesta });
  }
  r.ok(await aparece(fila, T.respuesta), `${socio.memberCode} está en la lista`);
  r.ok(await fila.getByText('Dado de baja', { exact: true }).count() === 1, 'con la insignia «Dado de baja»');
  await fila.getByRole('link', { name: 'Abrir ficha' }).click();
  await ger.waitForURL(`**/socios/${socio.id}`, { timeout: T.navegacion });
  r.ok(await aparece(ger.getByRole('button', { name: /^Cobrar/ }).first(), T.respuesta), 'su ficha le deja cobrar sin reactivarlo');
  await r.captura(ger, 'deudores-2-ficha');

  // ── 3. Sin los dados de baja ──────────────────────────────────────────────
  r.paso('sin dados de baja');
  await ger.goBack({ waitUntil: 'networkidle' });
  await ger.getByRole('heading', { name: 'Quién debe' }).waitFor({ timeout: T.respuesta });
  const sw = ger.getByRole('switch', { name: 'Incluir dados de baja' });
  r.ok(await sw.isChecked(), '«Incluir dados de baja» viene encendido');
  await sw.click();
  fila = ger.getByTestId('deudores-lista').getByTestId('deudor').filter({ hasText: socio.memberCode });
  r.ok(await desaparece(fila, T.respuesta), 'apagado, el dado de baja sale de la lista');

  // ── 4. La dueña ───────────────────────────────────────────────────────────
  r.paso('la dueña');
  const own = await r.como('duena');
  await own.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  r.ok(await aparece(own.getByText('El detalle de quién debe lo lleva la gerencia.'), T.respuesta) && await own.getByTestId('ver-quien-debe').count() === 0, 'en el Tablero de la dueña no hay enlace: «El detalle de quién debe lo lleva la gerencia.»');
  await own.goto(`${PANEL}/tablero/deudores`, { waitUntil: 'networkidle' });
  r.ok(await aparece(own.getByText('El detalle de quién debe lo lleva la gerencia'), T.respuesta) && await own.getByTestId('deudores-lista').count() === 0, 'y en /tablero/deudores, lo mismo, sin nombres');
}, { erroresDePagina: 'informa' });
