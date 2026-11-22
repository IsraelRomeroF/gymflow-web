/**
 * GLOSARIO FINANCIERO ÚNICO (UX 2026-10-08): Inicio, Tablero y Movimientos
 * llamaban distinto a la misma cifra ("Ganancia", "Ganancia real") y la
 * confundían con otra ("Utilidad contable"). Un nombre y una explicación por
 * concepto, en un solo lugar.
 */
export const GLOSARIO = {
  entro: { nombre: 'Entró', explica: 'El dinero que cobraste en el periodo, sea del mes que sea: una anualidad pagada hoy entra completa.' },
  gananciaCaja: { nombre: 'Ganancia en caja', explica: 'Lo que entró, menos devoluciones, gastos y faltantes de caja y los gastos fijos (renta, nómina) del periodo. Es la cifra de Movimientos.' },
  utilidad: { nombre: 'Utilidad contable', explica: 'Lo ganado (solo la parte del servicio que ya diste en el periodo) menos gastos y faltantes de caja y gastos fijos. Es la cifra del Tablero.' },
  // Una sola regla en Tablero, Movimientos e Inicio (auditoría 8, 13-05 y 14-09).
  descuadre: { nombre: 'Descuadre', explica: 'De cada corte cuenta su faltante, que resta como un gasto. Un sobrante no suma a la ganancia: se informa «por aclarar» hasta saber de dónde salió, y no tapa el faltante de otra caja.' },
  ganado: { nombre: 'Ganado', explica: 'La parte del servicio que ya diste en el periodo: de una anualidad, un mes.' },
  porPrestar: { nombre: 'Por prestar', explica: 'Lo que ya cobraste y todavía debes en servicio: paquetes y periodos pagados por adelantado.' },
  porCobrar: { nombre: 'Por cobrar', explica: 'Lo que tus socios deben hoy, vencido o no.' },
} as const;
