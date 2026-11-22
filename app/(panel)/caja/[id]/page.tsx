'use client';

import { use, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { fecha, fechaHora, pesos } from '@/lib/format';
import { METODO, MOVIMIENTO, ORIGEN, TURNO, type Corte } from '@/lib/caja';
import { useSession, errorText } from '@/components/session';
import { Breadcrumb, Button, Callout, Card, PageHeader, NoExiste, esNoExiste, EsqueletoPagina } from '@/components/ui';
import { Diferencia } from '@/components/caja';

/**
 * El CORTE de un turno, listo para imprimir y firmar.
 *
 * Es el documento que se engrapa al sobre del efectivo: quién abrió, quién
 * cerró, qué entró por cada vía y si el cajón cuadró. Un turno todavía
 * abierto no se muestra aquí: su efectivo se revela al contar, no antes.
 */
export default function CortePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { branches, org } = useSession();
  const [corte, setCorte] = useState<Corte | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<Corte>(`/cash-sessions/${id}`).then(setCorte).catch((e) => setError(esNoExiste(e) ? 'NO_EXISTE' : errorText(e, 'No se pudo cargar el corte'))); }, [id]);

  if (error === 'NO_EXISTE') return <NoExiste titulo="Este corte no existe" texto="Los cortes de cada caja están en Caja." volverA="/caja" volverTexto="Ir a Caja" />;
  if (error) return <Callout tone="danger" title="No se pudo abrir el corte">{error}</Callout>;
  if (!corte) return <EsqueletoPagina cifras={3} />;

  const s = corte.session;
  if (s.status === 'OPEN') {
    return <Callout tone="info" title="Este turno sigue abierto">El corte se genera al cerrarlo desde la pantalla de Caja.</Callout>;
  }
  const sede = branches.find((b) => b.id === s.branchId)?.name ?? '';
  const fondo = BigInt(s.openingFloatCents);
  const efectivo = BigInt(corte.cashCollectedCents ?? '0');
  const movs = BigInt(corte.movementsCents);

  return (
    <div className="stack corte-doc">
      <div className="no-print">
        <PageHeader
          eyebrow={<Breadcrumb items={[{ label: 'Caja', href: '/caja' }, { label: 'Corte' }]} />}
          title="Corte de caja"
          actions={<Button icon={<Printer />} onClick={() => window.print()}>Imprimir</Button>}
        />
      </div>

      <Card>
        <div className="row-between items-start">
          <div>
            <p className="strong" style={{ fontSize: 18 }}>{org.tradeName}</p>
            <p className="small muted">{sede} · {corte.register.name} ({corte.register.code})</p>
          </div>
          <div className="text-right">
            <p className="strong">Corte del {fecha(s.businessDate)}</p>
            <p className="small muted">{s.shiftLabel ? `Turno ${TURNO[s.shiftLabel].toLowerCase()}` : 'Turno'}</p>
          </div>
        </div>

        <h2>Turno</h2>
        <table className="corte-tabla"><tbody>
          <tr><td>Abrió</td><td>{s.openedByName ?? '—'} · {fechaHora(s.openedAt)}</td></tr>
          <tr><td>Cerró</td><td>{s.closedByName ?? '—'} · {s.closedAt ? fechaHora(s.closedAt) : '—'}</td></tr>
        </tbody></table>

        <h2>Cobros del turno</h2>
        <table className="corte-tabla"><tbody>
          {corte.byMethod.length === 0 && <tr><td className="muted">Sin cobros</td><td>{pesos(0n)}</td></tr>}
          {corte.byMethod.map((m) => <tr key={m.method}><td>{METODO[m.method] ?? m.method}</td><td>{pesos(m.amountCents)}</td></tr>)}
          <tr className="total"><td>Total cobrado</td><td>{pesos(corte.totalCollectedCents ?? '0')}</td></tr>
        </tbody></table>
        {corte.contributions.length > 1 && (
          <p className="tiny muted mt-6">
            {corte.contributions.map((c) => `${ORIGEN[c.source] ?? c.source}: ${pesos(c.byMethod.reduce((t, m) => t + BigInt(m.amountCents), 0n))}`).join(' · ')}
          </p>
        )}

        <h2>Efectivo en el cajón</h2>
        <table className="corte-tabla"><tbody>
          <tr><td>Fondo inicial</td><td>{pesos(fondo)}</td></tr>
          <tr><td>Cobros en efectivo</td><td>{pesos(efectivo)}</td></tr>
          {corte.movements.map((m) => (
            <tr key={m.id}><td>{MOVIMIENTO[m.movementType] ?? m.movementType} <span className="muted small">· {m.reason}</span></td><td>{pesos(m.amountCents)}</td></tr>
          ))}
          <tr className="total"><td>Debía haber</td><td>{pesos(fondo + efectivo + movs)}</td></tr>
          {s.firstCountedCashCents && s.firstCountedCashCents !== s.countedCashCents && (
            // Corte ciego: si se contó más de una vez, el primer conteo se ve.
            <tr><td>Primer conteo <span className="muted small">· se contó {s.countAttempts ?? 2} veces</span></td><td>{pesos(s.firstCountedCashCents)}</td></tr>
          )}
          <tr><td>{s.firstCountedCashCents && s.firstCountedCashCents !== s.countedCashCents ? 'Conteo final' : 'Se contó'}</td><td>{s.countedCashCents ? pesos(s.countedCashCents) : '—'}</td></tr>
          <tr><td>Diferencia</td><td><Diferencia cents={s.varianceCents} /></td></tr>
        </tbody></table>
        {s.varianceReason && <p className="small mt-10"><span className="muted">Motivo de la diferencia:</span> {s.varianceReason}</p>}
        <p className="tiny muted mt-10">Los cobros con tarjeta y transferencia no pasan por el cajón: se concilian contra el banco.</p>

        <div className="corte-firmas">
          <div>Entrega · {s.closedByName ?? ''}</div>
          <div>Recibe</div>
        </div>
      </Card>
    </div>
  );
}
