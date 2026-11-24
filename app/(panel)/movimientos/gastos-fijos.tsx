'use client';

import { useCallback, useState } from 'react';
import { Landmark, Plus, Repeat, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { capital, dia, nombreMes, pesos } from '@/lib/format';
import { useSession, errorText, useToast } from '@/components/session';
import { Badge, Button, Callout, CampoFecha, CampoMotivo, Card, Dialog, Empty, ERROR_MOTIVO, ErrorCarga, faltaMotivo, Field, Skeleton, Switch } from '@/components/ui';
import { useFormulario } from '@/lib/formulario';
import { useCarga } from '@/lib/carga';
import type { Expense, ExpenseList, ExpensePayees, ExpenseProposal, FrecuenciaDeGasto, RecurringExpense, RecurringExpenseList } from '@gymflow/core/contracts';
import { GLOSARIO } from '@/lib/glosario';
// Bloque 4.3 (caja): edición puntual. Con una caja abierta, el retiro del dueño en efectivo se registra desde Caja.
import { AvisoRetiroDesdeCaja } from '@/components/caja';

type Gasto = Expense;
const RETIRO = 'OWNER_DRAW';
const NOMINA = 'PAYROLL';
const CATEGORIA: Record<string, string> = {
  RENT: 'Renta', PAYROLL: 'Nómina', UTILITIES: 'Luz, agua y gas', SERVICES: 'Servicios (internet, software, limpieza)',
  MAINTENANCE: 'Mantenimiento', MARKETING: 'Publicidad', TAXES: 'Impuestos', OTHER: 'Otro',
  // Se anota junto a los gastos, pero no resta de la ganancia (D-23).
  [RETIRO]: GLOSARIO.retiroDueno.nombre,
};
const CADA: Record<FrecuenciaDeGasto, string> = { MONTHLY: 'cada mes', BIWEEKLY: 'cada quincena (el 15 y el último día)', WEEKLY: 'cada semana' };
const CADA_CORTO: Record<FrecuenciaDeGasto, string> = { MONTHLY: 'cada mes', BIWEEKLY: 'cada quincena', WEEKLY: 'cada semana' };
/** Quién ve la nómina por persona (D-26): se dice donde se anota. */
const QUIEN_VE_LA_NOMINA = 'Cuánto se le paga a cada persona lo ve quien tiene Movimientos: la dueña y la gerencia a la que se lo liberó.';
const OTRA_PERSONA = '__otra__';
// El mes se nombra como en el Tablero y en el cierre («octubre de 2026», `lib/format`): antes aquí decía «octubre 2026» y el
// mismo mes se leía de dos maneras entre «Cerrar octubre de 2026» y «Ajuste de octubre 2026» (3.13).
const otroMes = (m: string, n: number) => { const d = new Date(`${m}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const ultimoDiaDe = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const aCentavos = (monto: string) => (/^\d+(\.\d{1,2})?$/.test(monto.trim()) ? BigInt(Math.round(Number(monto) * 100)) : null);
const enPesos = (cents: string) => { const n = BigInt(cents); return n % 100n === 0n ? (n / 100n).toString() : (Number(n) / 100).toFixed(2); };
/** A quién o de qué es: el nombre de la persona en la nómina por pago; en lo demás, la descripción. */
const titulo = (x: { payeeName: string | null; description: string }) => x.payeeName ?? x.description;

/**
 * GASTOS FIJOS (UXB-02): renta, nómina, luz. Sin ellos la "ganancia" solo
 * era caja. Se registran por mes; la ganancia de cada día lleva su parte.
 *
 * Fase 3, bloque 3.7:
 *  - D-23 · Los anota la dueña, haya o no gerente, y la gerencia con
 *    Movimientos liberado. Aquí va también el «Retiro del dueño», que se ve
 *    pero no resta.
 *  - D-22 · En un mes cerrado nada se registra ni se anula: se anota en el mes
 *    en curso como «ajuste de ‹mes›». La pantalla lo dice antes de enviar.
 *
 * Fase 4, bloque 4.5 (D-26):
 *  - La nómina se anota POR PAGO: fecha, a quién y cuánto. La que ya estaba
 *    anotada como un total del mes se queda como está, y se dice.
 *  - Lo que se repite (la renta, la luz, la nómina fija) se PROPONE cada
 *    periodo «por confirmar»: alguien lo confirma, corrige el importe o lo
 *    descarta. Lo que sigue por confirmar no cuenta en ninguna cifra.
 */
export function GastosFijos({ sede, hoy, compacto, onCambio }: { sede: string; hoy: string; compacto?: boolean; onCambio: () => void }) {
  const { can, canOrg, branchName, branches, inScope } = useSession();
  const toast = useToast();
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [nuevo, setNuevo] = useState<'gasto' | 'repetir' | null>(null);
  const [anular, setAnular] = useState<Gasto | null>(null);
  const [confirmar, setConfirmar] = useState<Propuesta | null>(null);
  const [descartar, setDescartar] = useState<Propuesta | null>(null);
  const [terminar, setTerminar] = useState<RecurringExpense | null>(null);
  const cargar = useCallback(() => api<ExpenseList>(`/expenses?month=${mes}`), [mes]);
  const carga = useCarga(cargar);
  const cargarRepetidos = useCallback(() => api<RecurringExpenseList>(`/expenses/recurring?month=${mes}`), [mes]);
  const repetidos = useCarga(cargarRepetidos);
  // Al cambiar de mes no se ven los gastos del anterior (useCarga los suelta).
  const gastos = carga.datos?.expenses ?? null;
  const cerrado = carga.datos?.closed ?? false;
  const enCurso = carga.datos?.currentMonth ?? hoy.slice(0, 7);
  const hoyGimnasio = carga.datos?.today ?? hoy;
  const listo = () => { void carga.recargar(); void repetidos.recargar(); onCambio(); };
  const deLaSede = (x: { branchId: string | null }) => !sede || x.branchId === sede || x.branchId === null;
  const visibles = (gastos ?? []).filter(deLaSede);
  const vivos = visibles.filter((g) => !g.voidedAt);
  const total = vivos.filter((g) => g.category !== RETIRO).reduce((a, g) => a + BigInt(g.amountCents), 0n);
  const retiros = vivos.filter((g) => g.category === RETIRO).reduce((a, g) => a + BigInt(g.amountCents), 0n);
  const gestiona = can('expenses:manage');
  const quien = 'Los anotan la dueña y la gerencia.';
  const oculta = carga.datos?.hiddenPayroll ?? null;

  // Lo que se repite y lo que propone para este mes.
  const plantillas = (repetidos.datos?.recurring ?? []).filter(deLaSede);
  const plantilla = new Map(plantillas.map((r) => [r.id, r]));
  const propuestas: Propuesta[] = (repetidos.datos?.proposals ?? []).flatMap((p) => { const de = plantilla.get(p.recurringId); return de ? [{ ...p, de }] : []; });
  const porConfirmar = propuestas.filter((p) => p.status === 'PENDING' && p.dueOn <= hoyGimnasio);
  const despues = propuestas.filter((p) => p.status === 'PENDING' && p.dueOn > hoyGimnasio);
  const descartadas = propuestas.filter((p) => p.status === 'SKIPPED');
  const sumaPorConfirmar = porConfirmar.reduce((a, p) => a + BigInt(p.de.amountCents), 0n);
  const sedesMias = branches.filter((b) => b.isActive && inScope(b.id));

  return (
    <Card className="mt-16" title={cerrado ? <>Gastos fijos <Badge tone="ok">Mes cerrado</Badge></> : 'Gastos fijos'} pad={false}
      sub={gastos ? `${nombreMes(mes)} · ${pesos(total, { decimals: false })} en gastos${retiros > 0n ? ` · ${pesos(retiros, { decimals: false })} en retiros del dueño (no restan)` : ''}` : nombreMes(mes)}
      actions={<div className="row gap-6">
        <Button size="sm" variant="ghost" aria-label="Mes anterior" onClick={() => setMes(otroMes(mes, -1))}>‹</Button>
        <Button size="sm" variant="ghost" aria-label="Mes siguiente" disabled={mes >= hoy.slice(0, 7)} onClick={() => setMes(otroMes(mes, 1))}>›</Button>
        {gestiona && <Button size="sm" icon={<Plus />} onClick={() => setNuevo('gasto')}>{cerrado ? 'Anotar ajuste' : 'Registrar'}</Button>}
      </div>}>
      {cerrado && <p className="card-body small muted" data-testid="gastos-mes-cerrado">{capital(nombreMes(mes))} está cerrado y sus cifras no cambian. Lo que falte o sobre se anota en {nombreMes(enCurso)} como «ajuste de {nombreMes(mes)}».</p>}

      {/* D-26: lo que se repite se propone; no cuenta hasta que alguien lo confirma. */}
      {porConfirmar.length > 0 && (
        <div className="gastos-por-confirmar" data-testid="gastos-por-confirmar">
          <div className="row-between wrap gap-6">
            <span className="small strong">{GLOSARIO.porConfirmar.nombre} <Badge tone="warn">{porConfirmar.length}</Badge></span>
            <span className="tiny muted">{pesos(sumaPorConfirmar, { decimals: false })} propuestos · no cuentan en ninguna cifra hasta confirmarlos</span>
          </div>
          <ul className="list">
            {porConfirmar.map((p) => (
              <li key={`${p.recurringId}:${p.dueOn}`} className="list-item" data-testid="propuesta">
                <div className="flex-1 min-w-0">
                  <div className="strong small">{titulo(p.de)}</div>
                  <div className="tiny muted">
                    {CATEGORIA[p.de.category] ?? p.de.category} · {CADA_CORTO[p.de.frequency]} · tocaba el {dia(p.dueOn)} · {p.de.branchId ? branchName(p.de.branchId) : 'Todo el gimnasio'}
                    {p.de.payeeInactive ? ' · ya no está activa en el personal' : ''}
                  </div>
                </div>
                <span className="num strong">{pesos(p.de.amountCents, { decimals: false })}</span>
                {gestiona && <>
                  <Button size="sm" onClick={() => setConfirmar(p)}>Confirmar</Button>
                  <Button size="sm" variant="ghost" aria-label={`Descartar ${titulo(p.de)} del ${dia(p.dueOn)}`} onClick={() => setDescartar(p)}>Descartar</Button>
                </>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {carga.error ? <div className="card-body"><ErrorCarga titulo="No se pudieron cargar los gastos fijos" mensaje={carga.error} onReintentar={() => void carga.recargar()} /></div>
        : gastos === null ? <div className="card-body"><Skeleton h={80} /></div> : visibles.length === 0 ? compacto ? (
        // Sin movimientos ya hay un aviso arriba: aquí basta una línea.
        <p className="card-body small muted">{gestiona ? 'Aún no registras renta, nómina ni servicios.' : quien}</p>
      ) : (
        <Empty icon={<Landmark />} title="Sin gastos fijos este mes" text={gestiona ? 'Registra la renta, los pagos de nómina y los servicios para que la ganancia sea ganancia.' : quien} />
      ) : (
        <ul className="list">
          {visibles.map((g) => {
            const apagado = !!g.voidedAt || !!g.correctedInMonth;
            // La nómina de antes de la nómina por pago: un total, sin persona ni fecha. Se queda como está.
            const enTotal = g.category === NOMINA && !g.payeeName;
            return (
              <li key={g.id} className={`list-item${apagado ? ' gasto-apagado' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="strong small">{titulo(g)}</div>
                  <div className="tiny muted">
                    {CATEGORIA[g.category] ?? g.category}{g.paidOn ? ` · pagado el ${dia(g.paidOn)}` : ''} · {g.branchId ? branchName(g.branchId) : 'Todo el gimnasio'}
                    {g.payeeName && g.description !== 'Pago de nómina' ? ` · ${g.description}` : ''}
                    {enTotal ? ' · anotada como un total, sin persona ni fecha' : ''}
                    {g.voidedAt ? ` · Anulado: ${g.voidReason}` : ''}
                    {g.correctedInMonth ? ` · Corregido con un ajuste en ${nombreMes(g.correctedInMonth)}` : ''}
                  </div>
                </div>
                {g.adjustsMonth && <Badge tone="info">Ajuste de {nombreMes(g.adjustsMonth)}</Badge>}
                {g.recurringId && <Badge>Se repite</Badge>}
                {g.category === RETIRO && <Badge>No resta</Badge>}
                <span className={`num strong${g.voidedAt ? ' gasto-tachado' : ''}`}>{pesos(g.amountCents, { decimals: false })}</span>
                {gestiona && !apagado && <Button size="sm" variant="ghost" icon={<X />} aria-label={`${cerrado ? 'Corregir' : 'Anular'} ${titulo(g)}`} onClick={() => setAnular(g)} />}
              </li>
            );
          })}
        </ul>
      )}
      {oculta && <p className="card-body small muted" data-testid="nomina-oculta">Además, {oculta.count === 1 ? 'un pago de nómina' : `${oculta.count} pagos de nómina`} por {pesos(oculta.amountCents, { decimals: false })} que no se muestran aquí: a quién y cuánto lo ve quien tiene Movimientos.</p>}

      {/* Lo que se repite: de aquí salen las propuestas. */}
      {(plantillas.length > 0 || gestiona) && !repetidos.error && (
        <details className="gastos-se-repiten" data-testid="gastos-se-repiten">
          <summary className="small strong"><Repeat size={14} aria-hidden /> Lo que se repite{plantillas.length > 0 ? ` (${plantillas.length})` : ''}</summary>
          <p className="tiny muted">{GLOSARIO.porConfirmar.explica}</p>
          {plantillas.length === 0 ? <p className="small muted">Nada se repite todavía. Al registrar la renta o un pago de nómina, marca «Se repite».</p> : (
            <ul className="list">
              {plantillas.map((r) => (
                <li key={r.id} className="list-item">
                  <div className="flex-1 min-w-0">
                    <div className="strong small">{titulo(r)}</div>
                    <div className="tiny muted">{CATEGORIA[r.category] ?? r.category} · {CADA[r.frequency]} · desde el {dia(r.startsOn)} · {r.branchId ? branchName(r.branchId) : 'Todo el gimnasio'}{r.payeeInactive ? ' · ya no está activa en el personal' : ''}</div>
                  </div>
                  <span className="num strong">{pesos(r.amountCents, { decimals: false })}</span>
                  {gestiona && <Button size="sm" variant="ghost" onClick={() => setTerminar(r)}>Dejar de repetir</Button>}
                </li>
              ))}
            </ul>
          )}
          {despues.length > 0 && <p className="tiny muted">En lo que queda de {nombreMes(mes)} se propondrán {despues.length === 1 ? 'uno más' : `${despues.length} más`}: {despues.slice(0, 4).map((p) => `${titulo(p.de)} el ${dia(p.dueOn)}`).join(', ')}{despues.length > 4 ? '…' : ''}.</p>}
          {descartadas.length > 0 && <p className="tiny muted">Descartados en {nombreMes(mes)}: {descartadas.map((p) => `${titulo(p.de)} del ${dia(p.dueOn)}${p.skippedByName ? ` (${p.skippedByName}${p.skipReason ? `: ${p.skipReason}` : ''})` : ''}`).join('; ')}.</p>}
          {gestiona && !cerrado && mes === enCurso && <div className="mt-8"><Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setNuevo('repetir')}>Agregar uno que se repite</Button></div>}
        </details>
      )}
      {repetidos.error && <div className="card-body"><ErrorCarga titulo="No se pudo cargar lo que se repite" mensaje={repetidos.error} onReintentar={() => void repetidos.recargar()} /></div>}

      {nuevo && <NuevoGasto mes={mes} hoy={hoyGimnasio} soloRepetir={nuevo === 'repetir'} ajusteEn={cerrado ? enCurso : null} sedes={sedesMias} todoElGimnasio={canOrg('expenses:manage')} sedeInicial={sede}
        onClose={() => setNuevo(null)}
        onListo={(texto) => { setNuevo(null); toast('ok', texto ?? (cerrado ? `Ajuste de ${nombreMes(mes)} anotado en ${nombreMes(enCurso)}` : 'Gasto registrado')); listo(); }} />}
      {anular && <AnularGasto gasto={anular} ajusteEn={cerrado ? enCurso : null} onClose={() => setAnular(null)}
        onListo={() => { setAnular(null); toast('ok', cerrado ? `Corregido con un ajuste en ${nombreMes(enCurso)}` : 'Gasto anulado'); listo(); }} />}
      {confirmar && <ConfirmarPropuesta propuesta={confirmar} hoy={hoyGimnasio} enCurso={enCurso} onClose={() => setConfirmar(null)}
        onListo={(texto) => { setConfirmar(null); toast('ok', texto); listo(); }} />}
      {descartar && <DescartarPropuesta propuesta={descartar} onClose={() => setDescartar(null)}
        onListo={() => { setDescartar(null); toast('ok', 'Descartado: no se anotó ningún gasto'); listo(); }} />}
      {terminar && <DejarDeRepetir gasto={terminar} onClose={() => setTerminar(null)}
        onListo={() => { setTerminar(null); toast('ok', 'Ya no se va a proponer'); listo(); }} />}
    </Card>
  );
}

type Propuesta = ExpenseProposal & { de: RecurringExpense };

/**
 * Registrar un gasto, un pago de nómina o un retiro del dueño.
 * `ajusteEn`: el mes está cerrado y esto se anota en ese otro mes (el mes en curso) como «ajuste de ‹mes›» (D-22).
 * `soloRepetir`: no anota nada ahora; deja el gasto para que se proponga cada periodo (D-26).
 */
function NuevoGasto({ mes, hoy, soloRepetir, ajusteEn, sedes, todoElGimnasio, sedeInicial, onClose, onListo }: {
  mes: string; hoy: string; soloRepetir: boolean; ajusteEn: string | null; sedes: Array<{ id: string; name: string }>; todoElGimnasio: boolean; sedeInicial: string;
  onClose: () => void; onListo: (texto?: string) => void;
}) {
  const [categoria, setCategoria] = useState('RENT');
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [sede, setSede] = useState(sedeInicial || (todoElGimnasio ? '' : sedes[0]?.id ?? ''));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // La nómina es por pago (D-26): fecha y a quién.
  const finDelMes = ultimoDiaDe(mes);
  const tope = finDelMes < hoy ? finDelMes : hoy;
  const [pagadoEl, setPagadoEl] = useState(soloRepetir ? hoy : tope);
  const [persona, setPersona] = useState('');
  const [nombre, setNombre] = useState('');
  const [seRepite, setSeRepite] = useState(soloRepetir);
  const [cada, setCada] = useState<FrecuenciaDeGasto>('MONTHLY');
  const cargarPersonal = useCallback(() => api<ExpensePayees>('/expenses/payees').then((x) => x.payees), []);
  const personal = useCarga(cargarPersonal);

  const esRetiro = categoria === RETIRO;
  const esNomina = categoria === NOMINA;
  // Lo que se repite empieza a proponerse desde el mes en curso: desde un mes pasado propondría de golpe todo lo que «tocaba».
  const puedeRepetirse = !esRetiro && !ajusteEn && mes >= hoy.slice(0, 7);
  const repite = puedeRepetirse && (seRepite || soloRepetir);
  const frecuencia: FrecuenciaDeGasto = esNomina ? cada : 'MONTHLY';
  const cents = aCentavos(monto);
  const aQuien = persona === OTRA_PERSONA ? (nombre.trim().length >= 2 ? { payeeName: nombre.trim() } : null) : persona ? { payeeUserId: persona } : null;
  const valido = cents !== null && cents > 0n && (sede !== '' || todoElGimnasio)
    && (esNomina ? aQuien !== null && !!pagadoEl : descripcion.trim().length >= 3);

  async function guardar() {
    setEnviando(true); setError(null);
    try {
      const comun = { category: categoria, amountCents: cents!.toString(), branchId: sede || null, ...(descripcion.trim() ? { description: descripcion.trim() } : {}), ...(esNomina ? aQuien : {}) };
      if (soloRepetir) {
        await api('/expenses/recurring', { method: 'POST', body: JSON.stringify({ ...comun, frequency: frecuencia, startsOn: esNomina ? pagadoEl : `${mes}-01` }) });
        onListo('Listo: se propondrá cada vez que toque, por confirmar');
        return;
      }
      await api('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          ...comun, ...(esNomina ? { paidOn: pagadoEl } : { month: mes }),
          ...(ajusteEn ? { asAdjustment: true } : {}), ...(repite ? { repeat: frecuencia } : {}),
        }),
      });
      onListo(ajusteEn ? undefined : esNomina ? `Pago de nómina anotado${repite ? `; se propondrá ${CADA_CORTO[frecuencia]}` : ''}` : repite ? 'Gasto registrado; se propondrá cada mes' : undefined);
    } catch (e) { setError(errorText(e, 'No se pudo registrar')); } finally { setEnviando(false); }
  }

  const tituloDialogo = soloRepetir ? 'Gasto que se repite'
    : ajusteEn ? `Ajuste de ${nombreMes(mes)}`
      : esRetiro ? `Retiro del dueño de ${nombreMes(mes)}`
        : esNomina ? `Pago de nómina de ${nombreMes(mes)}` : `Gasto fijo de ${nombreMes(mes)}`;
  const sub = soloRepetir ? 'No se anota nada ahora: cada vez que toque aparecerá «por confirmar».'
    : ajusteEn ? `${capital(nombreMes(mes))} está cerrado: se anota en ${nombreMes(ajusteEn)}, etiquetado como ajuste.`
      : esRetiro ? GLOSARIO.retiroDueno.explica
        : esNomina ? GLOSARIO.pagoNomina.explica : 'Se reparte entre los días del mes al calcular la ganancia.';
  return (
    <Dialog open onClose={onClose} error={error} title={tituloDialogo} sub={sub}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={enviando} disabled={!valido} onClick={() => void guardar()}>{soloRepetir ? 'Dejar que se repita' : ajusteEn ? 'Anotar ajuste' : 'Registrar'}</Button></>}>
      <div className="stack">
        <Field label="Tipo" htmlFor="gf-c">
          <select id="gf-c" className="select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {Object.entries(CATEGORIA).filter(([k]) => !soloRepetir || k !== RETIRO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {esRetiro && !ajusteEn && <AvisoRetiroDesdeCaja />}
        {esNomina ? (
          <>
            <Field label="A quién" htmlFor="gf-q" hint={QUIEN_VE_LA_NOMINA}>
              <select id="gf-q" className="select" value={persona} onChange={(e) => setPersona(e.target.value)}>
                <option value="">{personal.datos ? 'Elige a la persona…' : personal.error ? 'No se pudo cargar al personal' : 'Cargando…'}</option>
                {(personal.datos ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.role ? ` · ${p.role}` : ''}{p.active ? '' : ' (ya no está activa)'}</option>)}
                <option value={OTRA_PERSONA}>Otra persona (escribir su nombre)…</option>
              </select>
            </Field>
            {persona === OTRA_PERSONA && (
              <Field label="Nombre de la persona" htmlFor="gf-n" hint="Para quien no tiene cuenta en GymFlow (limpieza, mantenimiento).">
                <input id="gf-n" className="input" autoFocus value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} />
              </Field>
            )}
            <div className="grid grid-2 gap-12">
              <Field label={soloRepetir ? 'Se propone desde' : 'Fecha del pago'} htmlFor="gf-f">
                {soloRepetir
                  ? <CampoFecha id="gf-f" value={pagadoEl} min={`${mes}-01`} hoy={hoy} onChange={(v) => { if (v) setPagadoEl(v); }} />
                  : <CampoFecha id="gf-f" value={pagadoEl} min={`${mes}-01`} max={tope} hoy={hoy} onChange={(v) => { if (v) setPagadoEl(v); }} />}
              </Field>
              <Field label="Importe del pago" htmlFor="gf-m"><input id="gf-m" className="input num" inputMode="decimal" value={monto} placeholder="6000" onChange={(e) => setMonto(e.target.value)} /></Field>
            </div>
            <div className="grid grid-2 gap-12">
              <Field label="Sucursal" htmlFor="gf-s">
                <select id="gf-s" className="select" value={sede} onChange={(e) => setSede(e.target.value)}>
                  {todoElGimnasio && <option value="">Todo el gimnasio</option>}
                  {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Nota (opcional)" htmlFor="gf-d">
                <input id="gf-d" className="input" value={descripcion} maxLength={200} placeholder="Primera quincena" onChange={(e) => setDescripcion(e.target.value)} />
              </Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Descripción" htmlFor="gf-d" hint="Queda en la bitácora con tu nombre.">
              <input id="gf-d" className="input" autoFocus value={descripcion} placeholder={esRetiro ? 'Retiro de la quincena' : 'Renta del local de Centro'} onChange={(e) => setDescripcion(e.target.value)} />
            </Field>
            <div className="grid grid-2 gap-12">
              <Field label={esRetiro ? 'Importe' : 'Importe del mes'} htmlFor="gf-m"><input id="gf-m" className="input num" inputMode="decimal" value={monto} placeholder="25000" onChange={(e) => setMonto(e.target.value)} /></Field>
              <Field label="Sucursal" htmlFor="gf-s">
                <select id="gf-s" className="select" value={sede} onChange={(e) => setSede(e.target.value)}>
                  {todoElGimnasio && <option value="">Todo el gimnasio</option>}
                  {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            </div>
          </>
        )}
        {puedeRepetirse && (
          <div className="field" data-testid="se-repite">
            {!soloRepetir && <Switch checked={seRepite} onChange={setSeRepite}>Se repite</Switch>}
            {repite && esNomina && (
              <select className="select mt-4" aria-label="Cada cuánto se repite" value={cada} onChange={(e) => setCada(e.target.value as FrecuenciaDeGasto)}>
                {(['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const).map((f) => <option key={f} value={f}>{capital(CADA[f])}</option>)}
              </select>
            )}
            <span className="hint">{repite
              ? `Se propondrá ${CADA_CORTO[frecuencia]} «por confirmar». No se anota solo: alguien lo confirma, corrige el importe o lo descarta, y mientras tanto no cuenta en ninguna cifra.`
              : 'Márcalo para que se proponga cada periodo, por confirmar.'}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** `ajusteEn`: el gasto es de un mes cerrado; no se anula, se corrige con un ajuste en negativo en ese otro mes (D-22). */
function AnularGasto({ gasto, ajusteEn, onClose, onListo }: { gasto: Gasto; ajusteEn: string | null; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  // El principal queda encendido: si falta el motivo, el campo lo dice (26-02, 26-09; adopción 2.12).
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });
  async function enviar() {
    setError(null);
    try {
      await api(`/expenses/${gasto.id}/void`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim(), ...(ajusteEn ? { asAdjustment: true } : {}) }) });
      onListo();
    } catch (e) { setError(errorText(e, ajusteEn ? 'No se pudo anotar el ajuste' : 'No se pudo anular')); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} error={error} title={`${ajusteEn ? 'Corregir' : 'Anular'} ${titulo(gasto)}`}
      sub={ajusteEn
        ? `${pesos(gasto.amountCents)} · su mes está cerrado y no cambia: se anota en ${nombreMes(ajusteEn)} un ajuste por el mismo importe a favor.`
        : `${pesos(gasto.amountCents)} · no se borra: queda tachado y en la bitácora.${gasto.recurringId ? ' Como se repite, volverá a quedar por confirmar.' : ''}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(enviar)}>{ajusteEn ? 'Anotar ajuste' : 'Anular'}</Button></>}>
      <CampoMotivo id="ag-m" autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')} placeholder="Capturado dos veces" />
    </Dialog>
  );
}

/**
 * Confirmar una propuesta (D-26): ahí nace el gasto. Se puede corregir el
 * importe de esta vez y, si se quiere, dejarlo para las siguientes. Si su mes
 * ya está cerrado, la API lo dice y se ofrece anotarlo como ajuste (D-22).
 */
function ConfirmarPropuesta({ propuesta, hoy, enCurso, onClose, onListo }: { propuesta: Propuesta; hoy: string; enCurso: string; onClose: () => void; onListo: (texto: string) => void }) {
  const r = propuesta.de;
  const esNomina = r.category === NOMINA;
  const [monto, setMonto] = useState(enPesos(r.amountCents));
  const [pagadoEl, setPagadoEl] = useState(propuesta.dueOn);
  const [paraSiempre, setParaSiempre] = useState(false);
  const [mesCerrado, setMesCerrado] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = aCentavos(monto);
  const cambio = cents !== null && cents.toString() !== r.amountCents;
  async function enviar() {
    setEnviando(true); setError(null);
    try {
      await api('/expenses/recurring/confirm', {
        method: 'POST',
        body: JSON.stringify({
          recurringId: r.id, dueOn: propuesta.dueOn, amountCents: cents!.toString(),
          ...(esNomina ? { paidOn: pagadoEl } : {}), ...(cambio && paraSiempre ? { keepAmount: true } : {}), ...(mesCerrado ? { asAdjustment: true } : {}),
        }),
      });
      onListo(mesCerrado ? `Anotado en ${nombreMes(enCurso)} como ajuste de ${nombreMes(mesCerrado)}` : 'Confirmado: ya cuenta como gasto');
    } catch (e) {
      // El mes al que corresponde ya está cerrado: se dice y el segundo toque lo anota como ajuste.
      if (e instanceof ApiError && e.reason === 'MONTH_CLOSED' && !mesCerrado) setMesCerrado((esNomina ? pagadoEl : propuesta.dueOn).slice(0, 7));
      else setError(errorText(e, 'No se pudo confirmar'));
    } finally { setEnviando(false); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} error={error} title={`Confirmar ${titulo(r)}`}
      sub={`${CATEGORIA[r.category] ?? r.category} · ${CADA_CORTO[r.frequency]} · tocaba el ${dia(propuesta.dueOn)}. Al confirmar se anota el gasto y empieza a contar.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button><Button loading={enviando} disabled={cents === null || cents <= 0n || (esNomina && !pagadoEl)} onClick={() => void enviar()}>{mesCerrado ? 'Anotar ajuste' : 'Confirmar'}</Button></>}>
      <div className="stack">
        {mesCerrado && <Callout tone="warn" title={`${capital(nombreMes(mesCerrado))} ya está cerrado`}>Sus cifras no cambian. Se anota en {nombreMes(enCurso)} como «ajuste de {nombreMes(mesCerrado)}».</Callout>}
        <Field label={esNomina ? 'Importe del pago' : 'Importe'} htmlFor="cp-m" hint={cambio ? `Lo propuesto era ${pesos(r.amountCents)}.` : 'Corrígelo si esta vez fue otro.'}>
          <input id="cp-m" className="input num" inputMode="decimal" autoFocus value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Field>
        {cambio && <Switch checked={paraSiempre} onChange={setParaSiempre}>Proponer este importe también las siguientes veces</Switch>}
        {esNomina && (
          <Field label="Fecha del pago" htmlFor="cp-f" hint={QUIEN_VE_LA_NOMINA}>
            <CampoFecha id="cp-f" value={pagadoEl} max={hoy} hoy={hoy} onChange={(v) => { if (v) { setPagadoEl(v); setMesCerrado(null); } }} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/** Descartar una propuesta: esta vez no se pagó. No se anota ningún gasto; queda quién la descartó. */
function DescartarPropuesta({ propuesta, onClose, onListo }: { propuesta: Propuesta; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function enviar() {
    setEnviando(true); setError(null);
    try {
      await api('/expenses/recurring/skip', { method: 'POST', body: JSON.stringify({ recurringId: propuesta.recurringId, dueOn: propuesta.dueOn, ...(motivo.trim() ? { reason: motivo.trim() } : {}) }) });
      onListo();
    } catch (e) { setError(errorText(e, 'No se pudo descartar')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} error={error} title={`Descartar ${titulo(propuesta.de)}`}
      sub={`${pesos(propuesta.de.amountCents)} · tocaba el ${dia(propuesta.dueOn)}. No se anota ningún gasto por esta vez; la siguiente se volverá a proponer.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button><Button variant="danger" loading={enviando} onClick={() => void enviar()}>Descartar</Button></>}>
      <CampoMotivo id="dp-m" autoFocus required={false} value={motivo} onChange={setMotivo} placeholder="Este mes no se pagó" />
    </Dialog>
  );
}

/** Dejar de repetir: no se propone nada más. Lo ya confirmado no cambia. */
function DejarDeRepetir({ gasto, onClose, onListo }: { gasto: RecurringExpense; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });
  async function enviar() {
    setError(null);
    try {
      await api('/expenses/recurring/end', { method: 'POST', body: JSON.stringify({ recurringId: gasto.id, reason: motivo.trim() }) });
      onListo();
    } catch (e) { setError(errorText(e, 'No se pudo dejar de repetir')); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} error={error} title={`Dejar de repetir ${titulo(gasto)}`}
      sub={`${pesos(gasto.amountCents)} ${CADA_CORTO[gasto.frequency]}. Ya no se propondrá, tampoco lo que seguía por confirmar. Los gastos ya confirmados no cambian.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(enviar)}>Dejar de repetir</Button></>}>
      <CampoMotivo id="dr-m" autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')} placeholder="Ya no trabaja aquí" />
    </Dialog>
  );
}
