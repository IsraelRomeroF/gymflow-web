// El menú lateral del panel: abrir sus secciones plegadas e ir a una pantalla
// por su nombre, como lo haría una persona.

/** Despliega las secciones plegadas del menú lateral, para ver todo lo que hay. */
export async function abrirMenu(page) {
  // El menú llega con la sesión: hasta entonces no hay secciones que abrir.
  await page.locator('.side-nav .side-link').first().waitFor();
  const plegadas = page.locator('button.side-group-title[aria-expanded="false"]');
  // De una en una: al abrir una sección, la lista de plegadas cambia.
  while (await plegadas.count()) await plegadas.first().click();
}

/** Va a una pantalla por el menú lateral; si su sección está plegada, la abre. */
export async function irPorMenu(page, nombre) {
  await page.locator('.side-nav .side-link').first().waitFor();
  const enlace = page.getByRole('link', { name: nombre, exact: true });
  if ((await enlace.count()) === 0) await abrirMenu(page);
  await enlace.click();
}
