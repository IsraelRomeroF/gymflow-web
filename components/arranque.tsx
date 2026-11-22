'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CircleCheck, Circle, Rocket } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession, useToast, errorText } from '@/components/session';
import { Button, ButtonLink, Card, EsqueletoPagina } from '@/components/ui';
import { IconTile } from './compartido';
import type { Setup, SetupStep } from '@gymflow/core/contracts';

/** La lista de arranque (`GET /organization/setup`): el contrato del núcleo. */
export type Arranque = Setup;
type PasoConPermiso = SetupStep;

/** La lista de arranque de este gimnasio, o null mientras carga / si falló. */
export function useArranque(): { a: Arranque | null; fallo: boolean; recargar: () => void } {
  const [a, setA] = useState<Arranque | null>(null);
  const [fallo, setFallo] = useState(false);
  const recargar = useCallback(() => { setFallo(false); api<Arranque>('/organization/setup').then(setA).catch(() => setFallo(true)); }, []);
  useEffect(recargar, [recargar]);
  return { a, fallo, recargar };
}

/** Si la tarjeta se muestra: la ve quien puede resolver algo pendiente (DP-07), no solo quien tiene toda la organización. */
export function seVeArranque(a: Arranque | null, canOrg: (p: string) => boolean): a is Arranque {
  return !!a && !a.complete && (a.canAct || canOrg('settings:org'));
}

/**
 * ASISTENTE DE PRIMER ARRANQUE (ADR-038). Una marca recién liberada llega con
 * su sucursal, sus cuentas y sus módulos, pero sin textos, planes ni horario:
 * esta tarjeta le dice a la gerencia qué falta para abrir y la lleva ahí.
 * Desaparece sola cuando lo obligatorio está listo. Los datos llegan de
 * quien la pinta (el inicio), que también los usa para no repetir pendientes.
 */
export function ArranqueCard({ a }: { a: Arranque | null }) {
  const { canOrg } = useSession();
  if (!seVeArranque(a, canOrg)) return null;
  const faltan = a.steps.filter((p) => p.required && !p.done);
  return (
    <Card className="arranque" data-testid="arranque"
      title={<span className="row gap-8"><Rocket size={18} />Para empezar</span>}
      sub={`${a.requiredDone} de ${a.required} pasos obligatorios listos. Sin ellos el mostrador no puede inscribir ni cobrar.`}
      actions={<ButtonLink href="/arranque" variant="ghost" size="sm">Ver todo</ButtonLink>} pad={false}>
      <Progreso hechos={a.requiredDone} total={a.required} />
      <ul className="list">
        {faltan.slice(0, 3).map((p) => (
          <li key={p.key}>
            <Link href={p.href} className="list-item is-link no-underline" data-paso={p.key}>
              <IconTile tone="warn"><Circle /></IconTile>
              <div className="flex-1 min-w-0">
                <p className="strong">{p.title}</p>
                <p className="small muted">{p.text}</p>
              </div>
              <ArrowRight size={16} className="muted" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Progreso({ hechos, total }: { hechos: number; total: number }) {
  const pct = total === 0 ? 100 : Math.round((hechos / total) * 100);
  return (
    <div className="arranque-barra" role="progressbar" aria-valuenow={hechos} aria-valuemin={0} aria-valuemax={total} aria-label={`${hechos} de ${total} pasos listos`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** La lista completa, para la página /arranque. */
export function ArranqueLista({ a, onCambio }: { a: Arranque; onCambio?: () => void }) {
  const { canOrg } = useSession();
  const obligatorios = a.steps.filter((p) => p.required);
  const opcionales = a.steps.filter((p) => !p.required);
  return (
    <div className="stack">
      <Card title="Obligatorio para abrir" sub="Sin esto, recepción no puede inscribir ni cobrar." pad={false}>
        <Progreso hechos={a.requiredDone} total={a.required} />
        <ul className="list">{obligatorios.map((p) => <PasoItem key={p.key} p={p} onCambio={onCambio} />)}</ul>
      </Card>
      {opcionales.length > 0 && (
        <Card title="Según lo que contrataste" sub={`Cada módulo encendido trae algo que armar; lo que no uses, ${canOrg('settings:org') ? 'apágalo en Módulos' : 'pídele a la gerencia que lo apague'}.`} pad={false}>
          <ul className="list">{opcionales.map((p) => <PasoItem key={p.key} p={p} onCambio={onCambio} />)}</ul>
        </Card>
      )}
    </div>
  );
}

/** Gimnasio de una persona y media (DP-07): el gerente atiende el mostrador y no hay cuenta de recepción. */
function GerenteAtiende({ onCambio }: { onCambio?: () => void }) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  async function marcar(e: React.MouseEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('/organization/setup/front-desk', { method: 'PUT', body: JSON.stringify({ managerAttendsFrontDesk: true }) });
      toast('ok', 'Anotado: el gerente atiende el mostrador');
      onCambio?.();
    } catch (err) { toast('error', errorText(err, 'No se pudo guardar')); } finally { setEnviando(false); }
  }
  return <Button size="sm" variant="secondary" loading={enviando} onClick={(e) => void marcar(e)}>El gerente atiende el mostrador</Button>;
}

function PasoItem({ p, onCambio }: { p: PasoConPermiso; onCambio?: () => void }) {
  const { canOrg, me } = useSession();
  const accion = p.key === 'personal' && !p.done && canOrg('settings:org') ? <GerenteAtiende onCambio={onCambio} /> : null;
  // Entrar y cambiar su contraseña solo lo puede hacer el dueño: a los demás no se les manda a ningún lado.
  const delDueno = p.key === 'dueno' && !p.done && !me.roleKeys?.includes('OWNER');
  const texto = p.key === 'alta' && !p.done ? 'Cada sucursal puede tener un enlace corto para compartir por WhatsApp.' : p.text;
  const contenido = (
    <>
      <IconTile tone={p.done ? 'ok' : 'warn'}>{p.done ? <CircleCheck /> : <Circle />}</IconTile>
      <div className="flex-1 min-w-0">
        <p className={p.done ? 'paso-hecho' : 'strong'}>{p.title}</p>
        <p className="small muted">{texto}</p>
      </div>
      {accion}
      {delDueno ? <span className="tiny muted nowrap">Lo hace el dueño</span> : <ArrowRight size={16} className="muted" />}
    </>
  );
  return (
    <li>
      {delDueno
        ? <div className="list-item" data-paso={p.key} data-hecho={p.done}>{contenido}</div>
        : <Link href={p.href} className="list-item is-link no-underline" data-paso={p.key} data-hecho={p.done}>{contenido}</Link>}
    </li>
  );
}

export function ArranqueSkeleton() {
  return <EsqueletoPagina cifras={0} />;
}
