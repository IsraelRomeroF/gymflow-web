import { LayoutDashboard, Users, Inbox, DoorOpen, ChartColumnBig, ArrowLeftRight, ScanFace, FileSignature, Tags, CalendarDays, Wallet, ShoppingCart, Sparkles, HeartHandshake, Package, UserCog, Building2, History, Stamp, Blocks, FileUp, type LucideIcon, ListChecks, MessageCircle, CircleDollarSign } from 'lucide-react';
import { OPEN_BY_ROLE_SECTIONS, SECTION_GROUP_NAMES } from '@gymflow/core/secciones';

/**
 * REGISTRO DE SECCIONES DEL PANEL (ADR-036).
 *
 * Cada pantalla del panel se declara aquí UNA vez: a qué módulo pertenece,
 * quién la ve y cómo se llega a ella. De esta lista salen el menú, la puerta
 * que protege cada ruta, el buscador y los accesos rápidos del inicio. Antes
 * eran cuatro listas escritas a mano que ya no decían lo mismo.
 *
 * `modulo` es la clave del catálogo de la API (`@gymflow/core`): si el
 * gimnasio lo tiene apagado, la sección no existe para nadie.
 */
export type Grupo = 'operacion' | 'direccion' | 'cumplimiento';

/** Los nombres de los grupos, los mismos de la llave del dueño (núcleo). */
export const GRUPOS: Readonly<Record<Grupo, string>> = SECTION_GROUP_NAMES;

export type Seccion = {
  modulo: string;
  href: string;
  etiqueta: string;
  icono: LucideIcon;
  grupo: Grupo;
  /** La ve quien tenga ALGUNO. Sin lista: cualquiera con sesión. */
  permisos?: readonly string[];
  /** También la ve quien tenga este rol, aunque no tenga el permiso. */
  roles?: readonly string[];
  /** De quién es la pantalla, para decírselo a quien llega y no la ve. */
  paraQuien: string;
  /** Otras rutas de la misma sección que no tienen entrada propia en el menú. */
  rutas?: readonly string[];
  /** Qué número pendiente lleva en el menú. */
  contador?: 'altas' | 'firmas';
  /** Con qué otras palabras se encuentra en el buscador. */
  palabras?: readonly string[];
  /** Acceso rápido en el inicio de quien opera. */
  atajo?: { titulo: string; texto: string };
  /**
   * Sección bajo llave del dueño (2026-10-06): además del permiso, hace falta
   * que el dueño se la haya liberado a esta persona. La clave es la de
   * `LOCKABLE_SECTIONS` en el núcleo.
   */
  llave?: string;
  /**
   * Los puestos que traen la sección, sin mirar la llave. Lo lleva toda
   * sección con llave: la sesión llega sin lo que el dueño cerró, así que sin
   * esta lista no se distingue «tu puesto no la ve» de «el dueño no te la
   * liberó» (27-06). `registro.test.ts` la compara con los puestos del núcleo.
   */
  puestos?: readonly string[];
};

/** Quien da la segunda firma ve la bandeja de Autorizaciones: el dueño (2026-10-05). */
export const FIRMAS = ['approvals:grant'] as const;

export const SECCIONES: readonly Seccion[] = [
  // ── Operación ─────────────────────────────────────────────────────────────
  // /arranque es la lista de primer arranque (ADR-038): vive bajo Inicio, sin entrada propia en el menú.
  { modulo: 'core', href: '/panel', etiqueta: 'Inicio', icono: LayoutDashboard, grupo: 'operacion', paraQuien: 'todo el personal', rutas: ['/arranque'] },
  {
    modulo: 'cash', href: '/caja', etiqueta: 'Caja', icono: Wallet, grupo: 'operacion', permisos: ['cash:session:read'], llave: 'caja', puestos: ['OWNER', 'MANAGER', 'RECEPTION'],
    paraQuien: 'Recepción y Gerencia', palabras: ['corte', 'turno', 'retiro', 'efectivo'],
  },
  {
    // La cámara de la PC de recepción como lector facial (2026-10-09), como las estaciones de HRFlow.
    modulo: 'biometrics', href: '/estacion', etiqueta: 'Estación de acceso', icono: ScanFace, grupo: 'operacion', permisos: ['access:monitor'],
    paraQuien: 'Recepción y Gerencia', palabras: ['cámara', 'rostro', 'reconocimiento', 'entrada', 'facial'],
  },
  {
    modulo: 'pos', href: '/punto-de-venta', etiqueta: 'Punto de venta', icono: ShoppingCart, grupo: 'operacion', permisos: ['pos:sale:create'], llave: 'pos', puestos: ['MANAGER', 'RECEPTION'],
    paraQuien: 'Recepción y Gerencia', palabras: ['tienda', 'vender', 'venta', 'producto'],
  },
  {
    // El mostrador y el padrón en una sola pantalla (2026-10-07): `/recepcion` redirige aquí.
    modulo: 'core', href: '/socios', etiqueta: 'Socios', icono: Users, grupo: 'operacion', permisos: ['members:read'], rutas: ['/recepcion'],
    paraQuien: 'Recepción, Coach y Gerencia', palabras: ['padrón', 'miembros', 'clientes', 'mostrador', 'entrada', 'buscar socio'],
    atajo: { titulo: 'Buscar socio', texto: 'Nombre, código o teléfono; abajo, el padrón' },
  },
  {
    modulo: 'intake', href: '/altas', etiqueta: 'Altas digitales', icono: Inbox, grupo: 'operacion', permisos: ['members:intake:read'],
    paraQuien: 'Recepción y Gerencia', contador: 'altas', palabras: ['registro', 'inscripción', 'qr', 'cartel'],
    atajo: { titulo: 'Altas digitales', texto: 'Revisar y aprobar' },
  },
  {
    modulo: 'prospects', href: '/prospectos', etiqueta: 'Prospectos', icono: Sparkles, grupo: 'operacion', permisos: ['members:create'],
    paraQuien: 'Recepción y Gerencia', palabras: ['interesados', 'seguimiento', 'ventas'],
  },
  {
    // Bandeja de salida (2.9, D-34): los WhatsApp que recepción manda con un toque. Ni la dueña ni el coach (D-30).
    modulo: 'core', href: '/mensajes', etiqueta: 'Mensajes', icono: MessageCircle, grupo: 'operacion', permisos: ['members:message:send'],
    paraQuien: 'Recepción y Gerencia', palabras: ['whatsapp', 'recordatorios', 'cobranza', 'avisos', 'por mandar', 'pagos vencidos'],
  },
  {
    modulo: 'classes', href: '/clases', etiqueta: 'Clases', icono: CalendarDays, grupo: 'operacion', permisos: ['classes:read'],
    paraQuien: 'Coach, Recepción y Gerencia', palabras: ['horario', 'reservas', 'pase de lista', 'cupo'],
  },
  {
    modulo: 'training', href: '/rutinas', etiqueta: 'Rutinas', icono: ListChecks, grupo: 'operacion', permisos: ['training:template:manage'],
    paraQuien: 'Coach y Gerencia', palabras: ['ejercicios', 'entrenamiento'],
  },
  // Nace apagado: sin equipo en la entrada, el monitor solo mostraría una lista vacía.
  {
    modulo: 'turnstile', href: '/acceso', etiqueta: 'Accesos', icono: DoorOpen, grupo: 'operacion', permisos: ['access:monitor'],
    paraQuien: 'Recepción y Gerencia', palabras: ['torniquete', 'entradas', 'monitor'],
  },
  // Lista de precios (2.7, 16-02): solo consulta, sin llave; lo que recepción enseña al cliente. Armar los planes sigue en Dirección. Con ícono propio (2.12): antes repetía el de Planes.
  { modulo: 'core', href: '/precios', etiqueta: 'Lista de precios', icono: CircleDollarSign, grupo: 'operacion', permisos: ['catalog:read'], paraQuien: 'todo el personal', palabras: ['precios', 'cuánto cuesta', 'planes', 'membresías', 'tarifas'] },

  // ── Dirección ─────────────────────────────────────────────────────────────
  {
    modulo: 'core', href: '/tablero', llave: 'tablero', puestos: ['OWNER', 'MANAGER'], etiqueta: 'Tablero', icono: ChartColumnBig, grupo: 'direccion', permisos: ['reports:financial:read'],
    paraQuien: 'la Dueña y Gerencia', palabras: ['reportes', 'ingresos', 'indicadores', 'cuentas'],
  },
  {
    modulo: 'core', href: '/movimientos', llave: 'movimientos', puestos: ['OWNER', 'MANAGER'], etiqueta: 'Movimientos', icono: ArrowLeftRight, grupo: 'direccion', permisos: ['reports:financial:read'],
    paraQuien: 'la Dueña y Gerencia', palabras: ['gastos', 'ganancia', 'dinero', 'entradas y salidas'],
  },
  {
    modulo: 'retention', href: '/retencion', llave: 'retencion', puestos: ['MANAGER', 'RECEPTION'], etiqueta: 'Retención', icono: HeartHandshake, grupo: 'direccion', permisos: ['reports:branch:read'],
    paraQuien: 'Recepción y Gerencia', palabras: ['a quién llamar', 'en riesgo', 'dejó de venir'],
  },
  {
    modulo: 'core', href: '/planes', llave: 'planes', puestos: ['OWNER', 'MANAGER', 'RECEPTION', 'COACH'], etiqueta: 'Planes', icono: Tags, grupo: 'direccion', permisos: ['catalog:read'],
    paraQuien: 'la Dueña y Gerencia', palabras: ['precios', 'membresías', 'catálogo'],
  },
  {
    modulo: 'pos', href: '/productos', llave: 'productos', puestos: ['MANAGER'], etiqueta: 'Productos', icono: Package, grupo: 'direccion', permisos: ['pos:product:manage'],
    paraQuien: 'Gerencia', palabras: ['inventario', 'existencias', 'tienda'],
  },
  {
    modulo: 'core', href: '/personal', llave: 'personal', puestos: ['OWNER', 'MANAGER'], etiqueta: 'Personal', icono: UserCog, grupo: 'direccion', permisos: ['staff:read'],
    paraQuien: 'el Dueño y la Gerencia', palabras: ['usuarios', 'roles', 'permisos', 'empleados'],
  },
  {
    modulo: 'core', href: '/importar', llave: 'importar', puestos: ['MANAGER'], etiqueta: 'Importar socios', icono: FileUp, grupo: 'direccion', permisos: ['members:import'],
    paraQuien: 'Gerencia', palabras: ['migración', 'excel', 'csv', 'sistema anterior', 'duplicados', 'padrón', 'cargar socios'],
  },
  // La dueña las consulta sin cambiarlas (19-03, D19-02): sedes, cajas, enlace del alta y zona.
  {
    modulo: 'core', href: '/sucursales', llave: 'sucursales', puestos: ['OWNER', 'MANAGER'], etiqueta: 'Sucursales', icono: Building2, grupo: 'direccion', permisos: ['settings:branch'], roles: ['OWNER'], rutas: ['/gimnasio'],
    paraQuien: 'la Dueña y Gerencia', palabras: ['sedes', 'cajas', 'mi gimnasio', 'datos del gimnasio'],
  },
  // La dueña los ve sin poder cambiarlos: quiere saber qué se apagó y por qué.
  {
    modulo: 'core', href: '/modulos', llave: 'modulos', puestos: ['OWNER', 'MANAGER'], etiqueta: 'Módulos', icono: Blocks, grupo: 'direccion', permisos: ['settings:org', 'settings:branch'], roles: ['OWNER'],
    paraQuien: 'la Dueña y Gerencia', palabras: ['configuración', 'encender', 'apagar', 'secciones', 'mi gimnasio'],
  },

  // ── Cumplimiento ──────────────────────────────────────────────────────────
  {
    modulo: 'core', href: '/autorizaciones', etiqueta: 'Autorizaciones', icono: Stamp, grupo: 'cumplimiento', permisos: FIRMAS,
    paraQuien: 'el Dueño, que da la segunda firma', contador: 'firmas', palabras: ['firmas', 'aprobar', 'por autorizar'],
  },
  {
    modulo: 'core', href: '/bitacora', llave: 'bitacora', puestos: ['OWNER', 'MANAGER'], etiqueta: 'Bitácora', icono: History, grupo: 'cumplimiento', permisos: ['audit:read'],
    paraQuien: 'la Dueña y Gerencia', palabras: ['historial', 'auditoría', 'quién hizo qué'],
  },
  {
    modulo: 'biometrics', href: '/biometria', llave: 'biometria', puestos: ['OWNER', 'MANAGER'], etiqueta: 'Biometría', icono: ScanFace, grupo: 'cumplimiento', permisos: ['audit:read'],
    paraQuien: 'la Dueña y Gerencia', palabras: ['huella', 'rostro', 'borrados', 'enrolamientos'],
    atajo: { titulo: 'Biometría', texto: 'Enrolamientos y borrados' },
  },
  {
    // La dueña lee los textos legales completos y firma el aviso de privacidad (3.7, D-25): entra con `settings:consent:read`.
    modulo: 'core', href: '/consentimientos', llave: 'consentimientos', puestos: ['OWNER', 'MANAGER', 'RECEPTION'], etiqueta: 'Textos de consentimiento', icono: FileSignature, grupo: 'cumplimiento', permisos: ['members:consent:read', 'settings:consent:read'],
    paraQuien: 'la Dueña y Gerencia', palabras: ['aviso de privacidad', 'reglamento', 'documentos', 'legal'],
  },
];

/** Lo que una sección necesita saber de la sesión para decidir si se muestra. */
export type Mirada = {
  can: (permiso: string) => boolean;
  activo: (modulo: string) => boolean;
  roles: readonly string[];
  /** Secciones que el dueño le liberó; null = no tiene llave (es el dueño). */
  liberadas?: readonly string[] | null;
};

/**
 * Llaves que vienen abiertas con el puesto: el dueño las QUITA (`-clave`), no
 * las libera. Salen del núcleo (`defaultOpen`): antes eran una lista a mano
 * aquí (27-02).
 */
export const LLAVES_ABIERTAS: ReadonlySet<string> = OPEN_BY_ROLE_SECTIONS;

/** ¿Esta sección está bajo llave para esta persona y el dueño no se la ha liberado? */

export function bajoLlave(s: Seccion, m: Mirada): boolean {
  if (!s.llave || m.liberadas === null || m.liberadas === undefined) return false;
  return LLAVES_ABIERTAS.has(s.llave) ? m.liberadas.includes(`-${s.llave}`) : !m.liberadas.includes(s.llave);
}

/** ¿La sesión trae alguno de sus permisos (o su rol la ve)? */
function porPermiso(s: Seccion, m: Mirada): boolean {
  if (!s.permisos || s.permisos.length === 0) return true;
  return s.permisos.some((p) => m.can(p)) || (s.roles ?? []).some((r) => m.roles.includes(r));
}

/** ¿El rol de esta persona ve la sección? (sin mirar si el módulo está encendido) */
export function leToca(s: Seccion, m: Mirada): boolean {
  return !bajoLlave(s, m) && porPermiso(s, m);
}

/** ¿Su PUESTO trae la sección, aunque el dueño todavía no se la libere? */
export function puestoLaTrae(s: Seccion, m: Mirada): boolean {
  return porPermiso(s, m) || (s.puestos ?? []).some((r) => m.roles.includes(r));
}

/**
 * Lo que contesta la puerta de una pantalla (sin mirar el módulo): primero el
 * PUESTO y después la LLAVE (27-06). Al revés, a recepción en Tablero se le
 * decía «pídesela al dueño» por una pantalla que su puesto nunca le daría.
 */
export type RespuestaDePuerta = 'pasa' | 'puesto' | 'llave' | 'quitada';

export function respuestaDePuerta(s: Seccion, m: Mirada): RespuestaDePuerta {
  if (!puestoLaTrae(s, m)) return 'puesto';
  if (bajoLlave(s, m)) return s.llave && LLAVES_ABIERTAS.has(s.llave) ? 'quitada' : 'llave';
  return porPermiso(s, m) ? 'pasa' : 'puesto';
}

/** Las secciones que esta persona ve hoy en este gimnasio. */
export function menuPara(m: Mirada): Seccion[] {
  return SECCIONES.filter((s) => m.activo(s.modulo) && leToca(s, m));
}

/** La sección dueña de una ruta: gana el prefijo más largo. */
export function seccionDeRuta(ruta: string): Seccion | undefined {
  let mejor: { s: Seccion; largo: number } | undefined;
  for (const s of SECCIONES) {
    for (const base of [s.href, ...(s.rutas ?? [])]) {
      if ((ruta === base || ruta.startsWith(`${base}/`)) && (!mejor || base.length > mejor.largo)) mejor = { s, largo: base.length };
    }
  }
  return mejor?.s;
}

/** Para el buscador: secciones cuyo nombre o palabras contienen lo escrito. */
export function buscarSecciones(q: string, m: Mirada): Seccion[] {
  const limpio = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const texto = limpio(q.trim());
  if (texto.length < 2) return [];
  return menuPara(m).filter((s) => [s.etiqueta, ...(s.palabras ?? [])].some((p) => limpio(p).includes(texto)));
}

// ── EL MENÚ POR TAREA (auditoría 8, bloque 2.1; 1-02, DA-22) ─────────────────
/**
 * Cómo se ACOMODA el menú de cada puesto. No decide qué ve nadie: eso lo
 * siguen diciendo `menuPara` (permiso, llave y módulo) y la puerta. Aquí solo
 * están el orden y los grupos.
 *
 * Antes el menú se agrupaba por «Operación · Dirección · Cumplimiento», que
 * son los nombres de la llave del dueño (y siguen siéndolo en Personal → «Qué
 * ve»), no de lo que la gente hace: a recepción y al coach les ponía un título
 * «OPERACIÓN» que no significaba nada, y a la dueña le plegaba Tablero,
 * Movimientos y Autorizaciones.
 *
 *  · GERENCIA: por tarea, en cinco grupos. Inicio va suelto, arriba.
 *  · RECEPCIÓN, COACH y DUEÑA: una lista plana, sin título ni nada que plegar,
 *    en el orden en que se usa.
 *
 * Una sección que no esté en estas listas no se pierde: sale al final (del
 * último grupo, o de la lista plana). `tabla-puestos.test.ts` lo comprueba.
 */
export type GrupoDeMenu = { titulo: string | null; secciones: Seccion[] };

/** Los grupos del gerente: máximo seis renglones cada uno. */
export const MENU_POR_TAREA: ReadonlyArray<{ titulo: string; rutas: readonly string[] }> = [
  { titulo: 'Mostrador', rutas: ['/socios', '/caja', '/punto-de-venta', '/altas', '/estacion', '/acceso'] },
  { titulo: 'Clases y crecimiento', rutas: ['/clases', '/rutinas', '/prospectos', '/retencion', '/mensajes'] },
  { titulo: 'Dinero', rutas: ['/tablero', '/movimientos', '/precios', '/planes', '/productos'] },
  { titulo: 'Gimnasio', rutas: ['/personal', '/sucursales', '/modulos', '/importar', '/consentimientos'] },
  { titulo: 'Control', rutas: ['/autorizaciones', '/bitacora', '/biometria'] },
];

/** El orden de la lista plana de cada puesto; lo que no esté aquí va después, en el orden del registro. */
export const MENU_PLANO: Readonly<Record<string, readonly string[]>> = {
  RECEPTION: ['/panel', '/socios', '/caja', '/punto-de-venta', '/clases', '/altas', '/prospectos', '/mensajes', '/precios', '/estacion', '/acceso'],
  COACH: ['/panel', '/socios', '/clases', '/rutinas', '/precios'],
  // Lo que la dueña abre a diario, primero: sus firmas y su dinero (UX5-D-09).
  OWNER: ['/panel', '/autorizaciones', '/movimientos', '/tablero', '/caja', '/personal', '/bitacora', '/planes', '/precios', '/sucursales', '/modulos', '/biometria', '/consentimientos'],
};

/** Cómo se llama una sección en el menú de un puesto, cuando no es su nombre de siempre. */
const ETIQUETA_POR_PUESTO: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // El coach solo ve a sus socios asignados (2026-10-09): la pantalla ya se titula así.
  COACH: { '/socios': 'Mis socios' },
};

/** El puesto que manda en el menú: quien es gerente lo ve por tarea aunque tenga otro puesto además. */
function puestoDelMenu(roles: readonly string[]): 'MANAGER' | 'OWNER' | 'RECEPTION' | 'COACH' | null {
  for (const p of ['MANAGER', 'OWNER', 'RECEPTION', 'COACH'] as const) if (roles.includes(p)) return p;
  return null;
}

/**
 * «MI GIMNASIO» ES UNA ENTRADA DEL MENÚ (19-02; bloque 2.12). Datos, Sucursales
 * y Módulos son una pantalla con tres pestañas (`app/(panel)/gimnasio/pestanas.tsx`);
 * en el menú eran dos renglones (Sucursales y Módulos) y al entrar a `/gimnasio`
 * no se marcaba ninguno. Aquí se juntan en uno, que queda marcado en las tres
 * direcciones (`rutas`).
 *
 * No decide qué ve nadie: el registro, la puerta, las llaves (`sucursales` y
 * `modulos`, cada una con la suya) y el buscador siguen por sección. La entrada
 * existe si la persona ve alguna de las dos y lleva a la primera pestaña que
 * puede abrir: `/gimnasio` (Datos, con la llave de Sucursales) o, si solo tiene
 * Módulos, `/modulos`.
 */
export const MI_GIMNASIO = { etiqueta: 'Mi gimnasio', de: ['/sucursales', '/modulos'], rutas: ['/gimnasio', '/sucursales', '/modulos'] } as const;

function conMiGimnasio(secciones: Seccion[]): Seccion[] {
  const esSuya = (s: Seccion) => (MI_GIMNASIO.de as readonly string[]).includes(s.href);
  const i = secciones.findIndex(esSuya);
  if (i < 0) return secciones;
  const primera = secciones[i]!;
  const entrada: Seccion = {
    ...primera, href: primera.href === '/sucursales' ? '/gimnasio' : primera.href,
    etiqueta: MI_GIMNASIO.etiqueta, icono: Building2, rutas: MI_GIMNASIO.rutas,
  };
  return [...secciones.slice(0, i), entrada, ...secciones.slice(i + 1).filter((s) => !esSuya(s))];
}

/** El menú de esta persona, ya acomodado: los grupos con título se pueden plegar; los que no, no. */
export function menuAcomodado(m: Mirada): GrupoDeMenu[] {
  return acomodar(m).map((g) => ({ ...g, secciones: conMiGimnasio(g.secciones) }));
}

function acomodar(m: Mirada): GrupoDeMenu[] {
  const suyas = menuPara(m);
  const puesto = puestoDelMenu(m.roles);
  const nombres = (puesto && ETIQUETA_POR_PUESTO[puesto]) || {};
  const conNombre = (s: Seccion): Seccion => (nombres[s.href] ? { ...s, etiqueta: nombres[s.href]! } : s);
  const porRuta = new Map(suyas.map((s) => [s.href, s]));
  const tomar = (rutas: readonly string[], usadas: Set<string>): Seccion[] =>
    rutas.flatMap((r) => { const s = porRuta.get(r); if (!s || usadas.has(r)) return []; usadas.add(r); return [conNombre(s)]; });
  const usadas = new Set<string>();

  if (puesto !== 'MANAGER') {
    const lista = tomar(puesto ? MENU_PLANO[puesto] ?? [] : [], usadas);
    const resto = suyas.filter((s) => !usadas.has(s.href)).map(conNombre);
    return lista.length + resto.length > 0 ? [{ titulo: null, secciones: [...lista, ...resto] }] : [];
  }
  const inicio = tomar(['/panel'], usadas);
  const grupos = MENU_POR_TAREA.map((g) => ({ titulo: g.titulo as string | null, secciones: tomar(g.rutas, usadas) }));
  const resto = suyas.filter((s) => !usadas.has(s.href)).map(conNombre);
  if (resto.length > 0) grupos.at(-1)!.secciones.push(...resto);
  return [...(inicio.length > 0 ? [{ titulo: null, secciones: inicio }] : []), ...grupos.filter((g) => g.secciones.length > 0)];
}

/**
 * La barra inferior de la dueña en el teléfono (DA-22): lo que abre a diario,
 * a un toque. Cada pestaña existe solo si la sección está en su menú.
 */
export const BARRA_DE_LA_DUENA: ReadonlyArray<{ href: string; etiqueta: string }> = [
  { href: '/panel', etiqueta: 'Inicio' },
  { href: '/movimientos', etiqueta: 'Dinero' },
  { href: '/autorizaciones', etiqueta: 'Firmas' },
  { href: '/personal', etiqueta: 'Equipo' },
];

export function barraInferior(m: Mirada): Array<{ seccion: Seccion; etiqueta: string }> {
  // Solo la dueña: quien además opera (gerente) usa el menú completo.
  if (!m.roles.includes('OWNER') || m.roles.some((r) => r !== 'OWNER')) return [];
  const porRuta = new Map(menuPara(m).map((s) => [s.href, s]));
  return BARRA_DE_LA_DUENA.flatMap((b) => { const s = porRuta.get(b.href); return s ? [{ seccion: s, etiqueta: b.etiqueta }] : []; });
}
