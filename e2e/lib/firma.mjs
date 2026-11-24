// La firma en el mostrador (fase 3, bloque 3.13): el diálogo «Autorizar …»
// se abre con «Aquí, en este equipo» elegido; quien autoriza teclea su
// contraseña. Con una sola persona que firma ya viene elegida («Firma: …»);
// con varias, se toma la que viene en «Quién autoriza».
//
//   const f = await firmar(p, /^Autorizar la devolución de \$/);
//   const resp = await accion(p, () => f.autorizar(), '/api/…', { metodo: 'POST' });
import { CLAVE_PRUEBAS, T } from './entorno.mjs';

/** Espera el diálogo de autorización con ese título y deja la contraseña escrita. `autorizar()` pulsa «Autorizar». */
export async function firmar(page, titulo, { clave = CLAVE_PRUEBAS } = {}) {
  const d = page.getByRole('dialog', { name: titulo });
  await d.getByLabel('Su contraseña').waitFor({ timeout: T.respuesta });
  const lista = d.getByLabel('Quién autoriza');
  const quien = (await lista.count())
    ? `firma ${(await lista.locator('option:checked').innerText()).trim()}`
    : (await d.getByText(/^Firma: /).innerText()).trim();
  await d.getByLabel('Su contraseña').fill(clave);
  return { d, quien, autorizar: () => d.getByRole('button', { name: 'Autorizar', exact: true }).click() };
}
