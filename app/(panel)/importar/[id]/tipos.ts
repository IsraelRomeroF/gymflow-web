import type { DatoDudoso, EstadoDatos, EstadoImportacion } from '@/lib/importar';

export type Kind = 'NEW' | 'MATCH' | 'REVIEW' | 'FILE_DUP' | 'INVALID';
/** Las pestañas: una por tipo de coincidencia y la de datos dudosos (D18-02), que no es un tipo. */
export type Pestana = Kind | 'DATA';
export type Decision = 'PENDING' | 'CREATE' | 'MERGE' | 'SKIP';
export type Socio = { id: string; memberCode: string; fullName: string; phoneE164: string | null; email: string | null; birthDate: string | null; joinedAt: string; homeBranchId: string | null; balanceCents: string; legacyCodes: string[] };
export type Fila = {
  id: string; rowNumber: number; firstName: string; lastName: string; phoneE164: string | null; email: string | null; curp: string | null;
  birthDate: string | null; joinedAt: string | null; periodEnd: string | null; legacyCode: string | null; branchLabel: string | null; planLabel: string | null;
  balanceCents: string | null; problems: string[]; kind: Kind; matchScore: number | null; matchReason: string | null; decision: Decision;
  appliedMemberId: string | null; applyNote: string | null; matchMember: Socio | null; matchRow: Fila | null; appliedMember: Socio | null;
  doubtful: DatoDudoso[]; dataStatus: EstadoDatos | null; balanceLoadedCents: string | null;
  /** Aviso previo: su socio ya tiene el saldo inicial de ese registro y no se vuelve a cargar (18-01). */
  openingNote?: string | null;
};
/** El dinero y las vigencias de lo que entra (18-04): para cotejar con el reporte de cartera del sistema anterior. */
export type Dinero = {
  debtCents: string; debtRows: number; creditCents: string; creditRows: number;
  /** Vigencias vivas que se cargan (su plan del archivo ya tiene plan de GymFlow). */
  memberships: number;
  /** Vigencias vivas que NO se cargan: se decidió así, o falta decidir su plan. */
  membershipsNotLoaded: number;
  /** Vigencias que ya vencieron: entran sin membresía. */
  expired: number;
  /** Saldos que no se entendieron y siguen sin valor. */
  unreadBalances: number;
  loadedDebtCents: string; loadedCreditCents: string;
};
export type Detalle = {
  id: string; fileName: string; status: EstadoImportacion; branchId: string; cutoffDate: string; totalRows: number;
  planMap: Record<string, string | null>; branchMap: Record<string, string | null>;
  byKind: Partial<Record<Kind, number>>; byDecision: Partial<Record<Decision, number>>; byData: Partial<Record<EstadoDatos, number>>;
  applied: number; pendingApply: number; dataPending: number; balancesLoaded: number; balancesNotReloaded: number;
  labels: { plans: Array<{ label: string; rows: number; vigentes: number }>; branches: Array<{ label: string; rows: number }> };
  /** Lo que falta decidir antes de aplicar, con las palabras con que la API lo rechaza. */
  blockers: string[];
  /** El motivo con que se aplicó o se descartó. */
  reason: string | null;
  money: Dinero;
};
export type Plan = { id: string; name: string; billingModel: string; isActive: boolean };

export const DECISION: Record<Decision, string> = { PENDING: 'Sin decidir', CREATE: 'Dar de alta', MERGE: 'Unir', SKIP: 'Omitir' };
export const NO_CARGAR = 'NO_CARGAR';
