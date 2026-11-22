// A dónde apuntan los recorridos y las capturas: el perfil de PRUEBAS
// (`bash ~/gymflow-docs/scripts/gymflow.sh pruebas`), nunca el uso real
// (auditoría 8, fase 0.1). Se cambian con GYMFLOW_E2E_PANEL,
// GYMFLOW_E2E_PORTAL y GYMFLOW_E2E_API.
const limpia = (url) => url.replace(/\/$/, '');

export const PANEL = limpia(process.env.GYMFLOW_E2E_PANEL ?? 'http://localhost:4003');
export const PORTAL = limpia(process.env.GYMFLOW_E2E_PORTAL ?? 'http://localhost:4002');
export const API = limpia(process.env.GYMFLOW_E2E_API ?? 'http://127.0.0.1:4001');

// Los recorridos crean socios, cobros y sesiones: contra el uso real
// ensuciarían el gimnasio de verdad. Sus puertos no se aceptan.
const PUERTOS_USO_REAL = new Set(['3001', '3002', '3003']);
for (const [nombre, url] of Object.entries({ GYMFLOW_E2E_PANEL: PANEL, GYMFLOW_E2E_PORTAL: PORTAL, GYMFLOW_E2E_API: API })) {
  if (PUERTOS_USO_REAL.has(new URL(url).port)) {
    console.error(`FALLÓ: ${nombre}=${url} es del uso real; los recorridos solo corren contra las pruebas (4001-4003).`);
    process.exit(2);
  }
}
