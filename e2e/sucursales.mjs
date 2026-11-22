// Sucursales (fase 1.14: 19-01, 19-03, 19-06, 19-07, 19-10). La dueña las ve en
// consulta, sin botones; la zona de cada sede hereda la del gimnasio («Igual
// que el gimnasio»); cerrar una sede tiene su propio diálogo con motivo y no
// deja cerrarla con turno abierto ni con personal asignado; la única caja de
// una sede no se retira y lleva a «Dejar de usar Caja» ahí (con Punto de venta
// primero, que la necesita); y una sede cerrada se reabre.
//
// Datos propios: lo que se cierra, se deja de usar y se reabre es una sucursal
// de esta corrida (código y nombre con sufijo), que queda cerrada al terminar.
// Centro solo se mira: el diálogo de cierre se abre y se cancela.
import { recorrido, abrirMenu, accion, asentado, aparece, letras, PANEL, T } from './lib/index.mjs';

await recorrido('sucursales', async (r) => {
  const g = await r.api('gerencia');
  const L = letras(3).toUpperCase();
  const codigo = `Z${L}`;
  const nombre = `Prueba ${L}`;
  r.alFinal(async () => {
    const b = (await g.get('/branches')).find((x) => x.code === codigo && x.isActive);
    if (b) await g.patch(`/branches/${b.id}`, { isActive: false, reason: 'Sucursal de un recorrido de prueba' });
  });
  const tarjeta = (p, sede) => p.locator('.card').filter({ has: p.locator('.card-title', { hasText: new RegExp(`^${sede}$`) }) });

  // 1. La dueña: Sucursales en su menú, en consulta.
  r.paso('la dueña en consulta');
  const own = await r.como('duena');
  await abrirMenu(own);
  r.ok(await own.locator('.side-nav').getByRole('link', { name: 'Mi gimnasio', exact: true }).count() === 1, 'la dueña tiene «Mi gimnasio» (con Sucursales) en su menú'); // 2.12: una entrada, antes «Sucursales»
  await own.goto(`${PANEL}/sucursales`, { waitUntil: 'networkidle' });
  await tarjeta(own, 'Centro').waitFor({ timeout: T.respuesta });
  await asentado(own);
  r.ok(await own.getByText('Aquí consultas tus sucursales, sus cajas y su enlace del alta. Las abre, las cambia y las cierra la gerencia.').count() === 1, 'le dice que ahí consulta y que la gerencia las cambia');
  r.ok(await own.getByRole('button', { name: /Abrir sucursal|Editar|Agregar caja|Cerrar sucursal/ }).count() === 0, 'sin botones para abrir, editar ni cerrar');
  r.ok(await tarjeta(own, 'Centro').locator('button.chip').count() === 0 && await tarjeta(own, 'Centro').locator('.badge').filter({ hasText: /Caja/ }).count() > 0, 'las cajas se leen como insignias, no como botones');
  await r.captura(own, 'sucursales-1-duena');
  // En una pantalla de 1024 px (la de muchos mostradores), lo de cada sede cabe en su tarjeta:
  // las cajas no se salen y los datos no se parten letra por letra.
  await own.setViewportSize({ width: 1024, height: 900 });
  await asentado(own);
  const enCentro = await tarjeta(own, 'Centro').evaluate((card) => {
    const c = card.getBoundingClientRect();
    const fuera = [...card.querySelectorAll('.badge, .chip, dd')].filter((e) => e.getBoundingClientRect().right > c.right + 2)
      .map((e) => `«${e.textContent.trim().slice(0, 20)}» +${Math.round(e.getBoundingClientRect().right - c.right)}px`);
    const dd = card.querySelector('.kv dd');
    return { fuera, columna: dd ? Math.round(dd.getBoundingClientRect().width) : null, tarjeta: Math.round(c.width) };
  });
  if (enCentro.fuera.length || (enCentro.columna ?? 999) < 80) await r.captura(own, 'sucursales-1b-duena-1024', { full: true });
  r.ok(enCentro.fuera.length === 0 && (enCentro.columna ?? 999) >= 80, `a 1024 px, lo de Centro cabe en su tarjeta (tarjeta de ${enCentro.tarjeta} px, columna de datos de ${enCentro.columna} px${enCentro.fuera.length ? `; fuera: ${enCentro.fuera.join(', ')}` : ''})${enCentro.fuera.length || (enCentro.columna ?? 999) < 80 ? ' (DEFECTO, ver 1.17a-recorridos.md)' : ''}`);
  await own.setViewportSize({ width: 1440, height: 900 });

  // 2. La zona: «Igual que el gimnasio» (19-10).
  r.paso('zona heredada');
  const ger = await r.como('gerencia');
  await ger.goto(`${PANEL}/sucursales`, { waitUntil: 'networkidle' });
  await tarjeta(ger, 'Centro').waitFor({ timeout: T.respuesta });
  r.ok(/la del gimnasio/.test(await tarjeta(ger, 'Centro').innerText()), 'la tarjeta de Centro dice que su zona es «la del gimnasio»');
  await tarjeta(ger, 'Centro').getByRole('button', { name: 'Editar' }).click();
  const edCentro = ger.getByRole('dialog', { name: 'Editar Centro' });
  await edCentro.waitFor({ timeout: T.ui });
  const zona = edCentro.locator('#sd-zona');
  r.ok(await zona.inputValue() === '' && /^Igual que el gimnasio · /.test(await zona.locator('option:checked').innerText()), `y al editarla, el selector dice «${(await zona.locator('option:checked').innerText()).trim()}»`);

  // 3. Cerrar Centro: su diálogo dice qué se lleva y no deja cerrarla con turno abierto ni con personal.
  r.paso('cerrar Centro bloqueado');
  await edCentro.getByRole('button', { name: /^Cerrar sucursal/ }).click();
  const cierreCentro = ger.getByRole('dialog', { name: 'Cerrar Centro' });
  await cierreCentro.getByText('Al cerrarla').waitFor({ timeout: T.respuesta });
  const conPersonal = await cierreCentro.getByText(/^Tiene (una persona asignada|\d+ personas asignadas)$/).count() > 0;
  const conTurno = await cierreCentro.getByText('Tiene caja abierta: no se puede cerrar').count() > 0;
  r.ok(conPersonal && /Paola Núñez/.test(await cierreCentro.innerText()), 'con personal asignado (Paola) lo dice con su nombre y la manda a Personal');
  r.ok(await cierreCentro.getByRole('button', { name: 'Cerrar Centro' }).isDisabled(), `y no deja cerrarla${conTurno ? ' (además tiene un turno de caja abierto)' : ''}`);
  await r.captura(ger, 'sucursales-2-cerrar-centro-bloqueado');
  await cierreCentro.getByRole('button', { name: 'Volver' }).click();

  // 4. Una sucursal de esta corrida: nace con su caja.
  r.paso('sucursal nueva');
  await ger.getByRole('button', { name: 'Abrir sucursal', exact: true }).click();
  const abrir = ger.getByRole('dialog', { name: 'Abrir sucursal' });
  await abrir.getByLabel('Código').fill(codigo);
  // Las tres primeras letras del código son el prefijo de sus socios.
  r.ok(await aparece(abrir.getByText(new RegExp(`se numeran ${codigo.slice(0, 3)}-00001`)), T.ui), `antes de abrirla dice cómo se numeran sus socios (${codigo.slice(0, 3)}-00001)`);
  await abrir.getByLabel('Nombre').fill(nombre);
  await abrir.getByRole('button', { name: 'Abrir sucursal', exact: true }).click();
  await ger.getByText(/abierta con su primera caja/).waitFor({ timeout: T.respuesta });
  const propia = tarjeta(ger, nombre);
  await propia.getByText(`Caja 1 ${codigo}`).waitFor({ timeout: T.respuesta });
  r.ok(true, 'la sucursal nueva nace con su caja');

  // 5. Su única caja no se retira: lleva a «Dejar de usar Caja» en esa sede (19-07, 19-01).
  r.paso('dejar de usar caja en la sede');
  await propia.getByRole('button', { name: new RegExp(`Caja 1 ${codigo}`) }).click();
  const caja = ger.getByRole('dialog', { name: `Caja Caja 1 ${codigo}` });
  await caja.waitFor({ timeout: T.ui });
  r.ok(await caja.getByText(`Es la única caja de ${nombre}`).count() === 1 && await caja.getByRole('button', { name: 'Retirar caja' }).isDisabled(), `«Es la única caja de ${nombre}»: no se retira`);
  await r.captura(ger, 'sucursales-3-caja-unica');
  await caja.getByRole('link', { name: `Dejar de usar Caja en ${nombre}` }).click();
  await ger.waitForURL(/\/modulos\?modulo=cash&sede=/, { timeout: T.respuesta });
  const antes = ger.getByRole('dialog', { name: `No se puede dejar de usar Caja en ${nombre} todavía` });
  r.ok(await aparece(antes, T.respuesta) && /Punto de venta lo necesita/.test(await antes.innerText()), 'Módulos dice que ahí Punto de venta necesita Caja');
  await antes.getByRole('button', { name: 'Dejar de usar Punto de venta ahí primero' }).click();
  const pos = ger.getByRole('dialog', { name: `Dejar de usar Punto de venta en ${nombre}` });
  await pos.getByRole('button', { name: 'Es temporal' }).click();
  await accion(ger, () => pos.getByRole('button', { name: `Dejar de usar en ${nombre}` }).click(), /\/api\/organization\/modules\/pos\/branches\/[^/]+$/, { metodo: 'PUT', que: 'dejar de usar Punto de venta' });
  await ger.getByText(`Punto de venta dejó de usarse en ${nombre}.`).waitFor({ timeout: T.respuesta });
  const sedeId = new URL(ger.url()).searchParams.get('sede');
  await ger.goto(`${PANEL}/modulos?modulo=cash&sede=${sedeId}`, { waitUntil: 'networkidle' });
  const sinCaja = ger.getByRole('dialog', { name: `Dejar de usar Caja en ${nombre}` });
  await sinCaja.waitFor({ timeout: T.respuesta });
  r.ok(/se sigue cobrando, sin turno ni corte/.test(await sinCaja.innerText()), 'dejar de usar Caja en la sede dice que ahí se cobra sin turno ni corte');
  await sinCaja.getByRole('button', { name: 'Es temporal' }).click();
  await accion(ger, () => sinCaja.getByRole('button', { name: `Dejar de usar en ${nombre}` }).click(), /\/api\/organization\/modules\/cash\/branches\/[^/]+$/, { metodo: 'PUT', que: 'dejar de usar Caja' });
  await ger.getByText(`Caja dejó de usarse en ${nombre}.`).waitFor({ timeout: T.respuesta });
  await ger.goto(`${PANEL}/sucursales`, { waitUntil: 'networkidle' });
  await tarjeta(ger, nombre).waitFor({ timeout: T.respuesta });
  r.ok(await tarjeta(ger, nombre).getByText('No lleva Caja: cobra sin corte').count() === 1, 'y su tarjeta dice «No lleva Caja: cobra sin corte»');

  // 6. Cerrarla con motivo, y reabrirla.
  r.paso('cerrar y reabrir');
  await tarjeta(ger, nombre).getByRole('button', { name: 'Editar' }).click();
  await ger.getByRole('dialog', { name: `Editar ${nombre}` }).getByRole('button', { name: /^Cerrar sucursal/ }).click();
  const cierre = ger.getByRole('dialog', { name: `Cerrar ${nombre}` });
  await cierre.getByText('Al cerrarla').waitFor({ timeout: T.respuesta });
  r.ok(await cierre.getByRole('button', { name: `Cerrar ${nombre}` }).isDisabled(), 'sin motivo no se cierra');
  await cierre.getByRole('button', { name: 'Es temporal', exact: true }).click();
  r.ok(await cierre.getByRole('button', { name: `Cerrar ${nombre}` }).isEnabled(), 'con un motivo de un toque, sí');
  await r.captura(ger, 'sucursales-4-cerrar-con-motivo');
  await cierre.getByRole('button', { name: `Cerrar ${nombre}` }).click();
  await ger.getByText(`${nombre} quedó cerrada`).waitFor({ timeout: T.respuesta });
  await asentado(ger);
  r.ok(await tarjeta(ger, nombre).getByText('Cerrada', { exact: true }).count() === 1 && await tarjeta(ger, nombre).getByRole('button', { name: 'Reabrir sucursal' }).count() === 1, 'la tarjeta queda «Cerrada», con «Reabrir sucursal»');
  const asiento = (await g.get(`/audit?resourceId=${sedeId}&limit=20`)).entries.find((e) => e.reason === 'Es temporal');
  r.ok(!!asiento, `el motivo queda en la bitácora (${asiento?.action ?? 'sin asiento'})`);
  await tarjeta(ger, nombre).getByRole('button', { name: 'Reabrir sucursal' }).click();
  await ger.getByRole('dialog', { name: `¿Reabrir ${nombre}?` }).getByRole('button', { name: 'Reabrir' }).click();
  await ger.getByText(`${nombre} está abierta otra vez`).waitFor({ timeout: T.respuesta });
  r.ok(true, 'y se reabre sin pedir motivo');
}, { erroresDePagina: 'falla' });
