'use client';

import { useState } from 'react';
import { CircleCheck, Download, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { fecha, pesos } from '@/lib/format';
import { nombrePlanArchivo } from '@/lib/importar';
import { useSession, useToast, errorText } from '@/components/session';
import { descargarCsv } from '@/components/exportar';
import { Button, Callout, CampoMotivo, Dialog, VistaPrevia, faltaMotivo, type CifraPrevia } from '@/components/ui';
import { DECISION, type Detalle, type Fila } from './tipos';

const n = (x: number) => x.toLocaleString('es-MX');
const filasDe = (x: number) => `${n(x)} ${x === 1 ? 'fila' : 'filas'}`;

/**
 * PASO 4 · APLICAR (18-07, 18-08). Una barra pegada abajo dice qué falta y
 * trae las dos acciones grandes, cada una con su confirmación: aplicar no
 * tiene vuelta atrás y mueve dinero, así que antes repite el resumen de
 * dinero, pide EL motivo (el único de toda la importación) y que se haya
 * cotejado contra el reporte de cartera del sistema anterior.
 */
export function BarraAplicar({ d, onCambio }: { d: Detalle; onCambio: () => void }) {
  const [abierto, setAbierto] = useState<'aplicar' | 'descartar' | null>(null);
  const porRevisar = (d.byDecision.PENDING ?? 0) + d.dataPending;
  const total = d.pendingApply;
  const bloqueos = d.blockers ?? [];
  const etiqueta = porRevisar > 0 ? `${porRevisar === 1 ? 'Falta' : 'Faltan'} ${porRevisar} por revisar`
    : bloqueos.length > 0 ? 'Falta elegir el plan de las vigencias'
    : `Aplicar ${n(total)} filas…`;
  return (
    <>
      <div className="importar-barra" data-testid="aplicar">
        <div className="min-w-0">
          <p className="strong">4 · Aplicar</p>
          <p className="small muted">
            {bloqueos.length > 0 ? <>Antes de aplicar: {bloqueos.join('. ')}.</>
              : total === 0 ? 'No hay filas por aplicar: todas se omiten.'
              : d.applied > 0 ? `Se aplicó una parte (${filasDe(d.applied)}): continúa para terminar.`
              : 'Todo está decidido. Nada entra al padrón hasta que confirmes.'}
          </p>
        </div>
        <div className="row gap-8 flex-wrap">
          <Button variant="ghost" icon={<Trash2 />} disabled={d.applied > 0} onClick={() => setAbierto('descartar')}>Descartar importación</Button>
          <Button icon={<CircleCheck />} disabled={bloqueos.length > 0 || porRevisar > 0 || total === 0} onClick={() => setAbierto('aplicar')}>{etiqueta}</Button>
        </div>
      </div>
      {abierto === 'aplicar' && <ConfirmarAplicar d={d} onClose={() => setAbierto(null)} onListo={() => { setAbierto(null); onCambio(); }} onCambio={onCambio} />}
      {abierto === 'descartar' && <ConfirmarDescartar d={d} onClose={() => setAbierto(null)} onListo={() => { setAbierto(null); onCambio(); }} />}
    </>
  );
}

function ConfirmarAplicar({ d, onClose, onListo, onCambio }: { d: Detalle; onClose: () => void; onListo: () => void; onCambio: () => void }) {
  const toast = useToast();
  const { branchName } = useSession();
  const [motivo, setMotivo] = useState('');
  const [cotejado, setCotejado] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const total = d.pendingApply;
  const m = d.money;
  const hayDinero = BigInt(m.debtCents) > 0n || BigInt(m.creditCents) > 0n;
  const sinCargar = d.labels.plans.filter((p) => p.vigentes > 0 && d.planMap[p.label] === null);
  const sinReconocer = d.labels.branches.filter((b) => !d.branchMap[b.label]);

  const cifras: CifraPrevia[] = [
    { etiqueta: 'Fichas nuevas', valor: n(d.byDecision.CREATE ?? 0) },
    { etiqueta: 'Se unen a una ficha que ya existe', valor: n(d.byDecision.MERGE ?? 0), nota: 'Solo se completa lo que le falta' },
    { etiqueta: 'Adeudo que se carga', valor: pesos(m.debtCents), nota: m.debtRows > 0 ? `Saldo inicial de ${n(m.debtRows)} ${m.debtRows === 1 ? 'socio' : 'socios'}, con fecha ${fecha(d.cutoffDate)}` : 'Nadie entra debiendo', tono: BigInt(m.debtCents) > 0n ? 'warn' : undefined },
    { etiqueta: 'Saldo a favor que se carga', valor: pesos(m.creditCents), nota: m.creditRows > 0 ? `De ${n(m.creditRows)} ${m.creditRows === 1 ? 'socio' : 'socios'}` : 'Nadie entra con saldo a favor' },
    { etiqueta: 'Membresías vigentes que se crean', valor: n(m.memberships), nota: 'Con el plan de GymFlow que elegiste y su precio de hoy en la sucursal del socio' },
  ];
  const avisos: React.ReactNode[] = [
    ...(sinCargar.length > 0 ? [`Por tu decisión no se carga la vigencia de ${sinCargar.map((p) => `${nombrePlanArchivo(p.label)} (${p.vigentes})`).join(', ')}: esos socios entran sin membresía.`] : []),
    ...(m.expired > 0 ? [`${n(m.expired)} ${m.expired === 1 ? 'vigencia ya venció: ese socio entra' : 'vigencias ya vencieron: esos socios entran'} sin membresía.`] : []),
    ...(m.unreadBalances > 0 ? [`${n(m.unreadBalances)} ${m.unreadBalances === 1 ? 'saldo que no se entendió entra' : 'saldos que no se entendieron entran'} en cero, como decidiste en «Con datos dudosos».`] : []),
    ...(sinReconocer.length > 0 ? [`${sinReconocer.map((b) => `«${b.label}» (${b.rows})`).join(', ')} no coincide con ninguna sucursal: ${sinReconocer.reduce((a, b) => a + b.rows, 0) === 1 ? 'ese socio va' : 'esos socios van'} a ${branchName(d.branchId)}.`] : []),
    'Si un socio ya tenía su saldo inicial de una importación anterior, no se le vuelve a cargar.',
    'Las fichas importadas no traen firmados el aviso de privacidad ni el reglamento: recepción los recaba la próxima vez que vengan.',
  ];
  const errorMotivo = intentado && faltaMotivo(motivo) ? 'Escribe el motivo: es el que queda en la bitácora de esta importación.' : null;
  const faltaCotejo = hayDinero && !cotejado;

  async function aplicar() {
    setIntentado(true);
    setFallo(null);
    if (faltaMotivo(motivo) || faltaCotejo) return;
    setAvance({ hechas: 0, total });
    let hechas = 0;
    try {
      // Por lotes: si se corta la conexión, se reanuda donde quedó.
      for (;;) {
        const r = await api<{ applied: number; remaining: number; done: boolean }>(`/member-imports/${d.id}/apply`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
        hechas += r.applied;
        setAvance({ hechas, total: hechas + r.remaining });
        if (r.done) break;
      }
      toast('ok', 'La importación quedó aplicada.');
      onListo();
    } catch (e) {
      setFallo(errorText(e, 'Se detuvo la importación; vuelve a aplicar para continuar donde quedó'));
      setAvance(null);
      onCambio();
    }
  }

  return (
    <Dialog open size="lg" onClose={() => { if (!avance) onClose(); }} title={`Aplicar ${filasDe(total)}`} error={fallo}
      sub="Crea y completa las fichas, guarda sus códigos anteriores y carga saldos y vigencias. No tiene vuelta atrás."
      footer={<><Button variant="secondary" onClick={onClose} disabled={!!avance}>Volver</Button>
        <Button icon={<CircleCheck />} loading={!!avance} onClick={() => void aplicar()}>Aplicar {n(total)} filas</Button></>}>
      <div className="stack">
        <VistaPrevia titulo="Lo que entra al padrón" cifras={cifras} avisos={avisos} />
        <CampoMotivo id="ap-motivo" value={motivo} onChange={setMotivo} error={errorMotivo} disabled={!!avance}
          placeholder="Corte firmado por el dueño el 6 de octubre" hint="Es el único motivo de la importación: queda en la bitácora con tu nombre." />
        {hayDinero && (
          <div data-error={intentado && faltaCotejo ? 'true' : undefined}>
            <label className="check">
              <input type="checkbox" checked={cotejado} disabled={!!avance} onChange={(e) => setCotejado(e.target.checked)} />
              <span>Cotejé el adeudo y el saldo a favor contra el reporte de cartera del sistema anterior</span>
            </label>
            {intentado && faltaCotejo && <p className="field-error mt-4" role="alert">Coteja las cifras de dinero y márcalo: después de aplicar ya no se deshace.</p>}
          </div>
        )}
        {avance && (
          <div>
            <progress className="importar-progreso" value={avance.hechas} max={avance.total || 1} aria-label="Avance de la importación" />
            <p className="small muted mt-6">{n(avance.hechas)} de {n(avance.total)} filas…</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ConfirmarDescartar({ d, onClose, onListo }: { d: Detalle; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  async function descartar() {
    setEnviando(true);
    setFallo(null);
    try {
      await api(`/member-imports/${d.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim().length >= 3 ? motivo.trim() : 'Se descartó la importación' }) });
      onListo();
    } catch (e) { setFallo(errorText(e, 'No se pudo descartar')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open size="sm" onClose={() => { if (!enviando) onClose(); }} title="¿Descartar esta importación?" error={fallo}
      sub={`${d.fileName} · ${filasDe(d.totalRows)}. No entra nada al padrón y lo que decidiste aquí se pierde; el archivo se puede volver a subir.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Volver</Button>
        <Button variant="danger" icon={<Trash2 />} loading={enviando} onClick={() => void descartar()}>Descartar</Button></>}>
      <CampoMotivo id="ds-motivo" value={motivo} onChange={setMotivo} required={false} label="Motivo (opcional)"
        motivos={['Era el archivo equivocado', 'Voy a corregir el archivo', 'Era una prueba']} />
    </Dialog>
  );
}

/**
 * Lo que quedó (18-09): la lista completa, fila por fila, para trabajarla en
 * recepción: qué se hizo con cada una, en qué ficha quedó, qué saldo se cargó
 * y la nota de lo que no se pudo cargar.
 */
export function DescargarResultado({ d }: { d: Detalle }) {
  const toast = useToast();
  const [bajando, setBajando] = useState(false);
  async function descargar() {
    setBajando(true);
    try {
      const todas: Fila[] = [];
      let despues: number | null = null;
      do {
        const lote: { rows: Fila[]; next: number | null } = await api(`/member-imports/${d.id}/rows?limit=200${despues ? `&after=${despues}` : ''}`);
        todas.push(...lote.rows);
        despues = lote.next;
      } while (despues !== null);
      const dinero = (c: string | null) => (c === null ? '' : (Number(BigInt(c)) / 100).toFixed(2));
      descargarCsv(`resultado-${d.fileName.replace(/\.[a-z0-9]+$/i, '')}`, [
        ['Renglón', 'Nombre', 'Código anterior', 'Sucursal del archivo', 'Qué se hizo', 'Socio en GymFlow', 'Saldo del archivo', 'Saldo cargado', 'Vigente hasta', 'Plan del archivo', 'Nota'],
        ...todas.map((f) => [
          f.rowNumber, `${f.firstName} ${f.lastName}`.trim(), f.legacyCode, f.branchLabel,
          f.kind === 'INVALID' ? 'No se importó (sin nombre)' : f.appliedMemberId ? (f.decision === 'MERGE' ? 'Se unió a una ficha' : 'Se dio de alta') : DECISION[f.decision],
          f.appliedMember?.memberCode ?? '', dinero(f.balanceCents), dinero(f.balanceLoadedCents), f.periodEnd ?? '', f.planLabel,
          [f.applyNote, f.problems.join(' · ')].filter(Boolean).join(' · '),
        ]),
      ]);
    } catch (e) { toast('error', errorText(e, 'No se pudo armar el archivo del resultado')); } finally { setBajando(false); }
  }
  return <Button variant="secondary" size="sm" icon={<Download />} loading={bajando} onClick={() => void descargar()}>Descargar resultado (CSV)</Button>;
}

/** Lo que de verdad se cargó, para el segundo cotejo: después de aplicar. */
export function Aplicada({ d }: { d: Detalle }) {
  const m = d.money;
  return (
    <Callout tone="ok" title="Importación aplicada">
      <p>
        {n(d.applied)} filas entraron al padrón. Los socios ya se encuentran por nombre, celular o su código anterior. Las notas de cada fila dicen lo que no se pudo cargar.
        {d.balancesNotReloaded > 0 && <> {d.balancesNotReloaded === 1 ? 'Un saldo inicial no se volvió a cargar' : `${d.balancesNotReloaded} saldos iniciales no se volvieron a cargar`} porque el socio ya lo tenía: si cambió, corrígelo en su ficha.</>}
      </p>
      <p className="mt-4">
        Se cargaron <strong className="num">{pesos(m.loadedDebtCents)}</strong> de adeudo y <strong className="num">{pesos(m.loadedCreditCents)}</strong> a favor, en {n(d.balancesLoaded)} {d.balancesLoaded === 1 ? 'saldo inicial' : 'saldos iniciales'}.
        {d.reason && <> Motivo: «{d.reason}».</>}
      </p>
      <div className="callout-accion"><DescargarResultado d={d} /></div>
    </Callout>
  );
}
