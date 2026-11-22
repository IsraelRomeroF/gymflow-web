// Cobrar en efectivo o con tarjeta entra al corte de un turno de caja. Si en la
// sede hay varios turnos abiertos y ninguno es de quien cobra, el diálogo pide
// elegir la caja («Hay varias abiertas») y «Cobrar» espera a que se elija:
// es lo que haría la persona. Los recorridos no dependen de quién abrió hoy
// cada turno (lo cambian `caja` y `diseno`).

/** Si el cobro pide elegir caja y no hay una elegida, elige la primera. Devuelve si eligió. */
export async function elegirCaja(contenedor) {
  const caja = contenedor.locator('#caja');
  if ((await caja.count()) === 0 || !(await caja.isVisible())) return false;
  if (await caja.inputValue()) return false;
  const valores = await caja.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  if (!valores.length) return false;
  await caja.selectOption(valores[0]);
  return true;
}
