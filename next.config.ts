import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Cabeceras de seguridad (SEC-10). Nadie puede meter estas pantallas en un
 * iframe ajeno (clickjacking), no se filtra la ruta completa a otros sitios y
 * el navegador no adivina tipos de archivo. HSTS solo en producción: en local
 * se sirve por HTTP.
 */
const CABECERAS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

/**
 * Perfil de PRUEBAS (`gymflow.sh pruebas`: panel 4003, API 4001). Compila en
 * su propia carpeta y con su propio tsconfig para correr junto al uso real
 * (3003) sin pisar su compilación ni reescribir `tsconfig.json`. La carpeta va
 * dentro de `.next/` (ignorada por git) y empieza con `dev` porque la limpieza
 * de `next build` respeta esos nombres.
 */
const DIST_PRUEBAS = process.env.GYMFLOW_NEXT_DIST;
if (DIST_PRUEBAS && !/^\.next\/dev-[a-z]+$/.test(DIST_PRUEBAS)) {
  throw new Error(`GYMFLOW_NEXT_DIST debe ser una carpeta .next/dev-<nombre>; llegó «${DIST_PRUEBAS}»`);
}

/**
 * EL NÚCLEO POR `link:` (auditoría 8, 27-02): `@gymflow/core` es la carpeta
 * hermana `../gymflow-core`, enlazada en `node_modules` por pnpm. Turbopack no
 * resuelve archivos fuera de su raíz, así que la raíz es la carpeta que
 * contiene a los dos repositorios (solo vigila lo que de verdad lee). Sin
 * esto, importar `@gymflow/core/vocabulario` daría «Module not found».
 */
const RAIZ = path.resolve(process.cwd(), '..');

const config: NextConfig = {
  turbopack: { root: RAIZ },
  ...(DIST_PRUEBAS ? { distDir: DIST_PRUEBAS, typescript: { tsconfigPath: 'tsconfig.pruebas.json' } } : {}),
  reactStrictMode: true,
  // Next 16 escribe AGENTS.md y CLAUDE.md en la raíz al arrancar. Son
  // artefactos generados: el proyecto ya documenta sus convenciones, y dejar
  // que aparezcan sin control ensucia el repositorio en cada `next dev`.
  agentRules: false,
  // No anunciar el framework: es información gratis para quien busca fallas.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: CABECERAS }];
  },
  // El botón flotante de Next tapa el pie de la barra lateral en cada demo.
  devIndicators: false,
  // La API vive en otro origen (ADR-004, condición 2). En desarrollo se
  // proxian las llamadas para que la cookie de sesión funcione sin
  // configurar dominios hermanos en local. Sin `API_URL`, la del uso real
  // (3001); las pruebas la ponen en 4001. Con `next start` el destino queda
  // fijo al compilar: `gymflow.sh` compila el uso real con la suya.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? process.env.API_BASE_URL ?? 'http://127.0.0.1:3001'}/:path*` }];
  },
};

export default config;
