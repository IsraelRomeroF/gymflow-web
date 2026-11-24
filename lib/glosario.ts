/**
 * GLOSARIO FINANCIERO ÚNICO (UX 2026-10-08; auditoría 8, D-24): Inicio,
 * Tablero y Movimientos llamaban distinto a la misma cifra ("Ganancia",
 * "Ganancia real") y la confundían con otra ("Utilidad contable"). Un nombre
 * y una explicación por concepto, en un solo lugar: las tres pantallas toman
 * de aquí la palabra y la explicación (`components/glosario-dinero.tsx`).
 */
export const GLOSARIO = {
  entro: { nombre: 'Entró', explica: 'El dinero que cobraste en el periodo, sea del mes que sea: una anualidad pagada hoy entra completa.' },
  gastos: { nombre: 'Gastos', explica: 'Lo pagado de la caja, los faltantes de los cortes y los gastos fijos (renta, nómina) que le tocan al periodo, repartidos por día.' },
  gananciaCaja: { nombre: 'Ganancia en caja', explica: 'Lo que entró, menos devoluciones, gastos y faltantes de caja y los gastos fijos (renta, nómina) del periodo. Es la cifra de Movimientos. No descuenta el costo de los productos vendidos.' },
  utilidad: { nombre: 'Utilidad contable', explica: 'Lo ganado (solo la parte del servicio que ya diste en el periodo) menos gastos y faltantes de caja, gastos fijos y el costo de lo que vendiste en la tienda. Es la cifra del Tablero.' },
  // Una sola regla en Tablero, Movimientos e Inicio (auditoría 8, 13-05 y 14-09).
  descuadre: { nombre: 'Descuadre', explica: 'De cada corte cuenta su faltante, que resta como un gasto. Un sobrante no suma a la ganancia: se informa «por aclarar» hasta saber de dónde salió, y no tapa el faltante de otra caja.' },
  ganado: { nombre: 'Ganado', explica: 'La parte del servicio que ya diste en el periodo: de una anualidad, un mes.' },
  porPrestar: { nombre: 'Por prestar', explica: 'Lo que ya cobraste y todavía debes en servicio: paquetes y periodos pagados por adelantado.' },
  // D-18 (bloque 4.4): lo cobrable. La deuda dada por perdida se informa aparte en el Tablero.
  porCobrar: { nombre: 'Por cobrar', explica: 'Lo que tus socios deben hoy, vencido o no; también lo que quedó debiendo quien ya se dio de baja, hasta que se cobre o se perdone. No incluye la deuda que ya se dio por perdida (la de membresías que llevaron suspendidas el plazo del gimnasio): esa sigue en el estado de cuenta de cada socio y se puede cobrar.' },
  // Fase 3 · bloque 3.7 (D-21, D-22, D-23).
  costoVendido: { nombre: 'Costo de lo vendido', explica: 'Lo que le costó al gimnasio lo que vendió en la tienda, con el costo que cada producto tenía el día de la venta. La utilidad contable ya lo resta.' },
  retiroDueno: { nombre: 'Retiro del dueño', explica: 'Lo que el dueño se lleva del negocio. Se anota y se ve, pero no es un gasto: no resta de la ganancia ni de la utilidad.' },
  ajuste: { nombre: 'Ajuste de un mes cerrado', explica: 'Un mes cerrado ya no cambia. Lo que llega tarde —un gasto que faltó o uno que sobraba— se anota en el mes en curso como «ajuste de ‹mes›», a la vista.' },
  // Fase 4 · bloque 4.5 (D-26).
  pagoNomina: { nombre: 'Pago de nómina', explica: 'La nómina se anota pago por pago: la fecha, a quién y cuánto. Cada pago cuenta como gasto fijo en el mes de su fecha, repartido por día.' },
  porConfirmar: { nombre: 'Por confirmar', explica: 'Lo que se repite (la renta, la luz, la nómina fija) se propone cada vez que toca. No se anota solo: alguien lo confirma, corrige el importe o lo descarta, y mientras tanto no cuenta en ninguna cifra.' },
} as const;

export type TerminoDelGlosario = keyof typeof GLOSARIO;
