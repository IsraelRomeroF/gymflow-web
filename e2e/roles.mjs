// Roles y permisos (UX5-G-08): la matriz plegada por área, «Desplegar todo»,
// el tope de descuento de recepción y el filtro por rol.
import { recorrido, irPorMenu, T } from './lib/index.mjs';

await recorrido('roles', async (r) => {
  const p = await r.como('gerente');
  await irPorMenu(p, 'Personal');
  // «Roles y permisos» pasó a «Puestos» (fase 2 · 2.7, 17-12).
  await p.getByRole('link', { name: 'Puestos', exact: true }).click();
  await p.locator('[data-area="members"]').waitFor({ timeout: T.respuesta });
  // Plegada por área (UX5-G-08): cada área en una línea; nada desplegado de entrada.
  r.ok(await p.locator('details.area-plegable').count() >= 10, `matriz por áreas (${await p.locator('details.area-plegable').count()} áreas)`);
  r.ok(await p.locator('details.area-plegable[open]').count() === 0, 'las áreas nacen plegadas');
  await p.getByRole('button', { name: 'Desplegar todo' }).click();
  r.ok(await p.locator('details.area-plegable[open]').count() >= 10 && await p.locator('table').first().isVisible(), 'desplegar todo abre la matriz completa');
  r.ok(await p.getByText('Descuento: hasta 10 %').count() === 1, 'recepción muestra su tope de descuento');
  await r.captura(p, 'roles');
  await p.getByRole('button', { name: 'Coach' }).click();
  r.ok(await p.locator('table').first().locator('thead th').count() === 2, 'filtrar a un rol deja una columna');
});
