import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const nodeGlobals = {
  process: "readonly", console: "readonly", Buffer: "readonly",
  __dirname: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
  setInterval: "readonly", clearInterval: "readonly", URL: "readonly",
  URLSearchParams: "readonly", TextEncoder: "readonly", TextDecoder: "readonly",
  fetch: "readonly", NodeJS: "readonly", crypto: "readonly",
};

// Los `catch` que esconden un error como un vacío: `.catch(() => setX([]))`,
// `.catch(() => { setX({}); })`, `.catch(() => setX(0))` y `.catch(() => [])`.
// Con algo más dentro (guardar el error, avisar) ya no son silenciosos.
const MENSAJE_CATCH = "Un error de carga no se muestra como «no hay nada» (26-01): usa useCarga/EstadoCarga (lib/carga.tsx) o guarda el error y dilo.";
const VACIO = (ruta) => [
  `[${ruta}.type='ArrayExpression'][${ruta}.elements.length=0]`,
  `[${ruta}.type='ObjectExpression'][${ruta}.properties.length=0]`,
  `[${ruta}.type='Literal'][${ruta}.value=0]`,
];
const MANEJADOR = "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression";
const CATCH_SILENCIOSO = [
  // .catch(() => setX([]))
  ...VACIO("body.arguments.0").map((v) => `${MANEJADOR}[body.type='CallExpression'][body.callee.name=/^set[A-Z]/][body.arguments.length=1]${v}`),
  // .catch(() => { setX([]); })
  ...VACIO("body.body.0.expression.arguments.0").map((v) => `${MANEJADOR}[body.type='BlockStatement'][body.body.length=1][body.body.0.expression.callee.name=/^set[A-Z]/]${v}`),
  // .catch(() => []) y .catch(() => 0)
  `${MANEJADOR}[body.type='ArrayExpression'][body.elements.length=0]`,
  `${MANEJADOR}[body.type='Literal'][body.value=0]`,
].map((selector) => ({ selector, message: MENSAJE_CATCH }));

// FRONTERAS ENTRE CAPAS DEL PANEL (27-10, bloque 1.17b). El backend prohíbe por
// máquina que un módulo use las tripas de otro (`test/module-boundaries.test.ts`);
// aquí la regla es por capas, que es lo que hoy se cumple y se puede sostener:
//
//   app/ (pantallas)  →  components/ (piezas)  →  lib/ y modules/ (reglas y datos)
//                         components/ui/ (piezas de diseño: no conocen las de negocio)
//
// Una capa de abajo no importa de una de arriba. Lo que hoy lo incumple está en
// EXCEPCIONES con su porqué; esa lista no debe crecer.
const DE_APP = ["@/app/**", "../app/**", "../../app/**", "../../../app/**"];
const DE_COMPONENTES = ["@/components/**", "../components/**", "../../components/**"];
const frontera = (grupos) => ["error", { patterns: grupos.map(([group, message]) => ({ group, message })) }];
const NO_PANTALLAS = [DE_APP, "Una pieza o una regla no importa de una pantalla (app/): si dos pantallas lo usan, se mueve a components/ o a lib/ (27-10)."];
const NO_PIEZAS = [DE_COMPONENTES, "lib/ y modules/ son reglas y datos: no importan piezas de components/. Si hace falta un tipo, se declara aquí o en el núcleo (27-10)."];
const NO_NEGOCIO = [
  ["@/components/*", "../*", "!../compartido", "!@/components/compartido", "!@/components/session", "!@/components/ui", "!@/components/ui/**"],
  "components/ui/ son piezas de diseño: no importan piezas de negocio (solo compartido y la sesión) (27-10).",
];
const EXCEPCIONES = {
  // Envuelve `ErrorCarga` y `Skeleton` de compartido: es una pieza con forma de regla. Mudarla a components/ toca 40 pantallas.
  "lib/carga.tsx": NO_PANTALLAS,
  // Solo importa el TIPO `ResumenAcceso` de components/acceso: el tipo debería vivir en el contrato del núcleo.
  "lib/resumen-acceso.ts": NO_PANTALLAS,
};

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  { languageOptions: { globals: { ...nodeGlobals, window: "readonly", document: "readonly", localStorage: "readonly", HTMLInputElement: "readonly", AbortController: "readonly" } } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    // Las reglas de los hooks: un efecto con dependencias de más o de menos
    // es de los errores que no avisan (OPT-09).
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // UN ERROR DE CARGA NO ES «NO HAY NADA» (26-01, fase 1.5): un `catch` que
      // solo deja la lista vacía (o el objeto vacío, o el cero) hace que «sin
      // red» se lea «sin planes», «sin personal», «0 días que viniste». Con la
      // red caída, recepción concluía que el plan no existía. Se usa `useCarga`
      // y `EstadoCarga` (lib/carga.tsx), o se guarda el error y se dice.
      "no-restricted-syntax": ["error", ...CATCH_SILENCIOSO],
    },
  },
  { files: ["components/**/*.{ts,tsx}"], rules: { "no-restricted-imports": frontera([NO_PANTALLAS]) } },
  { files: ["components/ui/**/*.{ts,tsx}"], rules: { "no-restricted-imports": frontera([NO_PANTALLAS, NO_NEGOCIO]) } },
  { files: ["lib/**/*.{ts,tsx}", "modules/**/*.{ts,tsx}"], rules: { "no-restricted-imports": frontera([NO_PANTALLAS, NO_PIEZAS]) } },
  ...Object.entries(EXCEPCIONES).map(([archivo, regla]) => ({ files: [archivo], rules: { "no-restricted-imports": frontera([regla]) } })),
);
