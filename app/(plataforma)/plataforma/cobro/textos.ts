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

/**
 * Un renglón. Desde D-39 (bloque 4.9) puede venir cobrado por días (`PRORATED`:
 * primer mes o módulo contratado a medio mes), ser los días de un mes anterior
 * (`CATCH_UP`) o el descuento del mes, en negativo (`DISCOUNT`).
 */
export type Linea = { key: string; name: string; monthlyCents: string; kind?: 'CHARGE' | 'PRORATED' | 'CATCH_UP' | 'DISCOUNT'; listCents?: string; days?: number; ofDays?: number };
/** Subtotal, IVA y total (D-39). `totalCents` es lo que se paga; sin IVA, `taxRateBps` es 0 y el subtotal es el total. */
export type Desglose = { subtotalCents: string; taxCents: string; taxRateBps: number; taxIncluded: boolean; totalCents: string };
/** Los datos fiscales que salen en la factura: los del gimnasio (su ficha) y los de GymFlow (configuración del servidor). */
export type Receptor = { legalName: string; rfc: string | null; tradeName?: string };
export type Emisor = { legalName: string; rfc: string | null; address: string | null; payment: string | null; contact: string | null };
export type EstadoDeFactura = 'PENDIENTE' | 'PAGADA_EN_PARTE' | 'VENCIDA' | 'PAGADA' | 'ANULADA';
export type Factura = {
  id: string; organizationId: string; folio: string; periodStart: string; periodEnd: string; lines: Linea[];
  /** Lo guardado; para pintar se usa `state`. */
  status: 'PENDING' | 'PAID' | 'VOID';
  /** EL estado de la factura, calculado por el servidor con el día de la Ciudad de México. */
  state: EstadoDeFactura; overdueDays: number;
  totalCents: string; paidCents: string; balanceCents: string;
  /** D-39. `itemized` falso = emitida antes del desglose: un total, sin IVA aparte. */
  itemized: boolean; subtotalCents: string; taxCents: string; taxRateBps: number; taxIncluded: boolean; discountCents: string;
  /** Como estaban al emitir; `null` en las anteriores a D-39. */
  receiver: Receptor | null; issuer: Emisor | null;
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
/** Cómo quedó el servicio de la marca al registrar un pago (D-37, bloque 3.11). */
export type ServicioTrasElPago = { status: 'PENDING' | 'ACTIVE' | 'SUSPENDED'; suspendedAutomatically: boolean; canResume: boolean; resumed: boolean; holdUntil: string | null };
export type FacturaConPagos = Factura & {
  payments: Pago[];
  /** Solo en la respuesta de registrar un pago. */
  service?: ServicioTrasElPago;
  /** Solo en el comprobante (`GET /platform/invoices/:id`). */
  organization?: { tradeName: string; legalName: string; serviceStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED'; suspendedAutomatically: boolean } | null;
};

export type EstadoDeCobro = 'VENCIDA' | 'NO_FACTURABLE' | 'SIN_FACTURA_DEL_MES' | 'POR_VENCER' | 'AL_CORRIENTE' | 'SIN_COBRO';
export type CobroDeMarca = { code: EstadoDeCobro; overdueDays: number; pendingCents: string };

/** Lo que saldría al emitir un mes: es el mismo cálculo que la emisión. */
export type VistaPreviaDeEmision = {
  month: string; dueDate: string; totalCents: string;
  toIssue: Array<Desglose & { organizationId: string; tradeName: string; lines: Linea[]; discountCents: string }>;
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
/** `1600` → «16 %». */
export const tasa = (bps: number): string => `${(bps / 100).toString()} %`;
/** Cómo se llama el renglón del IVA en una factura o en la mensualidad. */
export const etiquetaDeIva = (d: Pick<Desglose, 'taxRateBps' | 'taxIncluded'>): string => (d.taxIncluded ? `IVA (${tasa(d.taxRateBps)}), incluido en los precios` : `IVA (${tasa(d.taxRateBps)})`);
/** Un descuento o precio especial de una marca (D-39). */
export type Ajuste = {
  id: string; organizationId: string; kind: 'PERCENT' | 'AMOUNT' | 'SPECIAL_PRICE'; percentBps: number | null; amountCents: string | null;
  fromMonth: string; lastMonth: string; months: number; reason: string; label: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELED'; createdAt: string; cancelReason: string | null;
};
export const ESTADO_AJUSTE: Record<Ajuste['status'], { label: string; tone: Tono }> = {
  SCHEDULED: { label: 'Programado', tone: 'warn' }, ACTIVE: { label: 'Vigente', tone: 'ok' }, ENDED: { label: 'Terminó', tone: 'neutral' }, CANCELED: { label: 'Cancelado', tone: 'neutral' },
};

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
