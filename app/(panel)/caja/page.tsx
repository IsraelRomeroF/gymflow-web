'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Wallet, LockOpen, Calculator, Printer, CircleCheck, TriangleAlert, Clock, User, Banknote, History, ArrowDownUp } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fecha, hora, pesos } from '@/lib/format';
import { aCentavos, DENOMINACIONES, METODO, MOVIMIENTO, TURNO, type Caja, type Corte, type Turno } from '@/lib/caja';
import { AutorizacionDialog } from '@/components/autorizacion';
import { useSession, useToast, errorText, PreguntaCerrarSesion } from '@/components/session';
import { Badge, Button, Callout, CampoMotivo, Card, Dialog, Empty, ERROR_MOTIVO, faltaMotivo, Field, PageHeader, Skeleton, ErrorCarga, EsqueletoTabla } from '@/components/ui';
import { useFormulario } from '@/lib/formulario';
import { AbrirDialog, Diferencia, EstadoRevision, quienResponde, RevisarDialog } from '@/components/caja';
import { useCarga } from '@/lib/carga';
import { Mostrador } from '@/components/mostrador/mostrador';
import type { CashAlerts, CashLimits, CashShiftAllowance } from '@gymflow/core/contracts';
import { AvisosDeCaja, VistaCortes } from './cortes';
import { VentasPorCorregir } from '@/components/cobro/corregir-venta';
import { TopesDelCajon } from '@/components/caja';


/**
 * CAJA — abrir turno, ver cómo va y hacer el corte.
 *
 * Sin esta pantalla el mostrador no puede empezar el día: cobrar en efectivo
 * o con terminal exige un turno abierto. El corte es CIEGO: primero se cuenta
 * el cajón y solo después se revela cuánto debía haber. Si se mostrara antes,
 * se teclearía esa cifra y el corte dejaría de medir nada.
 */
export default function CajaPage() {
  const { can } = useSession();
  // Quien solo consulta (la dueña) ve «Cortes»: lo abierto, los avisos y los cortes, sin botones de operación (7-13, D-17).
  const opera = can('cash:session:open') || can('cash:session:close') || can('cash:withdraw') || can('cash:petty:record');
  return opera ? <CajaDeOperacion /> : <VistaCortes />;
}

function CajaDeOperacion() {
  const { branches, inScope, can, me, activoEn } = useSession();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const [sede, setSede] = useState(sedes[0]?.id ?? '');
  const [cajas, setCajas] = useState<Caja[] | null>(null);
  const [abiertos, setAbiertos] = useState<Turno[]>([]);
  const [historial, setHistorial] = useState<Turno[] | null>(null);
  const router = useRouter();
  // Siete días a la vista y "Ver más" (UX7 Mostrador 9): treinta filas iguales ahogaban la pantalla.
  const [todos, setTodos] = useState(false);
  const visibles = useMemo(() => {
    if (!historial || todos) return historial;
    const dias = [...new Set(historial.map((t) => t.businessDate))].slice(0, 7);
    return historial.filter((t) => dias.includes(t.businessDate));
  }, [historial, todos]);
  const ocultos = (historial?.length ?? 0) - (visibles?.length ?? 0);
  const [abrir, setAbrir] = useState<Caja | null>(null);
  const [cortar, setCortar] = useState<{ turno: Turno; caja: Caja } | null>(null);
  const [mover, setMover] = useState<{ turno: Turno; caja: Caja } | null>(null);
  // D-17 (bloque 4.3): cajas que amanecieron sin cortar y descuadres por revisar de esta sucursal.
  const [avisos, setAvisos] = useState<CashAlerts | null>(null);
  const [porRevisar, setPorRevisar] = useState<Turno[]>([]);
  const [revisar, setRevisar] = useState<Turno | null>(null);
  const puedeRevisar = can('cash:variance:approve');

  const cargar = useCallback(async () => {
    if (!sede) return;
    const [c, a, h] = await Promise.all([
      api<{ registers: Caja[] }>(`/cash-registers?branchId=${sede}`),
      api<{ sessions: Turno[] }>(`/cash-sessions?branchId=${sede}&status=OPEN`),
      api<{ sessions: Turno[] }>(`/cash-sessions?branchId=${sede}&status=CLOSED`),
    ]);
    setCajas(c.registers.filter((x) => x.isActive));
    setAbiertos(a.sessions);
    setHistorial(h.sessions.slice(0, 30));
    // Los avisos son un extra: si no cargan, la caja se sigue pudiendo operar.
    const [av, pr] = await Promise.all([
      api<CashAlerts>(`/cash/alerts?branchId=${sede}`).catch(() => null),
      puedeRevisar ? api<{ sessions: Turno[] }>(`/cash-sessions?branchId=${sede}&variance=PENDING`).catch(() => null) : null,
    ]);
    setAvisos(av);
    setPorRevisar(pr?.sessions ?? []);
  }, [sede, puedeRevisar]);

  const [fallo, setFallo] = useState<string | null>(null);
  const recargar = useCallback(() => {
    setCajas(null); setHistorial(null); setFallo(null);
    void cargar().catch((e) => { setFallo(errorText(e, 'No se pudo cargar la caja')); setCajas([]); setHistorial([]); });
  }, [cargar]);
  useEffect(() => { recargar(); }, [recargar]);

  const porCaja = useMemo(() => new Map(abiertos.map((t) => [t.cashRegisterId, t])), [abiertos]);
  const nombreCaja = useMemo(() => new Map((cajas ?? []).map((c) => [c.id, c])), [cajas]);
  // "Caja 1 · Norte", no "Caja 1 NTE" con "Caja C1" debajo: el código de la sucursal sobra si se dice su nombre.
  const suSede = branches.find((b) => b.id === sede);
  const tituloCaja = (c: Caja) => {
    if (!suSede) return c.name;
    const base = c.name.endsWith(` ${suSede.code}`) ? c.name.slice(0, -(suSede.code.length + 1)) : c.name;
    return base.includes(suSede.name) ? base : `${base} · ${suSede.name}`;
  };

  return (
    <div className="stack gap-24">
      <PageHeader
        title="Caja"
        sub="Abre el turno al empezar y haz el corte al terminar. El efectivo se cuenta antes de ver cuánto debía haber."
        actions={sedes.length > 1 ? (
          <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => setSede(e.target.value)}>
            {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : undefined}
      />

      {avisos && <AvisosDeCaja avisos={avisos} puedeRevisar={puedeRevisar} />}

      {fallo ? <ErrorCarga mensaje={fallo} onReintentar={recargar} /> : cajas === null ? (
        <div className="grid grid-2"><Skeleton h={220} r={16} /><Skeleton h={220} r={16} /></div>
      ) : cajas.length === 0 ? (
        <Card><Empty icon={<Wallet />} title="Esta sucursal no tiene cajas" text="La gerencia las da de alta en Sucursales." /></Card>
      ) : (
        <div className="grid grid-2">
          {cajas.map((c) => {
            const t = porCaja.get(c.id);
            return t
              ? <TurnoAbierto key={c.id} titulo={tituloCaja(c)} turno={t} ajeno={t.openedByUserId !== me.userId}
                // El turno lo corta quien lo abrió, o quien aprueba descuadres (UX5-M-06).
                puedeCerrar={can('cash:session:close') && (t.openedByUserId === me.userId || can('cash:variance:approve'))} puedeMover={can('cash:withdraw') || can('cash:petty:record')}
                  onCorte={() => setCortar({ turno: t, caja: c })} onMovimiento={() => setMover({ turno: t, caja: c })} />
              : <CajaCerrada key={c.id} titulo={tituloCaja(c)} puedeAbrir={can('cash:session:open')} onAbrir={() => setAbrir(c)} />;
          })}
        </div>
      )}

      {/* «¿A quién le cobras?» es el mismo mostrador de Socios y del inicio (bloque 2.1, A1-T2): se busca
          al socio y su tarjeta trae Cobrar, Entrada, Vender y Clase, con el cobro en la sucursal de esta caja. */}
      {can('payments:record') && can('members:read') && abiertos.length > 0 && sede && (
        // Sin tarjeta alrededor (2.12): la lista de resultados y la tarjeta del socio ya son tarjetas, igual que en Socios y en el Inicio.
        <section className="mostrador-seccion" data-testid="a-quien-cobras" aria-labelledby="a-quien-cobras-titulo">
          <h2 className="section-title" id="a-quien-cobras-titulo">¿A quién le cobras?</h2>
          <p className="small muted mostrador-seccion-sub">Busca al socio y atiéndelo sin salir de la caja: cobrar, dar entrada o vender.</p>
          <Mostrador etiqueta="Buscar socio para cobrar" marcador="Nombre, celular o número de socio" grande={false} ayuda={false} limite={6}
            sedeDeCobro={sede} onCambio={() => void cargar()} testid="resultados-caja" />
        </section>
      )}

      {/* D-17 (bloque 4.3): los cortes con más de $20 de diferencia que la gerencia no ha revisado. */}
      {puedeRevisar && porRevisar.length > 0 && (
        <Card title="Descuadres por revisar" sub="Cada uno es de quien abrió el turno. Revísalo y ciérralo con tu nota." pad={false}>
          <ul className="lista-limpia" data-testid="descuadres-por-revisar">
            {porRevisar.map((t) => (
              <li key={t.id} className="card-body row-between gap-8 descuadre-fila">
                <span className="small">
                  <span className="strong">{fecha(t.businessDate)} · {nombreCaja.get(t.cashRegisterId)?.name ?? 'Caja'}</span>{' '}
                  <Diferencia cents={t.varianceCents} /> <span className="muted">· {quienResponde(t)}</span>
                </span>
                <span className="row gap-8">
                  <Link className="btn btn-ghost btn-sm" href={`/caja/${t.id}`}>Ver corte</Link>
                  <Button size="sm" variant="secondary" onClick={() => setRevisar(t)}>Revisar</Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* D-13 (bloque 3.5): lo que recepción marcó en la tienda y falta anular o devolver. */}
      {sede && can('pos:sale:void') && activoEn('pos', sede) && <VentasPorCorregir branchId={sede} />}
      {/* D-15 (bloque 3.5): los topes del cajón del gimnasio. */}
      {can('cash:limits:set') && <TopesDelCajon />}

      <Card title="Cortes anteriores" sub={todos ? 'Los últimos 30 turnos cerrados de esta sucursal.' : 'Los últimos 7 días. Los que no cuadraron van marcados.'} pad={false}>
        {historial === null ? <EsqueletoTabla filas={4} columnas={5} /> : historial.length === 0 ? (
          <Empty icon={<History />} title="Todavía no hay cortes" text="Aparecen aquí en cuanto se cierre el primer turno." />
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead><tr><th>Fecha</th><th>Caja</th><th>De quién fue</th><th className="right num">Esperado</th><th className="right num">Contado</th><th className="right num">Diferencia</th><th /></tr></thead>
              <tbody>
                {visibles!.map((t) => (
                  <tr key={t.id} className={`is-link${t.varianceCents && BigInt(t.varianceCents) !== 0n ? ' fila-descuadre' : ''}`}
                    onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button')) router.push(`/caja/${t.id}`); }}>
                    <td>
                      <div className="strong">{fecha(t.businessDate)}</div>
                      <div className="tiny muted">{t.shiftLabel ? TURNO[t.shiftLabel] : 'Turno'} · {hora(t.openedAt)}–{t.closedAt ? hora(t.closedAt) : ''}</div>
                    </td>
                    <td>{nombreCaja.get(t.cashRegisterId)?.name ?? 'Caja'}</td>
                    <td className="small stack-hide">{quienResponde(t)}</td>
                    <td className="right num stack-hide">{t.expectedCashCents ? pesos(t.expectedCashCents) : '—'}</td>
                    <td className="right num" data-label="Contado">{t.countedCashCents ? pesos(t.countedCashCents) : '—'}</td>
                    <td className="right num" data-label="Diferencia"><Diferencia cents={t.varianceCents} /> <EstadoRevision turno={t} /></td>
                    <td className="right text-right"><Link className="btn btn-ghost btn-sm" href={`/caja/${t.id}`}>Ver corte</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ocultos > 0 && (
              <div className="card-body text-center">
                <Button variant="ghost" size="sm" onClick={() => setTodos(true)}>Ver más ({ocultos} {ocultos === 1 ? 'turno' : 'turnos'})</Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {abrir && <AbrirDialog caja={abrir} onClose={() => setAbrir(null)} onListo={() => { setAbrir(null); void cargar(); }} />}
      {mover && <MovimientoDialog turno={mover.turno} caja={mover.caja} onClose={() => setMover(null)}
        onListo={() => { setMover(null); void cargar(); }} />}
      {cortar && <CorteDialog turno={cortar.turno} caja={cortar.caja} ajeno={cortar.turno.openedByUserId !== me.userId} onClose={() => { setCortar(null); void cargar(); }} />}
      {revisar && <RevisarDialog turno={revisar} caja={nombreCaja.get(revisar.cashRegisterId)?.name ?? 'Caja'} onClose={() => setRevisar(null)}
        onListo={() => { setRevisar(null); void cargar(); }} />}
    </div>
  );
}

function CajaCerrada({ titulo, puedeAbrir, onAbrir }: { titulo: string; puedeAbrir: boolean; onAbrir: () => void }) {
  return (
    <Card title={titulo} actions={<Badge>Cerrada</Badge>}>
      <div className="caja-cerrada">
        <span className="caja-icono"><Wallet /></span>
        <p className="muted small">Sin turno abierto. Mientras siga así, en esta caja no se puede cobrar en efectivo ni con terminal.</p>
        {puedeAbrir
          ? <Button icon={<LockOpen />} onClick={onAbrir}>Abrir turno</Button>
          : <p className="tiny muted">Pide a quien tenga permiso de caja que abra el turno.</p>}
      </div>
    </Card>
  );
}

function TurnoAbierto({ titulo, turno, ajeno, puedeCerrar, puedeMover, onCorte, onMovimiento }: {
  titulo: string; turno: Turno; ajeno: boolean; puedeCerrar: boolean; puedeMover: boolean; onCorte: () => void; onMovimiento: () => void;
}) {
  // Sin red ya no es un esqueleto eterno en los cobros del turno (26-01).
  const corteCarga = useCarga(useCallback(() => api<Corte>(`/cash-sessions/${turno.id}`), [turno]), { conservar: true });
  const corte = corteCarga.datos ?? null;

  // Lo que NO pasa por el cajón sí se muestra; el efectivo se revela al contar.
  const otros = (corte?.byMethod ?? []).filter((m) => m.method !== 'CASH' && BigInt(m.amountCents) !== 0n);
  return (
    <Card title={titulo} actions={<Badge tone="ok" dot>Abierta</Badge>}
      footer={(puedeCerrar || puedeMover) ? <div className="row gap-8">
        {puedeCerrar && <Button icon={<Calculator />} onClick={onCorte}>Hacer corte</Button>}
        {puedeMover && <Button variant="secondary" icon={<ArrowDownUp />} onClick={onMovimiento}>Retiro o gasto</Button>}
      </div> : undefined}>
      <dl className="caja-datos">
        <div><dt><User />Abrió</dt><dd>{turno.openedByName ?? '—'}</dd></div>
        <div><dt><Clock />Desde</dt><dd>{hora(turno.openedAt)}{turno.shiftLabel ? ` · ${TURNO[turno.shiftLabel]}` : ''}</dd></div>
        <div><dt><Banknote />Fondo inicial</dt><dd>{pesos(turno.openingFloatCents)}</dd></div>
      </dl>
      <div className="caja-cobros">
        {corteCarga.error ? <ErrorCarga titulo="No se pudieron cargar los cobros del turno" mensaje={corteCarga.error} onReintentar={() => void corteCarga.recargar()} />
          : corte === null ? <Skeleton h={40} /> : (
          <>
            {otros.length === 0
              ? <p className="small muted">Sin cobros con tarjeta ni transferencia en este turno.</p>
              : otros.map((m) => <div key={m.method} className="row-between small"><span>{METODO[m.method] ?? m.method}</span><span className="num strong">{pesos(m.amountCents)}</span></div>)}
            {corte.movements.length > 0 && (
              <div className="stack-sm mt-8">
                {corte.movements.map((mv) => (
                  <div key={mv.id} className="row-between small">
                    {/* Bloque 4.12: el retiro del dueño se nombra como en la hoja del corte (antes decía «Retiro a caja fuerte»). */}
                    <span>{mv.ownerDraw ? 'Retiro del dueño' : MOVIMIENTO[mv.movementType] ?? mv.movementType} <span className="muted">· {mv.reason}</span></span>
                    <span className="num">{pesos(mv.amountCents)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="tiny muted mt-6">El efectivo no se muestra aquí: se revela en el corte, después de contarlo.</p>
            {/* D-17: el turno es de quien lo abrió, lo corte quien lo corte (7-08: antes la tarjeta ajena no decía nada). */}
            {ajeno && <p className="tiny muted mt-6">{puedeCerrar
              ? `Este turno es de ${turno.openedByName ?? 'quien lo abrió'}: si lo cortas tú, la diferencia queda a su nombre.`
              : `Este turno es de ${turno.openedByName ?? 'quien lo abrió'}: el corte lo hace esa persona o la gerencia.`}</p>}
          </>
        )}
      </div>
    </Card>
  );
}

type Resultado = { varianceCents: string; varianceKind: 'EXACT' | 'SHORT' | 'OVER'; varianceStatus: Turno['varianceStatus']; responsibleName: string | null };

function CorteDialog({ turno, caja, ajeno, onClose }: { turno: Turno; caja: Caja; ajeno: boolean; onClose: () => void }) {
  const toast = useToast();
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [paso, setPaso] = useState<'contar' | 'motivo' | 'listo'>('contar');
  const [revelado, setRevelado] = useState<Corte | null>(null);
  // La diferencia que dijo el servidor al rechazar el cierre sin motivo. Quien
  // cuenta ve el corte a ciegas (sin el esperado) mientras el turno siga
  // abierto: restar del conteo un esperado que no llegó daba «Sobran ‹todo lo
  // contado›» y «Debía haber $0.00» (1.1 §7, defecto 2). `null`: todavía no se sabe
  // (un segundo conteo se explica antes de que el servidor diga si cuadra).
  const [diferencia, setDiferencia] = useState<bigint | null>(null);
  const [motivo, setMotivo] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, setEnviando] = useState(false);
  // «Cerrar con diferencia» queda encendido: si falta el motivo, el campo lo dice (26-02, 26-09).
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });

  const total = DENOMINACIONES.reduce((s, d, i) => s + BigInt(d.cents) * BigInt(Number(conteo[i] || 0) || 0), 0n);

  async function cerrar(varianceReason?: string) {
    setEnviando(true);
    try {
      const r = await api<Resultado>(`/cash-sessions/${turno.id}/close`, {
        method: 'POST', body: JSON.stringify({ countedCashCents: total.toString(), ...(varianceReason ? { varianceReason } : {}) }),
      });
      setResultado(r);
      setPaso('listo');
    } catch (e) {
      const msg = errorText(e, 'No se pudo cerrar el turno');
      // Hay diferencia: AHORA sí se revela cuánto debía haber, con el conteo
      // ya fijo, y se pide el motivo.
      if (/exige motivo|segundo conteo/i.test(msg)) {
        const corte = await api<Corte>(`/cash-sessions/${turno.id}`);
        // La diferencia viene en la respuesta del cierre («… (diferencia: -12300 centavos)»);
        // si no, y quien corta sí ve el esperado (gerencia), sale de ahí.
        const dicha = /diferencia:\s*(-?\d+)\s*centavos/i.exec(msg);
        setDiferencia(dicha ? BigInt(dicha[1]!) : corte.expectedCashCents !== null ? total - BigInt(corte.expectedCashCents) : null);
        setRevelado(corte);
        setPaso('motivo');
      } else toast('error', msg);
    } finally { setEnviando(false); }
  }

  if (paso === 'listo' && resultado) {
    const v = BigInt(resultado.varianceCents);
    return (
      <Dialog key="hecho" open onClose={onClose} title="Corte hecho" sub={`${caja.name} · turno cerrado a las ${hora(new Date().toISOString())}`}
        footer={<><Button variant="secondary" onClick={onClose}>Listo</Button><Link className="btn btn-primary" href={`/caja/${turno.id}`}><Printer />Ver e imprimir corte</Link></>}>
        <div className="stack">
          <div className="corte-veredicto" data-kind={resultado.varianceKind}>
            {v === 0n ? <CircleCheck /> : <TriangleAlert />}
            <div>
              <p className="strong">{v === 0n ? 'La caja cuadró' : v < 0n ? `Faltaron ${pesos(-v)}` : `Sobraron ${pesos(v)}`}</p>
              <p className="small muted">{v === 0n ? 'El efectivo contado es exactamente el esperado.'
                // D-17: de quién es, y si pasa de $20 queda por revisar.
                : `Quedó registrado con su motivo, a nombre de ${resultado.responsibleName ?? 'quien abrió el turno'}${resultado.varianceStatus === 'PENDING' ? ', y por revisar: la gerencia lo revisa y lo cierra con su nota.' : '; se ve en el corte.'}`}</p>
            </div>
          </div>
          {/* Lo que debía haber sale del cierre mismo: lo contado menos la diferencia. */}
          <Cifras esperado={total - v} contado={total} />
          {/* D-04 (bloque 4.1): cortada la caja, el mostrador pregunta si también se cierra la sesión. */}
          <PreguntaCerrarSesion />
        </div>
      </Dialog>
    );
  }

  if (paso === 'motivo' && revelado) {
    return (
      <Dialog key="motivo" open onClose={onClose} title="La caja no cuadra" sub="El conteo ya quedó fijo. Explica la diferencia para poder cerrar."
        footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={enviando} onClick={() => void f.enviar(() => cerrar(motivo.trim()))}>Cerrar con diferencia</Button></>}>
        <div className="stack">
          {diferencia !== null && diferencia !== 0n && (
            <Callout tone={diferencia < 0n ? 'danger' : 'warn'} title={diferencia < 0n ? `Faltan ${pesos(-diferencia)}` : `Sobran ${pesos(diferencia)}`}>
              {diferencia < 0n ? 'Hay menos efectivo del que registró el sistema.' : 'Un sobrante suele ser un cobro que no se registró.'}
            </Callout>
          )}
          <Cifras esperado={diferencia === null ? null : total - diferencia} contado={total} />
          {revelado.session.firstCountedCashCents && BigInt(revelado.session.firstCountedCashCents) !== total && (
            <Callout tone="warn" title="Es un segundo conteo">
              El primero fue de {pesos(revelado.session.firstCountedCashCents)}. Los dos quedan en el corte; explica por qué cambió.
            </Callout>
          )}
          {ajeno && <p className="small muted">Este turno lo abrió {turno.openedByName ?? 'otra persona'}: la diferencia queda a su nombre, no al tuyo.</p>}
          <CampoMotivo id="motivo" renglones={3} autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')}
            hint="Queda en el corte y en la bitácora." placeholder="Ej. Se dio cambio de más a un socio; cobro de agua sin registrar" />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog key="conteo" open size="lg" onClose={onClose} title={`Corte · ${caja.name}`} sub="Cuenta el efectivo del cajón, incluido el fondo. Después verás si cuadra."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={<Calculator />} loading={enviando} onClick={() => void cerrar()}>Cerrar con {pesos(total)}</Button></>}>
      <div className="conteo">
        {(['billete', 'moneda'] as const).map((tipo) => (
          <div key={tipo}>
            <p className="section-label">{tipo === 'billete' ? 'Billetes' : 'Monedas'}</p>
            <div className="conteo-grid">
              {DENOMINACIONES.map((d, i) => d.tipo !== tipo ? null : (
                <label key={i} className="conteo-fila">
                  <span className="conteo-denom">{d.label}</span>
                  <span className="muted">×</span>
                  <input className="input" inputMode="numeric" aria-label={`${tipo === 'billete' ? 'Billetes' : 'Monedas'} de ${d.label}`} placeholder="0"
                    value={conteo[i] ?? ''} onChange={(e) => setConteo((c) => ({ ...c, [i]: e.target.value.replace(/\D/g, '').slice(0, 5) }))} />
                  <span className="num small muted">{pesos(BigInt(d.cents) * BigInt(Number(conteo[i] || 0) || 0))}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="conteo-total"><span>Efectivo contado</span><strong className="num">{pesos(total)}</strong></div>
    </Dialog>
  );
}

/** `esperado` en `null`: todavía no se sabe (no se inventa un «Debía haber $0.00»). */
function Cifras({ esperado, contado }: { esperado: bigint | null; contado: bigint }) {
  return (
    <dl className="caja-datos caja-datos--cifras">
      {esperado !== null && <div><dt>Debía haber</dt><dd className="num">{pesos(esperado)}</dd></div>}
      <div><dt>Contaste</dt><dd className="num">{pesos(contado)}</dd></div>
    </dl>
  );
}

/**
 * D-15 (bloque 3.5). `chico`: fondo y gasto, que se anotan con motivo y sin
 * autorización hasta el tope del gimnasio por turno (arriba la piden);
 * los demás SIEMPRE piden autorización.
 */
const TIPOS = [
  // El orden de siempre (el retiro primero): los recorridos de firmas abren el diálogo y piden autorización sin elegir tipo.
  { value: 'WITHDRAWAL', label: 'Retiro a caja fuerte', chico: false, permiso: 'cash:withdraw', ayuda: 'Sacar efectivo del cajón para guardarlo. Siempre pide autorización.' },
  { value: 'EXPENSE', label: 'Gasto de caja chica', chico: true, permiso: 'cash:petty:record', ayuda: 'Se pagó algo con dinero del cajón (garrafón, limpieza…).' },
  { value: 'DEPOSIT', label: 'Depósito al banco', chico: false, permiso: 'cash:withdraw', ayuda: 'El efectivo sale para depositarse. Siempre pide autorización.' },
  { value: 'FLOAT_IN', label: 'Entrada de fondo', chico: true, permiso: 'cash:petty:record', ayuda: 'Se agrega cambio al cajón a mitad del turno.' },
  // Bloque 4.3: el retiro del cajón y su anotación en Movimientos, en un solo paso. Va al final: el orden de arriba no cambia.
  { value: 'OWNER_DRAW', label: 'Retiro del dueño', chico: false, permiso: 'cash:withdraw', ayuda: 'El dueño se lleva efectivo del cajón: sale de esta caja y queda anotado en Movimientos como «Retiro del dueño» (no resta de la ganancia). Siempre pide autorización.' },
] as const;

/**
 * Movimiento de efectivo que NO es un cobro (D-15). El gasto chico y la
 * entrada de fondo se anotan con motivo y sin autorización hasta el tope del
 * gimnasio por turno; retirar y depositar siempre piden la autorización de
 * otra persona, que la teclea en este mismo equipo o la da desde su teléfono:
 * es la operación con la que más fácil se pierde dinero sin que se note.
 */
function MovimientoDialog({ turno, caja, onClose, onListo }: { turno: Turno; caja: Caja; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const tipos = TIPOS.filter((t) => can(t.permiso));
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]['value']>(tipos[0]?.value ?? 'EXPENSE');
  // Los topes del gimnasio, para decir hasta cuánto se anota sin autorización.
  const [topes, setTopes] = useState<CashLimits | null>(null);
  useEffect(() => { api<CashLimits>('/cash/limits').then(setTopes).catch(() => undefined); }, []);
  // Lo que a esta persona le queda en este turno: se dice ANTES de pedir la firma (defecto D1 de 3.13).
  const [queda, setQueda] = useState<CashShiftAllowance | null>(null);
  useEffect(() => { api<CashShiftAllowance>(`/cash-sessions/${turno.id}/allowance`).then(setQueda).catch(() => undefined); }, [turno.id]);
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [autorizando, setAutorizando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const cents = aCentavos(monto);
  const def = TIPOS.find((t) => t.value === tipo)!;
  // Retirar, depositar y el retiro del dueño gastan el tope del puesto por turno (recepción); `null` = sin tope.
  const quedaDeRetiro = !def.chico && queda?.withdrawal.remainingCents != null ? BigInt(queda.withdrawal.remainingCents) : null;
  const pasaDelTope = quedaDeRetiro !== null && cents !== null && cents > quedaDeRetiro;
  const quedaChico = def.chico && queda ? BigInt(tipo === 'FLOAT_IN' ? queda.petty.floatInRemainingCents : queda.petty.expenseRemainingCents) : null;
  // «Registrar» queda encendido: si falta el importe o el motivo, cada campo lo dice (26-02, 26-09; adopción 2.12).
  const fm = useFormulario({
    monto: !(cents !== null && cents > 0n) ? 'Escribe el importe, mayor que cero.'
      // No se pide una firma para algo que no va a pasar: se dice aquí, antes.
      : pasaDelTope && (quedaDeRetiro === 0n
        ? 'Tu puesto ya no puede retirar ni depositar más en este turno: lo hace la gerencia.'
        : `Pasa de lo que tu puesto puede retirar o depositar en este turno (te quedan ${pesos(quedaDeRetiro!)}): lo hace la gerencia.`),
    motivo: faltaMotivo(motivo) && ERROR_MOTIVO,
  });

  async function registrar(approvalToken?: string) {
    setEnviando(true);
    try {
      // Fondo y gasto chico tienen su ruta y su permiso (D-15); retirar y depositar, la de siempre.
      if (tipo === 'OWNER_DRAW') {
        // El retiro del cajón y su anotación en Movimientos, juntos (bloque 4.3).
        await api(`/cash-sessions/${turno.id}/owner-draw`, { method: 'POST', body: JSON.stringify({ amountCents: cents!.toString(), reason: motivo.trim(), ...(approvalToken ? { approvalToken } : {}) }) });
      } else await api(def.chico ? `/cash-sessions/${turno.id}/petty-movements` : `/cash-sessions/${turno.id}/movements`, {
        method: 'POST',
        body: JSON.stringify({ movementType: tipo, amountCents: cents!.toString(), reason: motivo.trim(), ...(approvalToken ? { approvalToken } : {}) }),
      });
      toast('ok', `${def.label}: ${pesos(cents!)}`);
      onListo();
    } catch (e) {
      // Pasó del tope chico del turno: la API pide la autorización (428) y se pide aquí mismo.
      if (e instanceof ApiError && e.status === 428 && !approvalToken) setAutorizando(true);
      else toast('error', errorText(e, 'No se pudo registrar'));
    } finally { setEnviando(false); }
  }

  if (autorizando) {
    return (
      <AutorizacionDialog permission="cash:withdraw" branchId={turno.branchId} operacion={{ resourceId: turno.id, amountCents: cents }} motivo={motivo} titulo={`Autorizar ${def.label.toLowerCase()}`}
        detalle={<div className="row-between"><span className="small">{def.label} · <span className="muted">{motivo}</span></span><strong className="num">{pesos(cents!)}</strong></div>}
        onClose={() => setAutorizando(false)}
        onAutorizado={(token) => { setAutorizando(false); void registrar(token); }} />
    );
  }

  return (
    <Dialog open onClose={onClose} title={`Movimiento de efectivo · ${caja.name}`} sub="Queda en el corte del turno, con tu nombre."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button loading={enviando} onClick={() => void fm.enviar(() => (def.chico ? registrar() : setAutorizando(true)))}>
          {def.chico ? 'Registrar' : 'Pedir autorización'}
        </Button></>}>
      <div className="stack">
        <Field label="Tipo" htmlFor="mv-tipo"
          hint={def.chico && topes ? `${def.ayuda} Hasta ${pesos(topes.pettyLimitCents)} por turno no pide autorización; arriba, sí.${quedaChico !== null ? ` En este turno quedan ${pesos(quedaChico)} sin autorización.` : ''}`
            : !def.chico && topes && (queda ? queda.withdrawal.role !== 'SIN_TOPE' : !can('cash:variance:approve'))
              ? `${def.ayuda} Tu puesto: hasta ${pesos(topes.withdrawalShiftLimitCents)} por turno.${quedaDeRetiro !== null ? ` Te quedan ${pesos(quedaDeRetiro)} en este turno.` : ''}` : def.ayuda}>
          <select id="mv-tipo" className="select" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            {tipos.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Importe" htmlFor="mv-monto" required error={fm.error('monto')}>
          <div className="input-money"><span>$</span><input id="mv-monto" className="input" inputMode="decimal" placeholder="0.00" value={monto} onChange={(e) => setMonto(e.target.value)} aria-invalid={!!fm.error('monto') || undefined} /></div>
        </Field>
        <CampoMotivo id="mv-motivo" value={motivo} onChange={setMotivo} error={fm.error('motivo')} placeholder="Retiro de media tarde a caja fuerte" hint="Queda en el corte y en la bitácora con tu nombre." />
      </div>
    </Dialog>
  );
}
