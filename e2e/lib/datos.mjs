// Datos PROPIOS de cada recorrido (auditoría 8, fase 1.17a, 27-11): en lugar de
// tomar «el primer socio al corriente» o «la suspendida de hace meses» que dejó
// la semilla —y que el recorrido anterior ya cobró, perdonó o anonimizó—, cada
// recorrido crea a quien necesita, con nombre propio de esa corrida, por la API
// y con las mismas reglas que el mostrador. Así se puede correr solo, en
// cualquier orden y las veces que haga falta, sin regenerar la base.
//
// Lo único que la API no deja (a propósito) es fechar hacia atrás: un socio que
// «dejó de pagar hace tres meses» se arma como lo arma la semilla
// (gymflow-backend/scripts/seed-presentacion.ts): se vende con su fecha, y se
// recorre el reloj de ESA membresía en gymflow_pruebas (lib/base.mjs). Es lo
// que habría hecho el paso del tiempo con el cierre diario.
//
// Los apellidos empiezan con «Z» a propósito: la lista de socios se ordena por
// apellido, y así quedan al final, lejos de los primeros 100 que algunos
// recorridos revisan por estado.
import { ZONA } from './entorno.mjs';
import { sql } from './base.mjs';

const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Hoy en el gimnasio (CDMX), «AAAA-MM-DD». */
export const hoy = () => fmtDia.format(new Date());
/** El día que está `n` días después de hoy (negativo: antes), «AAAA-MM-DD». */
export function dia(n) {
  const [y, m, d] = hoy().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** 0 = domingo, como `slots.weekday` de las clases. */
export const diaDeLaSemana = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

let corrida = 0;
/** Letras distintas en cada llamada, sin dígitos (los nombres de persona no los aceptan). */
export function letras(n = 4) {
  const base = `${Date.now().toString(36)}${(corrida++).toString(36)}${Math.random().toString(36).slice(2)}`;
  const solo = base.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const pedazo = solo.slice(-n);
  return pedazo.charAt(0).toUpperCase() + pedazo.slice(1);
}
/** Un sufijo corto para correos y códigos (con dígitos). */
export const sufijo = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`;
/** Un celular de la CDMX que no se repite. */
export const celular = () => `55${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;

const NOMBRES = ['Andrea', 'Bruno', 'Camila', 'Daniel', 'Elena', 'Fabián', 'Gabriela', 'Hugo', 'Inés', 'Julián', 'Karla', 'Lorenzo', 'Mónica', 'Nicolás', 'Olivia', 'Pablo'];

const memo = new WeakMap();
async function catalogo(api) {
  if (memo.has(api)) return memo.get(api);
  const [sedes, planes, docs] = await Promise.all([api.get('/branches'), api.get('/plans'), api.get('/consent-documents')]);
  const c = {
    sede: (code) => { const b = sedes.find((x) => x.code === code || x.id === code); if (!b) throw new Error(`No hay sede ${code}`); return b; },
    plan: (code) => { const p = planes.find((x) => x.code === code || x.id === code); if (!p) throw new Error(`No hay plan ${code}`); return p; },
    version: (tipo) => { const d = docs.documents.find((x) => x.consentType === tipo && x.status === 'PUBLISHED'); if (!d) throw new Error(`No hay ${tipo} publicado`); return d.version; },
  };
  memo.set(api, c);
  return c;
}
export const sedeDe = async (api, code) => (await catalogo(api)).sede(code);
export const planDe = async (api, code) => (await catalogo(api)).plan(code);

/**
 * Un socio nuevo, con aviso de privacidad y reglamento firmados, de la sede
 * `sede` (código o id). Lo da de alta quien sea `api` (la gerencia, casi siempre).
 * `responsable` ({ kind: 'MEMBER', memberId } | { kind: 'SELF' } | { kind: 'ADULT', name }) cuando comparte celular.
 */
export async function crearSocio(api, { sede = 'CEN', nombre, apellidos, telefono = celular(), responsable } = {}) {
  const c = await catalogo(api);
  return api.post('/members', {
    firstName: nombre ?? NOMBRES[Math.floor(Math.random() * NOMBRES.length)],
    lastName: apellidos ?? `Zavala ${letras(5)}`,
    phoneE164: `+52${telefono}`,
    homeBranchId: c.sede(sede).id,
    force: true,
    // Fase 3 (D-09): si el celular ya es de otro socio, hay que decir quién responde por el número.
    ...(responsable ? { responsible: responsable } : {}),
    consents: [
      { consentType: 'PRIVACY_NOTICE', documentVersion: c.version('PRIVACY_NOTICE'), granted: true },
      { consentType: 'HOUSE_RULES', documentVersion: c.version('HOUSE_RULES'), granted: true },
    ],
  });
}

/**
 * Le vende una membresía. `inicio` («AAAA-MM-DD») la fecha hacia atrás, con
 * motivo; `pago: 'SPEI'` la cobra por transferencia (no necesita caja abierta)
 * y `pago: null` la deja sin cobrar.
 */
export async function venderMembresia(api, socio, { plan = 'MEN', sede, inicio, pago = 'SPEI', motivo = 'Recorrido de prueba' } = {}) {
  const c = await catalogo(api);
  return api.post(`/members/${socio.id}/memberships/sale`, {
    planId: c.plan(plan).id,
    branchId: sede ? c.sede(sede).id : socio.homeBranchId,
    ...(inicio ? { startDate: inicio, reason: motivo } : {}),
    payment: pago === 'SPEI' ? { method: 'SPEI_TRANSFER', externalRef: `REC${sufijo().toUpperCase()}` } : null,
  });
}

/** Un socio con su mensualidad pagada hoy: entra, y no debe nada. */
export async function socioAlCorriente(api, opciones = {}) {
  const socio = await crearSocio(api, opciones);
  const venta = await venderMembresia(api, socio, { plan: opciones.plan ?? 'MEN' });
  return { ...socio, membresiaId: venta.membership.id };
}

/** El saldo cacheado del socio, como lo deja `BillingService.refreshCachedBalance`. */
async function refrescarSaldo(memberId) {
  await sql(`update members m set "balanceCentsCached" =
      coalesce((select sum("amountCents" - "allocatedCents" - "adjustedCents") from charges c
                where c."memberId" = m.id and c.status in ('OPEN','PARTIALLY_PAID','OVERDUE')), 0)
    - coalesce((select sum(case when "amountCents" < 0 then -"unappliedCents" else "unappliedCents" end) from payments p
                where p."memberId" = m.id and p.status in ('SUCCEEDED','REVERSED')), 0),
    "balanceComputedAt" = now()
    where m.id = $1`, [memberId]);
}

/** Un inicio de periodo `dias` atrás con día del mes ≤ 28 (sin finales de mes ambiguos). */
function inicioAtras(dias) {
  let n = dias;
  while (Number(dia(-n).slice(8)) > 28) n++;
  return dia(-n);
}

/**
 * Un socio SUSPENDIDO con su cuota vencida, como lo deja la semilla:
 * - `mesesAtras: 0` · su periodo sigue en curso (lo típico: se le cobra y entra);
 * - `mesesAtras: 3` · dejó de pagar hace meses («Decidir adeudo»: reanudar u olvidar).
 * Pagó su primer mes; el siguiente ya no, y con él quedó suspendido.
 */
export async function socioSuspendido(api, { mesesAtras = 0, ...opciones } = {}) {
  const socio = await crearSocio(api, opciones);
  const inicio = inicioAtras(mesesAtras > 0 ? 30 * mesesAtras + 30 : 40);
  const venta = await venderMembresia(api, socio, { plan: opciones.plan ?? 'MEN', inicio, motivo: 'Historial del recorrido de prueba' });
  const id = venta.membership.id;
  const [m] = await sql(`update memberships set status = 'SUSPENDED', "currentPeriodStart" = "currentPeriodEnd",
      "currentPeriodEnd" = ("currentPeriodEnd" + interval '1 month')::date
    where id = $1 and status = 'ACTIVE' returning "currentPeriodStart"::text as inicio, "currentPeriodEnd"::text as fin`, [id]);
  if (!m) throw new Error(`La membresía ${id} no quedó activa tras venderla: no se puede suspender`);
  await api.post(`/memberships/${id}/period-charge`);
  await sql(`update charges set status = 'OVERDUE' where "membershipId" = $1 and status = 'OPEN'`, [id]);
  await sql(`update members set "joinedAt" = $2::date where id = $1`, [socio.id, inicio]);
  await refrescarSaldo(socio.id);
  return { ...socio, membresiaId: id, periodo: { inicio: m.inicio, fin: m.fin } };
}

/**
 * Un socio SUSPENDIDO (su periodo sigue en curso) con dinero A FAVOR que nadie
 * ha aplicado y que cubre lo que debe, con `sobra` centavos de más (2.13:
 * «Aplicar su saldo a favor y abrir»). La API aplica el saldo a favor en
 * cuanto emite o cobra algo, así que este estado (el de un pago que llegó
 * por fuera y nadie repartió) no se arma con ella: se deja como lo arma la
 * prueba del backend (`test/saldo-a-favor-en-puerta.test.ts`), con un pago
 * por transferencia sin asignar en gymflow_pruebas. Devuelve además cuánto
 * debe y cuánto tiene a favor, en centavos.
 */
export async function socioSuspendidoConSaldoAFavor(api, { sobra = 5000, ...opciones } = {}) {
  const socio = await socioSuspendido(api, { ...opciones, mesesAtras: 0 });
  const [{ debe }] = await sql(`select coalesce(sum("amountCents" - "allocatedCents" - "adjustedCents"), 0)::text as debe from charges
    where "memberId" = $1 and status in ('OPEN','PARTIALLY_PAID','OVERDUE')`, [socio.id]);
  if (!(Number(debe) > 0)) throw new Error(`El suspendido ${socio.memberCode} no debe nada: no hay saldo que aplicar`);
  const aFavor = Number(debe) + sobra;
  await sql(`insert into payments (id, "organizationId", "memberId", "branchId", method, status, "amountCents", "unappliedCents", "businessDate", "externalRef", "updatedAt")
    select gen_random_uuid(), m."organizationId", m.id, m."homeBranchId", 'SPEI_TRANSFER', 'SUCCEEDED', $2::bigint, $2::bigint, $3::date, $4, now()
    from members m where m.id = $1`, [socio.id, aFavor, hoy(), `REC${sufijo().toUpperCase()}`]);
  await refrescarSaldo(socio.id);
  return { ...socio, debeCents: Number(debe), aFavorCents: aFavor };
}

/**
 * Un socio en su DÍA DE CORTE: su mensualidad está vigente, el periodo nuevo
 * empezó hoy y su cuota está abierta («Hoy le toca pagar $X»). Es lo que deja
 * la renovación automática de la mañana; aquí se recorre el reloj de su
 * membresía un mes y se emite la cuota, como lo haría el cierre diario.
 */
export async function socioEnDiaDeCorte(api, opciones = {}) {
  const socio = await crearSocio(api, opciones);
  const [y, mes, d] = hoy().split('-').map(Number);
  if (d > 28) return null; // el día 29-31 el mes anterior no siempre tiene ese día: no hay corte limpio
  const inicio = new Date(Date.UTC(y, mes - 2, d)).toISOString().slice(0, 10);
  const venta = await venderMembresia(api, socio, { plan: opciones.plan ?? 'MEN', inicio, motivo: 'Historial del recorrido de prueba' });
  const id = venta.membership.id;
  const [m] = await sql(`update memberships set "currentPeriodStart" = "currentPeriodEnd",
      "currentPeriodEnd" = ("currentPeriodEnd" + interval '1 month')::date
    where id = $1 and status = 'ACTIVE' and "currentPeriodEnd" = $2::date returning "currentPeriodStart"`, [id, hoy()]);
  if (!m) throw new Error(`La membresía ${id} no termina hoy: no se puede armar su día de corte`);
  await api.post(`/memberships/${id}/period-charge`);
  await refrescarSaldo(socio.id);
  return { ...socio, membresiaId: id };
}

/** Código de activación del portal para ese socio (lo que entrega recepción). */
export async function invitacionPortal(api, socio) {
  return (await api.post(`/members/${socio.id ?? socio}/portal-invite`, {})).code;
}

/**
 * Una clase propia de la corrida, con su horario en la sede: un día (mañana,
 * por omisión) a la hora dicha, sin coach. Devuelve el tipo, el horario y sus
 * sesiones generadas. Se retira con `retirarClase` al terminar.
 */
export async function crearClase(api, { nombre = `Clase ${letras(5)}`, sede = 'CEN', dias = [1], hora = '20:00', duracion = 50, cupo = 12, precio = 12000, coach = null, salon = 'Salón de pruebas' } = {}) {
  const c = await catalogo(api);
  const tipo = await api.post('/classes/types', { name: nombre, defaultDurationMin: duracion, defaultCapacity: cupo, dropInPriceCents: String(precio) });
  const [hh, mm] = hora.split(':').map(Number);
  const fechas = dias.map((n) => dia(n));
  const horario = await api.post('/classes/templates', {
    branchId: c.sede(sede).id, classTypeId: tipo.id, coachUserId: coach, room: salon, effectiveFrom: hoy(),
    slots: [...new Set(fechas.map(diaDeLaSemana))].map((weekday) => ({ weekday, startMinute: hh * 60 + mm, durationMin: duracion, capacity: cupo })),
  });
  const desde = new Date().toISOString();
  const hasta = new Date(Date.now() + 9 * 86_400_000).toISOString();
  const { schedules } = await api.get(`/classes/schedules?branchId=${c.sede(sede).id}&from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`);
  return { tipo, horario, sesiones: schedules.filter((s) => s.classTypeId === tipo.id) };
}
/** Retira una clase propia: sus horarios y sus sesiones futuras (con sus reservas). */
export const retirarClase = (api, tipo, motivo = 'Termina el recorrido de prueba') => api.post(`/classes/types/${tipo.id ?? tipo}/retire`, { reason: motivo });

/**
 * Un retiro de caja autorizado en el mostrador (la dueña teclea su
 * contraseña): queda en el turno y en la bitácora con quién autorizó. Lo pide
 * `api` (el gerente) en el turno abierto de la sede.
 */
export async function retiroAutorizado(api, { sede = 'CEN', centavos = 100, motivo = 'Retiro de prueba a caja fuerte', autoriza = 'owner@demo.mx', clave = 'GymFlow.dev.2026' } = {}) {
  const c = await catalogo(api);
  const branchId = c.sede(sede).id;
  const { sessions } = await api.get(`/cash-sessions?branchId=${branchId}&status=OPEN`);
  const turno = sessions[0];
  if (!turno) throw new Error(`No hay turno abierto en ${sede} para el retiro`);
  const { approvalToken } = await api.post('/approvals', {
    email: autoriza, password: clave, permission: 'cash:withdraw', branchId,
    resourceType: 'CashSession', resourceId: turno.id, amountCents: String(centavos),
  });
  return api.post(`/cash-sessions/${turno.id}/movements`, { movementType: 'WITHDRAWAL', amountCents: String(centavos), reason: motivo, approvalToken });
}
