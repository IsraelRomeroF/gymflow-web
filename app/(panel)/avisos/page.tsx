'use client';

import { useState } from 'react';
import { BellRing, RotateCw } from 'lucide-react';
import { dia, fechaHora } from '@gymflow/ui/format';
import { useSession } from '@/components/session';
import { AvisoDeLaLista, PreferenciasDeAvisos, ResumenDeLaSemana, useAvisosDeLaDuena, useAvisosVistos } from '@/components/avisos-duena';
import { AvisosEnTelefono } from '@/components/push';
import { Button, Callout, Card, Empty, EsqueletoPagina, PageHeader, Segmented } from '@/components/ui';

/**
 * MIS AVISOS (fase 4, bloque 4.2; D-05). Lo que el sistema le avisa a la
 * dueña: las alertas (una caja que amaneció sin cortar, un corte con
 * diferencia por revisar…), el resumen de cada lunes con sus cifras, y qué
 * suena en su teléfono. Todo existe aquí aunque el teléfono no suene: los
 * avisos al teléfono necesitan las llaves del servidor y una dirección fija.
 * Solo consulta; lo único que se cambia es qué avisos suenan.
 */
export default function MisAvisosPage() {
  const { branchName } = useSession();
  const { avisos, error, recargar, poner } = useAvisosDeLaDuena();
  useAvisosVistos(avisos);
  const [semana, setSemana] = useState<string | null>(null);

  if (error && !avisos) {
    return (
      <>
        <PageHeader title="Mis avisos" />
        <Callout tone="danger" title="No se pudieron cargar tus avisos">
          <p>{error}</p>
          <div className="row gap-8 flex-wrap callout-accion"><Button size="sm" variant="secondary" icon={<RotateCw />} onClick={recargar}>Reintentar</Button></div>
        </Callout>
      </>
    );
  }
  if (!avisos) return <EsqueletoPagina cifras={4} />;
  if (!avisos.visible) {
    return <Empty icon={<BellRing />} title="Esta pantalla es para la Dueña o el Dueño" text="Aquí ve lo que el sistema le avisa y elige qué suena en su teléfono." />;
  }
  const resumen = avisos.summaries.find((s) => s.from === semana) ?? avisos.summaries[0];
  return (
    <>
      <PageHeader title="Mis avisos" sub="Lo que GymFlow te avisa sin que abras el panel, y el resumen de cada lunes. Todo queda aquí aunque tu teléfono no suene." actions={<AvisosEnTelefono />} />
      <div className="stack">
        <Card title="Avisos" sub={avisos.alerts.length === 0 ? undefined : 'Los de los últimos 30 días, el más reciente primero.'} data-testid="lista-de-avisos">
          {avisos.alerts.length === 0 ? (
            <Empty icon={<BellRing />} title="Sin avisos" text="Cuando una caja amanezca sin cortar, un corte cierre con diferencia o algo espere tu firma, sale aquí." />
          ) : (
            <ul className="stack lista-limpia">
              {avisos.alerts.map((a) => <AvisoDeLaLista key={a.id} aviso={a} sede={a.branchId ? branchName(a.branchId) : null} />)}
            </ul>
          )}
        </Card>

        <Card
          title={resumen ? `Tu semana: ${dia(resumen.from)} al ${dia(resumen.to)}` : 'El resumen del lunes'}
          sub={avisos.nextSummaryAt ? `El próximo llega el ${fechaHora(avisos.nextSummaryAt)}.` : undefined}
          data-testid="resumen-del-lunes"
        >
          {!resumen ? (
            <p className="small muted">Todavía no hay ninguno. Cada lunes a las 7:00 llega la semana anterior en cifras: entradas, altas y bajas, lo cobrado y lo que falta por cobrar, cortes con diferencia, firmas y lo que espera la tuya.</p>
          ) : (
            <div className="stack">
              {avisos.summaries.length > 1 && (
                <Segmented etiqueta="Semana" desplazable value={resumen.from} onChange={setSemana} options={avisos.summaries.map((s) => ({ value: s.from, label: `${dia(s.from, { day: 'numeric', month: 'short' })} al ${dia(s.to, { day: 'numeric', month: 'short' })}` }))} />
              )}
              <ResumenDeLaSemana resumen={resumen} />
            </div>
          )}
        </Card>

        <Card title="Qué avisos recibo en mi teléfono" sub="Cada uno se puede apagar. Los nombres y el detalle nunca viajan al teléfono: se leen aquí.">
          <PreferenciasDeAvisos avisos={avisos} onCambio={poner} />
        </Card>
      </div>
    </>
  );
}
