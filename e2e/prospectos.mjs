// Prospectos (auditoría 8, fase 0.10: 10-02 y confirmaciones que nombran a la
// persona). «Perdido» salió de la fila: vive en «Más acciones de …» como «Ya no
// se va a inscribir» y su confirmación dice el nombre completo. En la fase 0 esa
// confirmación no pedía motivo. Fase 2, bloque 2.4: la acción de la fila es
// «Contactar», la etapa sale de los contactos, cerrar pide el motivo de una
// lista corta (y «No le interesa» cierra en el mismo paso, por eso aquí el
// contacto es «No contestó»), y «Reabrir» lo devuelve a «Te toca hoy». En el
// teléfono, los botones de cada prospecto quedan dentro de su tarjeta.
// Fase 1.17a: al terminar, el prospecto de la corrida se cierra como perdido
// (antes se quedaba en seguimiento, uno más por corrida).
import { recorrido, letras, celular, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('prospectos', async (r) => {
  const nombre = `Fernanda${letras(4).toLowerCase()}`;
  const completo = `${nombre} Seguimiento`;
  const g = await r.api('gerencia');
  r.alFinal(async () => {
    // `GET /prospects` viaja por páginas (bloque 1.6): los renglones van en `items`.
    const suyo = (await g.get('/prospects?limit=200')).items.find((x) => x.firstName === nombre);
    // Cerrar tiene su ruta y pide motivo (bloque 2.4); antes era `PATCH { status: 'LOST' }`.
    if (suyo && suyo.status !== 'LOST') await g.post(`/prospects/${suyo.id}/close`, { reasonCode: 'OTRO', note: 'Fin del recorrido' });
  });

  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/prospectos`, { waitUntil: 'networkidle' });
  await rec.getByRole('button', { name: 'Nuevo prospecto' }).first().click();
  let d = rec.getByRole('dialog');
  await d.getByLabel('Nombre').fill(nombre);
  await d.getByLabel('Apellidos').fill('Seguimiento');
  await d.getByLabel('Celular').fill(celular());
  await d.getByRole('button', { name: 'Registrar' }).click();
  const fila = rec.getByRole('row', { name: new RegExp(nombre) });
  await fila.waitFor({ timeout: T.respuesta });
  r.ok(await fila.getByRole('button', { name: /^Perdido$/ }).count() === 0, '«Perdido» ya no está suelto en la fila');

  // El contacto queda en la fila, con su próximo paso ya puesto («No contestó» → mañana).
  r.paso('contactar');
  await fila.getByRole('button', { name: 'Contactar' }).click();
  d = rec.getByRole('dialog');
  await d.getByRole('radio', { name: 'Llamada' }).click();
  await d.getByRole('radio', { name: 'No contestó', exact: true }).click();
  await d.getByLabel('Nota (opcional)').fill('Le queda lejos de su casa');
  await d.getByRole('button', { name: 'Registrar contacto' }).click();
  await d.waitFor({ state: 'hidden', timeout: T.ui });
  await fila.getByTestId('ultimo-contacto').filter({ hasText: 'No contestó' }).waitFor({ timeout: T.respuesta });
  r.ok(true, 'el contacto queda en la fila: «No contestó»');
  r.ok(await fila.getByText(/Próximo:/).count() === 1, 'y la fila dice cuándo vuelve a tocar');

  // «Ya no se va a inscribir», desde «Más acciones de …», con su nombre en la confirmación.
  r.paso('ya no se va a inscribir');
  await fila.getByRole('button', { name: `Más acciones de ${completo}` }).click();
  await rec.getByRole('menuitem', { name: 'Ya no se va a inscribir' }).click();
  const conf = rec.getByRole('dialog', { name: `¿${completo} ya no se va a inscribir?` });
  r.ok(await aparece(conf, T.ui), `la confirmación nombra a la persona: «¿${completo} ya no se va a inscribir?»`);
  r.ok(await conf.getByText(/No se borra nada/).count() === 1, 'y dice que no se borra nada');
  await r.captura(rec, 'prospectos-1-confirmar-perdido');
  await conf.getByRole('button', { name: 'Cancelar' }).click();
  r.ok(await fila.count() === 1, '«Cancelar» lo deja en seguimiento');
  await fila.getByRole('button', { name: `Más acciones de ${completo}` }).click();
  await rec.getByRole('menuitem', { name: 'Ya no se va a inscribir' }).click();
  // Cerrar pide el porqué, de una lista corta (bloque 2.4, 10-09).
  await conf.getByRole('button', { name: 'Marcar como perdido' }).click();
  r.ok(await aparece(conf.getByText('Elige un motivo.'), T.ui), 'sin motivo no se cierra: lo pide');
  await conf.getByRole('radio', { name: 'Le queda lejos' }).click();
  await conf.getByRole('button', { name: 'Marcar como perdido' }).click();
  await fila.waitFor({ state: 'detached', timeout: T.respuesta });
  r.ok(true, 'marcado como perdido, sale de «En seguimiento»');
  await rec.getByRole('button', { name: /^Cerrados/ }).click();
  const cerrada = rec.getByRole('row', { name: new RegExp(nombre) });
  await cerrada.waitFor({ timeout: T.respuesta });
  r.ok(await cerrada.getByText('Perdido', { exact: true }).count() === 1 && await cerrada.getByText(/No contestó/).count() === 1 && await cerrada.getByText(/Le queda lejos/).count() >= 1, 'en «Cerrados»: Perdido, con su último contacto y el motivo');
  await r.captura(rec, 'prospectos-2-cerrados');
  await cerrada.getByRole('button', { name: 'Reabrir' }).click();
  await cerrada.waitFor({ state: 'detached', timeout: T.respuesta });
  await rec.getByRole('button', { name: /^En seguimiento/ }).click();
  r.ok(await aparece(rec.getByRole('row', { name: new RegExp(nombre) }), T.respuesta), '«Reabrir» lo devuelve a seguimiento');

  // En el teléfono: cada tarjeta contiene sus botones (antes «Perdido» se pintaba sobre la siguiente).
  r.paso('teléfono');
  const tel = await r.como('recepcion', { movil: true });
  await tel.goto(`${PANEL}/prospectos`, { waitUntil: 'networkidle' });
  await tel.locator('tbody tr').first().waitFor({ timeout: T.respuesta });
  const fuera = await tel.locator('tbody tr').evaluateAll((trs) => trs.flatMap((tr) => {
    const rc = tr.getBoundingClientRect();
    return [...tr.querySelectorAll('button, select')].filter((b) => { const x = b.getBoundingClientRect(); return x.width > 0 && (x.top < rc.top - 1 || x.bottom > rc.bottom + 1 || x.left < rc.left - 1 || x.right > rc.right + 1); })
      .map((b) => `${tr.querySelector('.strong')?.textContent ?? '?'}: ${b.getAttribute('aria-label') ?? b.textContent}`);
  }));
  r.ok(fuera.length === 0, `en el teléfono ningún botón se sale de su tarjeta${fuera.length ? `: ${fuera.slice(0, 3).join(' | ')}` : ''}`);
  r.ok(await tel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'y la pantalla no se desborda de lado');
  await tel.getByRole('button', { name: `Más acciones de ${completo}` }).click();
  r.ok(await tel.getByRole('menuitem', { name: 'Ya no se va a inscribir' }).isVisible(), '«Más» abre su menú en el teléfono');
  await r.captura(tel, 'prospectos-3-movil-mas');
  await tel.keyboard.press('Escape');
}, { erroresDePagina: 'falla' });
