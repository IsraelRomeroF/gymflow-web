'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EyeOff, Send } from 'lucide-react';
import type { GymChangeRequestList, GymProfile } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha, telefono } from '@gymflow/ui/format';
import { ZONAS } from '@/lib/zonas';
import { useSession, useToast } from '@/components/session';
import { Badge, Button, ButtonLink, Callout, Card, Empty, EsqueletoLista, PageHeader } from '@/components/ui';
import { EstadoCarga, useCarga } from '@gymflow/ui/carga';
import { PestanasGimnasio, useEntraA } from './pestanas';
import { PedirCambio, Solicitudes } from './solicitudes';

const nombreZona = (tz: string) => ZONAS.find(([z]) => z === tz)?.[1] ?? tz;
const MONEDA: Readonly<Record<string, string>> = { MXN: 'Pesos mexicanos (MXN)', USD: 'Dólares (USD)' };

/**
 * MI GIMNASIO · DATOS (D-27, opción d). Los datos y la marca del gimnasio no
 * se cambian desde el panel: los administra GymFlow. Aquí se VEN —nombres,
 * RFC, logo, teléfonos, leyenda del recibo, el teléfono y el horario de cada
 * sucursal, lo contratado y las reglas— y se PIDE el cambio con una solicitud
 * (bloque 4.6): GymFlow la aplica o contesta por qué no, y la respuesta se lee
 * aquí mismo. Va con la misma llave que Sucursales.
 */
export default function GimnasioPage() {
  const { org } = useSession();
  const entra = useEntraA('/sucursales');
  const veModulos = useEntraA('/modulos');
  const toast = useToast();
  const cargar = useCallback(async () => {
    const [perfil, solicitudes] = await Promise.all([api<GymProfile>('/organization/profile'), api<GymChangeRequestList>('/gym-change-requests')]);
    return { perfil, solicitudes };
  }, []);
  const carga = useCarga(entra ? cargar : null);
  const [pedir, setPedir] = useState(false);
  // Quien pidió ya tiene la respuesta a la vista: se apaga su aviso de arriba (una vez por carga).
  const avisado = useRef(false);
  const sinVer = carga.datos?.solicitudes.unseen ?? 0;
  useEffect(() => {
    if (avisado.current || sinVer === 0) return;
    avisado.current = true;
    api('/gym-change-requests/seen', { method: 'POST' }).catch(() => { avisado.current = false; });
  }, [sinVer]);

  if (!entra) {
    return <Empty icon={<EyeOff />} title="Tu rol no ve esta pantalla" text="Los datos del gimnasio los consultan la dueña y la gerencia que lleva las sucursales."
      action={<ButtonLink href="/panel" variant="secondary">Ir a Inicio</ButtonLink>} />;
  }

  return (
    <div className="stack gap-20">
      <PestanasGimnasio actual="datos" />
      <PageHeader title="Datos del gimnasio" sub={`Lo que GymFlow tiene registrado de ${org.tradeName}. Es de consulta.`}
        actions={carga.datos?.perfil.canRequestChange ? <Button icon={<Send />} onClick={() => setPedir(true)}>Pedir un cambio a GymFlow</Button> : undefined} />
      <Callout tone="info" title="Estos datos los cambia GymFlow, no el panel">
        Nombre, razón social, RFC, logo, teléfonos, horarios y la leyenda del recibo los lleva GymFlow. Para corregir uno, usa «Pedir un cambio a GymFlow»: di qué dato, cómo debe quedar y por qué. No tiene costo; cuando lo apliquen lo ves aquí, y si no procede te dicen por qué.
      </Callout>
      <EstadoCarga carga={carga} titulo="No se pudieron cargar los datos del gimnasio" esqueleto={<div className="card"><EsqueletoLista filas={4} /></div>}>
        {({ perfil: p, solicitudes }) => (
          <>
          <div className="grid grid-2" data-testid="datos-del-gimnasio">
            <Card title="Tu gimnasio" sub="Como aparece en el panel, en el recibo y en el teléfono del socio.">
              <dl className="kv">
                <dt>Nombre comercial</dt><dd className="strong">{p.tradeName}</dd>
                <dt>Razón social</dt><dd>{p.legalName}</dd>
                <dt>RFC</dt><dd>{p.brand.rfc ?? <SinDato />}</dd>
                <dt>Logo</dt>
                {/* El logo viene como data: desde la API, no es una imagen del sitio */}
                <dd>{p.brand.logo ? <img src={p.brand.logo} alt={`Logo de ${p.tradeName}`} className="logo-marca" /> : <SinDato />}</dd>
                <dt>Teléfono</dt><dd>{p.brand.phone ? telefono(p.brand.phone) : <SinDato />}</dd>
                <dt>WhatsApp</dt><dd>{p.brand.whatsapp ? telefono(p.brand.whatsapp) : <SinDato />}</dd>
                <dt>Leyenda del recibo</dt><dd>{p.brand.receiptLegend ?? <SinDato />}<div className="tiny muted">Se imprime al pie de cada recibo.</div></dd>
                <dt>Zona horaria</dt><dd>{nombreZona(p.timezone)}<div className="tiny muted">Manda en «hoy», en los cortes y en los vencimientos. Una sucursal puede tener la suya.</div></dd>
                <dt>Moneda</dt><dd>{MONEDA[p.defaultCurrency] ?? p.defaultCurrency}</dd>
                <dt>Sucursales</dt><dd>{p.branches.open} {p.branches.open === 1 ? 'abierta' : 'abiertas'}{p.branches.closed > 0 ? ` · ${p.branches.closed} ${p.branches.closed === 1 ? 'cerrada' : 'cerradas'}` : ''}</dd>
                {p.activatedAt && <><dt>En GymFlow desde</dt><dd>{fecha(p.activatedAt)}</dd></>}
              </dl>
              <p className="small muted mt-12">La aplicación de tus socios se llama «GymFlow»: lleva tu nombre comercial por dentro, no una marca propia.</p>
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

            <Card title="Teléfono y horario de cada sucursal" sub="También los lleva GymFlow. El nombre, la dirección y la zona de una sucursal los cambia la gerencia en Sucursales." pad={false}>
              <ul className="list" data-testid="contacto-de-sucursales">
                {p.brand.branches.map((b) => (
                  <li key={b.id} className="list-item">
                    <div className="flex-1 min-w-0">
                      <p className="strong small">{b.name}{b.isActive ? '' : ' · cerrada'}</p>
                      <p className="small">{b.phone ? telefono(b.phone) : <span className="muted">Sin teléfono registrado</span>} · {b.openingHours ?? <span className="muted">Sin horario registrado</span>}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Solicitudes solicitudes={solicitudes.requests} onPedir={p.canRequestChange ? () => setPedir(true) : undefined} />
          {pedir && (
            <PedirCambio perfil={p} onClose={() => setPedir(false)}
              onEnviada={() => { setPedir(false); toast('ok', 'Solicitud enviada a GymFlow. El dato cambia cuando la apliquen.'); void carga.recargar(); }} />
          )}
          </>
        )}
      </EstadoCarga>
    </div>
  );
}

const SinDato = () => <span className="muted">Sin registrar</span>;

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
