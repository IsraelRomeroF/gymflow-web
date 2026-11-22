/** Vocabulario del catálogo: cómo se dice cada plan en el mostrador. */

export type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  billingModel: 'RECURRING' | 'PREPAID_PERIOD' | 'VISIT_PACK' | 'DAY_PASS';
  durationUnit: 'DAY' | 'WEEK' | 'MONTH' | 'VISIT';
  durationValue: number;
  priceCents: string;
  signupFeeCents: string;
  taxRateBps: number | null;
  priceIncludesTax: boolean;
  branchAccessScope: 'HOME_BRANCH' | 'LISTED_BRANCHES' | 'ALL_BRANCHES';
  includesClasses: boolean;
  /** Con `includesClasses`: cuáles clases. Vacío = todas las que se pueden incluir (2026-10-09). */
  includedClassTypeIds?: string[];
  visitsIncluded: number | null;
  visitValidityDays: number | null;
  defaultGraceDays: number;
  allowFreeze: boolean;
  maxFreezeDaysPerYear: number;
  minFreezeDays: number;
  autoRenewDefault: boolean;
  isActive: boolean;
  effectivePriceCents?: string | null;
};

export const MODELO: Record<Plan['billingModel'], { label: string; hint: string }> = {
  RECURRING: { label: 'Recurrente', hint: 'Se renueva y se cobra cada periodo' },
  PREPAID_PERIOD: { label: 'Pago anticipado', hint: 'Un periodo largo pagado por adelantado' },
  VISIT_PACK: { label: 'Paquete de visitas', hint: 'Un número de visitas con vigencia' },
  DAY_PASS: { label: 'Visita suelta', hint: 'Acceso por un día' },
};

export const ACCESO: Record<Plan['branchAccessScope'], string> = {
  HOME_BRANCH: 'Solo su sucursal',
  LISTED_BRANCHES: 'Sucursales elegidas',
  ALL_BRANCHES: 'Todas las sucursales',
};

const UNIDAD: Record<Plan['durationUnit'], [string, string]> = {
  DAY: ['día', 'días'], WEEK: ['semana', 'semanas'], MONTH: ['mes', 'meses'], VISIT: ['visita', 'visitas'],
};

/** "1 mes", "3 meses", "10 visitas · vigencia 90 días". */
export function duracion(p: Pick<Plan, 'durationUnit' | 'durationValue' | 'billingModel' | 'visitsIncluded' | 'visitValidityDays'>): string {
  if (p.billingModel === 'VISIT_PACK') {
    const n = p.visitsIncluded ?? p.durationValue;
    return `${n} ${n === 1 ? 'visita' : 'visitas'}${p.visitValidityDays ? ` · vigencia ${p.visitValidityDays} días` : ''}`;
  }
  const [uno, varios] = UNIDAD[p.durationUnit];
  return `${p.durationValue} ${p.durationValue === 1 ? uno : varios}`;
}

/** Sufijo de precio: "/ mes", "/ 3 meses", "" para paquetes y visitas. */
export function porPeriodo(p: Pick<Plan, 'durationUnit' | 'durationValue' | 'billingModel'>): string {
  if (p.billingModel === 'VISIT_PACK' || p.billingModel === 'DAY_PASS') return '';
  const [uno, varios] = UNIDAD[p.durationUnit];
  return p.durationValue === 1 ? `/ ${uno}` : `/ ${p.durationValue} ${varios}`;
}
