import type {
  PlatformCredential, PlatformOrganizationCreated, PlatformOrganizationDetail, PlatformOrganizationList, PlatformOrganizationSummary,
  PlatformServiceStatus, PlatformUser, PlatformUserCreated,
} from '@gymflow/core/contracts';

/**
 * LOS TIPOS DE LA CONSOLA salen de los contratos del núcleo (22-16): antes
 * `Marca`, `Detalle`, `Usuario` y `Credencial` estaban copiados a mano en la
 * lista, en la ficha y en la API. Si la API cambia un campo, esto deja de compilar.
 */
export type Marca = PlatformOrganizationSummary;
export type ListaDeMarcas = PlatformOrganizationList;
export type Detalle = PlatformOrganizationDetail;
export type Usuario = PlatformUser;
export type Credencial = PlatformCredential;
export type MarcaCreada = PlatformOrganizationCreated;
export type CuentaCreada = PlatformUserCreated;
export type Servicio = PlatformServiceStatus;

/** Cómo se dice cada estado del servicio, en la lista y en la ficha. */
export const SERVICIO: Record<Servicio, { label: string; tone: 'ok' | 'warn' | 'danger' }> = {
  PENDING: { label: 'Sin liberar', tone: 'warn' },
  ACTIVE: { label: 'En uso', tone: 'ok' },
  SUSPENDED: { label: 'Suspendido', tone: 'danger' },
};

/**
 * Lo que se pide al liberar, reanudar o suspender (22-07). Una marca
 * suspendida se REANUDA (vuelve tras un pago); una que nunca ha estado en uso
 * se LIBERA. Son actos distintos en la bitácora y aquí se nombran distinto.
 */
export type CambioDeServicio = 'liberar' | 'reanudar' | 'suspender';
export const CAMBIO_DE_SERVICIO: Record<CambioDeServicio, {
  status: 'ACTIVE' | 'SUSPENDED'; boton: string; titulo: (marca: string) => string; texto: string; confirmar: string; hecho: string; motivos: string[];
}> = {
  liberar: {
    status: 'ACTIVE', boton: 'Liberar el software', titulo: (m) => `Liberar el software a ${m}`, confirmar: 'Liberar', hecho: 'Software liberado.',
    texto: 'Desde este momento su personal puede entrar al panel y sus socios al portal.',
    motivos: ['Contrato firmado y primer pago recibido', 'Contrato firmado'],
  },
  reanudar: {
    status: 'ACTIVE', boton: 'Reanudar el servicio', titulo: (m) => `Reanudar el servicio de ${m}`, confirmar: 'Reanudar', hecho: 'Servicio reanudado.',
    texto: 'Su personal vuelve a entrar al panel y sus socios al portal, con todo como lo dejaron. La fecha de su primera liberación no cambia.',
    motivos: ['Pago recibido', 'Nuevo contrato'],
  },
  suspender: {
    status: 'SUSPENDED', boton: 'Suspender el servicio', titulo: (m) => `Suspender el servicio de ${m}`, confirmar: 'Suspender', hecho: 'Servicio suspendido.',
    texto: 'Nadie de la marca podrá entrar: ni su personal ni sus socios. Las sesiones abiertas se cortan en su siguiente acción. No se borra nada.',
    motivos: ['Falta de pago', 'Fin del contrato', 'A petición del dueño'],
  },
};
/** Qué se le ofrece a una marca según su estado: suspender si está en uso; reanudar si está suspendida; liberar si nunca se liberó. */
export const cambioPara = (estado: Servicio): CambioDeServicio => (estado === 'ACTIVE' ? 'suspender' : estado === 'SUSPENDED' ? 'reanudar' : 'liberar');
