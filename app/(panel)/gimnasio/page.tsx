'use client';

import { useCallback } from 'react';
import { EyeOff } from 'lucide-react';
import type { GymProfile } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha } from '@/lib/format';
import { ZONAS } from '@/lib/zonas';
import { useSession } from '@/components/session';
import { Badge, ButtonLink, Callout, Card, Empty, EsqueletoLista, PageHeader } from '@/components/ui';
import { EstadoCarga, useCarga } from '@/lib/carga';
import { PestanasGimnasio, useEntraA } from './pestanas';

const nombreZona = (tz: string) => ZONAS.find(([z]) => z === tz)?.[1] ?? tz;
const MONEDA: Readonly<Record<string, string>> = { MXN: 'Pesos mexicanos (MXN)', USD: 'Dólares (USD)' };

/**
 * MI GIMNASIO · DATOS (D-27). Los datos y la marca del gimnasio no se cambian
 * desde el panel: los administra GymFlow. Aquí se VEN —nombres, zona, moneda,
 * a dónde llega el cobro, lo contratado y las reglas del gimnasio— y se dice
 * cómo pedir un cambio. Va con la misma llave que Sucursales.
 */
export default function GimnasioPage() {
  const { org } = useSession();
  const entra = useEntraA('/sucursales');
  const veModulos = useEntraA('/modulos');
  const cargar = useCallback(() => api<GymProfile>('/organization/profile'), []);
  const carga = useCarga(entra ? cargar : null);

  if (!entra) {
    return <Empty icon={<EyeOff />} title="Tu rol no ve esta pantalla" text="Los datos del gimnasio los consultan la dueña y la gerencia que lleva las sucursales."
      action={<ButtonLink href="/panel" variant="secondary">Ir a Inicio</ButtonLink>} />;
  }

  return (
    <div className="stack gap-20">
      <PestanasGimnasio actual="datos" />
      <PageHeader title="Datos del gimnasio" sub={`Lo que GymFlow tiene registrado de ${org.tradeName}. Es de consulta.`} />
      <Callout tone="info" title="Estos datos los cambia GymFlow, no el panel">
        Para corregir el nombre, la razón social, la zona horaria o el correo de cobro, o para contratar un módulo, pídeselo a GymFlow por el medio con el que te atiende y di qué dato cambia. En cuanto lo cambien, lo ves aquí.
      </Callout>
      <EstadoCarga carga={carga} titulo="No se pudieron cargar los datos del gimnasio" esqueleto={<div className="card"><EsqueletoLista filas={4} /></div>}>
        {(p) => (
          <div className="grid grid-2" data-testid="datos-del-gimnasio">
            <Card title="Tu gimnasio" sub="Como aparece en el panel, en el recibo y en el teléfono del socio.">
              <dl className="kv">
                <dt>Nombre comercial</dt><dd className="strong">{p.tradeName}</dd>
                <dt>Razón social</dt><dd>{p.legalName}</dd>
                <dt>Zona horaria</dt><dd>{nombreZona(p.timezone)}<div className="tiny muted">Manda en «hoy», en los cortes y en los vencimientos. Una sucursal puede tener la suya.</div></dd>
                <dt>Moneda</dt><dd>{MONEDA[p.defaultCurrency] ?? p.defaultCurrency}</dd>
                <dt>Sucursales</dt><dd>{p.branches.open} {p.branches.open === 1 ? 'abierta' : 'abiertas'}{p.branches.closed > 0 ? ` · ${p.branches.closed} ${p.branches.closed === 1 ? 'cerrada' : 'cerradas'}` : ''}</dd>
                {p.activatedAt && <><dt>En GymFlow desde</dt><dd>{fecha(p.activatedAt)}</dd></>}
              </dl>
              <p className="small muted mt-12">El RFC, el logo, los teléfonos, el horario y la leyenda del recibo también los llevará GymFlow: todavía no se guardan aquí.</p>
            </Card>

            <Card title="Lo que tienes contratado" sub={p.plan.name ? `Plan ${p.plan.name}` : 'Contrato a la medida, módulo por módulo'}
              actions={veModulos ? <ButtonLink href="/modulos" size="sm" variant="secondary">Ver Módulos</ButtonLink> : undefined}>
              <div className="stack-sm">
                {p.plan.description && <p className="small">{p.plan.description}</p>}
                <Lista titulo={p.plan.name ? 'Incluye' : 'Módulos contratados'} nombres={p.plan.included} vacio="Solo lo básico: socios, membresías, cobros, reportes y personal." tono="ok" />
                {p.plan.addOns.length > 0 && <Lista titulo="Agregados aparte" nombres={p.plan.addOns} tono="ok" />}
                {p.plan.notContracted.length > 0 && <Lista titulo="Sin contratar" nombres={p.plan.notContracted} />}
                <dl className="kv mt-8">
                  <dt>Correo de cobro</dt><dd>{p.billingEmail ?? <span className="muted">Sin registrar</span>}<div className="tiny muted">Ahí llega el estado de cuenta de GymFlow.</div></dd>
                </dl>
              </div>
            </Card>

            <Card title="Reglas del gimnasio" sub="Valen para todas las sucursales.">
              <dl className="kv">
                <dt>Socio con adeudo</dt>
                <dd>{p.rules.allowAccessWhilePastDue ? 'Entra aunque deba, mientras su membresía siga vigente' : 'No entra hasta ponerse al corriente'}</dd>
                <dt>Mostrador</dt>
                <dd>{p.rules.managerAttendsFrontDesk ? 'Lo atiende la gerencia: no hace falta una cuenta de recepción' : 'Lo atiende recepción con su propia cuenta'}</dd>
                <dt>Datos de quien se da de baja</dt>
                <dd>{p.rules.monthsAfterArchive ? `A los ${p.rules.monthsAfterArchive} meses de la baja entran a la lista mensual para anonimizarlos; nada se borra sin la firma de la dueña` : 'Sin plazo fijado para anonimizarlos'}</dd>
              </dl>
            </Card>
          </div>
        )}
      </EstadoCarga>
    </div>
  );
}

function Lista({ titulo, nombres, vacio, tono }: { titulo: string; nombres: readonly string[]; vacio?: string; tono?: 'ok' }) {
  return (
    <div>
      <p className="label mb-8">{titulo}</p>
      {nombres.length === 0 ? <p className="small muted">{vacio}</p> : (
        <div className="row gap-6 flex-wrap">{nombres.map((n) => <Badge key={n} tone={tono ?? 'neutral'}>{n}</Badge>)}</div>
      )}
    </div>
  );
}
