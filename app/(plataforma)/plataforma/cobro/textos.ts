import { capital, hoyEn, nombreMes } from '@/lib/format';

/**
 * COBRO DE PLATAFORMA: los tipos que manda la API y sus palabras. Un solo
 * lugar para toda la consola (bloque 1.13): la tarjeta de la ficha, Cobranza,
 * el comprobante y la lista de Marcas leen de aquí, y el estado de cada
 * factura y de cada marca lo decide el servidor (`state`, `status.code`):
 * ninguna pantalla vuelve a calcular «vencida» con su propio reloj (23-02).
 */

/** GymFlow cobra desde la Ciudad de México: «hoy» y «este mes» son los de allá, no los del navegador ni UTC (23-14, 23-15). */
export const ZONA_DE_COBRO = 'America/Mexico_City';
export const hoyDeCobro = (): string => hoyEn(ZONA_DE_COBRO);
export const mesDeCobro = (): string => hoyDeCobro().slice(0, 7);

export type Linea = { key: string; name: string; monthlyCents: string };
export type EstadoDeFactura = 'PENDIENTE' | 'PAGADA_EN_PARTE' | 'VENCIDA' | 'PAGADA' | 'ANULADA';
export type Factura = {
  id: string; organizationId: string; folio: string; periodStart: string; periodEnd: string; lines: Linea[];
  /** Lo guardado; para pintar se usa `state`. */
  status: 'PENDING' | 'PAID' | 'VOID';
  /** EL estado de la factura, calculado por el servidor con el día de la Ciudad de México. */
  state: EstadoDeFactura; overdueDays: number;
  totalCents: string; paidCents: string; balanceCents: string;
  issuedAt: string; issuedOn: string; dueDate: string;
  /** El día del último pago vivo, sin hora (nadie la captura). */
  paidOn: string | null; paymentMethod: string | null; paymentRef: string | null;
  note: string | null; voidReason: string | null;
};
export type Pago = {
  id: string; amountCents: string; paymentMethod: string; paymentRef: string | null; paidOn: string; note: string | null; createdAt: string;
  undone: boolean; undoneAt: string | null; undoReason: string | null;
  /** Sigue vivo y no pasó el plazo para deshacerlo. */
  canUndo: boolean; undoUntil: string;
};
export type FacturaConPagos = Factura & { payments: Pago[] };

export type EstadoDeCobro = 'VENCIDA' | 'NO_FACTURABLE' | 'SIN_FACTURA_DEL_MES' | 'POR_VENCER' | 'AL_CORRIENTE' | 'SIN_COBRO';
export type CobroDeMarca = { code: EstadoDeCobro; overdueDays: number; pendingCents: string };

/** Lo que saldría al emitir un mes: es el mismo cálculo que la emisión. */
export type VistaPreviaDeEmision = {
  month: string; dueDate: string; totalCents: string;
  toIssue: Array<{ organizationId: string; tradeName: string; totalCents: string; lines: Linea[] }>;
  skipped: Array<{ organizationId: string; tradeName: string; reason: string; code: string }>;
};
export type ResultadoDeEmitirMes = {
  month: string;
  issued: Array<{ organizationId: string; tradeName: string; folio: string; totalCents: string }>;
  skipped: Array<{ organizationId: string; tradeName: string; reason: string; code: string }>;
  failed: Array<{ organizationId: string; tradeName: string; error: string }>;
};

type Tono = 'ok' | 'warn' | 'danger' | 'neutral';
export const ESTADO_FACTURA: Record<EstadoDeFactura, { label: string; tone: Tono }> = {
  PENDIENTE: { label: 'Pendiente de pago', tone: 'warn' },
  PAGADA_EN_PARTE: { label: 'Abonada', tone: 'warn' },
  VENCIDA: { label: 'Vencida', tone: 'danger' },
  PAGADA: { label: 'Pagada', tone: 'ok' },
  ANULADA: { label: 'Anulada', tone: 'neutral' },
};
export const ESTADO_COBRO: Record<EstadoDeCobro, { label: string; tone: Tono }> = {
  VENCIDA: { label: 'Vencida', tone: 'danger' },
  NO_FACTURABLE: { label: 'Faltan precios', tone: 'warn' },
  SIN_FACTURA_DEL_MES: { label: 'Sin factura del mes', tone: 'warn' },
  POR_VENCER: { label: 'Por vencer', tone: 'warn' },
  AL_CORRIENTE: { label: 'Al corriente', tone: 'ok' },
  SIN_COBRO: { label: 'Sin cobro', tone: 'neutral' },
};
export const FORMA_DE_PAGO: Record<string, string> = { SPEI_TRANSFER: 'Transferencia (SPEI)', CARD: 'Tarjeta', CASH: 'Efectivo', OTHER: 'Otro' };
/** Sin referencia, una transferencia o un cargo a tarjeta no se concilian (23-16): la API también la exige. */
export const PIDE_REFERENCIA: ReadonlySet<string> = new Set(['SPEI_TRANSFER', 'CARD']);

/** El mes que cubre la factura, o un mes AAAA-MM, legible: «Octubre de 2026». */
export function periodo(f: { periodStart: string } | string): string {
  return capital(nombreMes(typeof f === 'string' ? f : f.periodStart));
}
export const dias = (n: number): string => `${n} ${n === 1 ? 'día' : 'días'}`;

/** La frase junto a la insignia de cobro de una marca: cuánto debe o qué le falta. */
export function fraseDeCobro(c: CobroDeMarca, pesos: (c: string) => string): string {
  switch (c.code) {
    case 'VENCIDA': return `${pesos(c.pendingCents)} pendientes · ${dias(c.overdueDays)} de atraso`;
    case 'NO_FACTURABLE': return 'Algo de lo que tiene contratado no tiene precio: no se le puede facturar.';
    case 'SIN_FACTURA_DEL_MES': return c.pendingCents !== '0' ? `Sin la factura de este mes · ${pesos(c.pendingCents)} por pagar de otra` : 'Está en uso y no tiene la factura de este mes.';
    case 'POR_VENCER': return `${pesos(c.pendingCents)} por pagar antes del vencimiento`;
    case 'AL_CORRIENTE': return 'Sin facturas pendientes.';
    case 'SIN_COBRO': return 'No está en uso: no se le factura.';
  }
}
