'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { DoorOpen, CircleCheck, Ticket, TriangleAlert, RotateCw, Printer, Repeat } from 'lucide-react';
import type { AccessAttemptPreview, AccessAttemptResult } from '@gymflow/core/contracts';
import { textosDeMotivo } from '@gymflow/core/motivos';
import { api, ApiError } from '@/lib/api';
import { DENIAL_REASON } from '@/lib/labels';
import { useSession, errorText } from './session';
import { Badge, Button, Callout, CampoMotivo, Dialog, Field, faltaMotivo } from './ui';
import { useResumenAcceso, vigenciaEntrada } from './acceso';
import { useResolverRechazo, type Rechazo } from './cobro/resolver-rechazo';

/** Lo que responde `POST /access/attempts`: contrato del núcleo (5-21). */
type Intento = AccessAttemptResult;
/** Lo que pasaría (`POST /access/attempts/preview`), sin registrar nada. */
type Previa = AccessAttemptPreview;

const SIN_CONEXION = 'Sin conexión. No lo dejes pasar todavía: reintenta en cuanto vuelva el internet.';

/**
 * REGISTRAR ENTRADA desde el mostrador.
 *
 * Sin torniquete, esta es LA puerta: el socio llega, recepción lo busca y
 * pulsa «Entrada». Se evalúa con la misma política que usaría el torniquete
 * —membresía, sede, horario, paquete de visitas— y queda la asistencia; si
 * tiene paquete, se descuenta una visita sola. Si la política dice que no, la
 * salida está aquí mismo (`ResolverRechazo`): cobrar y abrir, renovar y
 * abrir, o dejar pasar con motivo. Es la vía alterna que ADR-032 exige junto
 * a la biometría.
 *
 * EL VEREDICTO VA PRIMERO (5-03, fase 1.4). Al abrir se pregunta qué pasaría
 * (`/access/attempts/preview`, que no registra nada):
 *   · no pasa → el rechazo se registra de una vez, sin pedir motivo, y se
 *     ofrecen las salidas;
 *   · pasa y la sede no usa biometría → se registra al instante (un clic);
 *   · pasa y la sede usa biometría → es una excepción: ahí, y solo ahí, se
 *     pide el motivo, de un toque.
 * Antes el motivo se pedía antes de saber si hacía falta: recepción escribía
 * por qué entraba por el mostrador alguien que de todos modos no entraba.
 *
 * FASE 3, BLOQUE 3.3:
 *   · Una entrada por día y sucursal (D-07): si ya entró hoy aquí, pasa otra
 *     vez pero es una REENTRADA; se dice que no cuenta otra visita ni descuenta.
 *   · Sin rostro no entra (D-06), donde el gimnasio encendió la regla: la
 *     puerta lo rechaza (`BIOMETRIC_REQUIRED`) y las salidas —registrar su
 *     rostro o la autorización de la gerencia para esa visita— las pone
 *     `entrada-sin-rostro.tsx` por la misma vía que cualquier rechazo.
 *   · Sin membresía: junto a «Vender y abrir» sale su pase de prueba (D-08).
 */
export function EntradaDialog({ memberId, memberName, onClose, onDone }: {
  memberId: string; memberName: string; onClose: () => void; onDone: () => void;
}) {
  const { branches, inScope } = useSession();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const [sede, setSede] = useState(sedes.length === 1 ? sedes[0]!.id : '');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [intento, setIntento] = useState<Intento | null>(null);
  const [error, setError] = useState<string | null>(null);

  // UNA clave por apertura del diálogo y un candado local (UXA-01): en
  // desarrollo React corre los efectos dos veces, y el segundo POST
  // registraba otra asistencia, descontaba otra visita o negaba el paso con
  // «Doble paso». Con la misma clave, el servidor devuelve la misma decisión.
  const clave = useRef(crypto.randomUUID());
  const enviado = useRef<string | null>(null);
  // Reintentar con la MISMA clave: el servidor devuelve la misma decisión si
  // el primer intento sí entró (MC-08). `reintento` solo vuelve a disparar el efecto.
  const [reintento, setReintento] = useState(0);
  // Donde la sucursal usa biometría, la entrada por el mostrador es una
  // EXCEPCIÓN (2026-10-09): lleva motivo y queda en la bitácora. Se pide solo
  // cuando la puerta diría que sí.
  const [motivoExcepcion, setMotivoExcepcion] = useState('');
  const [faltaElMotivo, setFaltaElMotivo] = useState(false);
  const [excepcionLista, setExcepcionLista] = useState(false);

  // 1. Qué pasaría. No registra nada: se puede pedir las veces que haga falta.
  useEffect(() => {
    if (!sede || intento) return;
    let vigente = true;
    setPrevia(null);
    api<Previa>('/access/attempts/preview', { method: 'POST', body: JSON.stringify({ branchId: sede, memberId }) })
      .then((p) => { if (vigente) setPrevia(p); })
      .catch((e) => { if (vigente) setError(e instanceof ApiError && e.status === 0 ? SIN_CONEXION : errorText(e, 'No se pudo revisar si puede pasar')); });
    return () => { vigente = false; };
    // Con la entrada ya registrada no se vuelve a preguntar (la guarda de arriba).
  }, [sede, memberId, reintento, intento]);

  const pasaria = previa?.outcome === 'GRANTED';
  const esperaMotivo = !!previa && pasaria && previa.policy.requiresReason && !excepcionLista;

  // 2. Se registra: el rechazo de una vez; el verde, cuando ya tiene su motivo si lo pide.
  useEffect(() => {
    if (!sede || !previa || esperaMotivo || intento || enviado.current === sede) return;
    enviado.current = sede;
    api<Intento>('/access/attempts', {
      method: 'POST',
      body: JSON.stringify({
        branchId: sede, memberId, credentialKind: 'MANUAL', requestKey: clave.current,
        ...(previa.policy.requiresReason && motivoExcepcion.trim() ? { reason: motivoExcepcion.trim() } : {}),
      }),
    }).then(setIntento).catch((e) => {
      // Entre la vista previa y el registro algo cambió (p. ej. le cobraron en otra caja y
      // ahora sí pasa: falta el motivo). Se vuelve a preguntar en lugar de dejar un error.
      setError(e instanceof ApiError && e.status === 0 ? SIN_CONEXION : errorText(e, 'No se pudo registrar la entrada'));
    });
  }, [sede, memberId, intento, previa, esperaMotivo, motivoExcepcion]);
  // Reintentar vuelve a preguntar primero: lo de antes ya no vale (y el registro no sale con una vista previa vieja).
  const reintentar = () => { setError(null); setPrevia(null); enviado.current = null; setExcepcionLista(false); setReintento((x) => x + 1); };

  const confirmarExcepcion = () => {
    if (faltaMotivo(motivoExcepcion)) { setFaltaElMotivo(true); return; }
    setExcepcionLista(true);
  };

  // Doble paso (dos registros en segundos): ya entró, no es una negativa (UX4-05).
  const yaEntro = intento?.outcome === 'DENIED' && intento.reason === 'DUPLICATE_SCAN';
  const rechazo: Rechazo | null = intento && intento.outcome === 'DENIED' && !yaEntro ? {
    decisionId: intento.decisionId, memberId, memberName, branchId: sede, reason: intento.reason, overridable: intento.overridable,
    outstandingCents: intento.outstandingCents, minimumCents: intento.minimumCents, periodsOwed: intento.periodsOwed,
    // El saldo a favor lo trajo la vista previa: «Cobrar y abrir» propone el neto (4-18).
    creditCents: previa?.creditCents ?? '0',
  } : null;
  const resolver = useResolverRechazo(rechazo, { onNoPasa: onClose });

  // Como el verde, el doble paso y el rechazo ya resuelto limpian el buscador
  // al cerrar (5-22): el socio que se queda en la lista es la materia prima
  // del error de registrar la entrada del anterior (5-01).
  const cerrar = () => { if (intento?.outcome === 'GRANTED' || resolver.resuelto || yaEntro || resolver.yaResuelto) onDone(); else onClose(); };
  // El verde se cierra solo (UX5-M-01, UX4-03): 200 entradas al día eran 200
  // clics en «Listo». El rojo se queda hasta que recepción decide.
  const verde = !!intento && (intento.outcome === 'GRANTED' || yaEntro);
  const AUTO_MS = 2500;
  useEffect(() => {
    if (!verde) return;
    const t = setTimeout(() => onDone(), AUTO_MS);
    return () => clearTimeout(t);
  }, [verde, onDone]);

  // Plan y vigencia para el verde: se pide cuando ya pasó, para leer lo que quedó (la visita ya descontada).
  const resumen = useResumenAcceso(intento?.outcome === 'GRANTED' ? [memberId] : []);
  const vigencia = vigenciaEntrada(resumen.get(memberId));

  let cuerpo: React.ReactNode;
  if (!sede) {
    cuerpo = (
      <Field label="¿En qué sucursal está entrando?" htmlFor="sede-entrada">
        <select id="sede-entrada" className="select" value={sede} onChange={(e) => setSede(e.target.value)}>
          <option value="">Elige la sucursal…</option>
          {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
    );
  } else if (error) {
    cuerpo = <Callout tone="danger">{error}</Callout>;
  } else if (!previa) {
    cuerpo = <div className="entrada-veredicto" data-estado="cargando"><span className="spinner" aria-hidden /><div><p className="entrada-titulo">Revisando si {memberName} puede entrar…</p></div></div>;
  } else if (esperaMotivo) {
    // El veredicto y el motivo en una sola vista: ya se sabe que entra; falta decir por qué por aquí.
    cuerpo = (
      <div className="stack" data-testid="entrada-excepcion">
        <Callout tone="ok" title={`${memberName} sí entra: falta el motivo`}>
          {previa.policy.hasBiometric
            ? 'Lo normal es que entre con su rostro o su huella. Di por qué hoy entra por el mostrador: queda en la bitácora con tu nombre.'
            : <>Aún no tiene su rostro o huella: dáselos de alta en su ficha (<Link href={`/socios/${memberId}?tab=biometria&registrar=rostro`} className="row-link">registrar su rostro</Link>). Mientras, di por qué entra por el mostrador: queda en la bitácora con tu nombre.</>}
          {previa.wouldConsumeVisit && <span className="block mt-6">Al registrarla se descuenta una visita de su paquete.</span>}
          {previa.reentry && <span className="block mt-6" data-testid="entrada-sera-reentrada">Ya entró hoy en esta sucursal: es una reentrada y no cuenta otra visita.</span>}
        </Callout>
        <div onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') confirmarExcepcion(); }}>
          <CampoMotivo id="mot-excepcion" label="Motivo de la excepción" hint={null} autoFocus value={motivoExcepcion}
            onChange={(m) => { setMotivoExcepcion(m); setFaltaElMotivo(false); }}
            motivos={textosDeMotivo('entradaManual').filter((m) => previa.policy.hasBiometric ? !/Aún no tiene/.test(m) : true)}
            error={faltaElMotivo ? 'Elige o escribe el motivo: queda en la bitácora con tu nombre.' : null} />
        </div>
      </div>
    );
  } else if (!intento) {
    cuerpo = (
      <div className="entrada-veredicto" data-estado="cargando" aria-live="polite">
        <span className="spinner" aria-hidden />
        <div><p className="entrada-titulo">Registrando la entrada de {memberName}…</p></div>
      </div>
    );
  } else if (yaEntro) {
    cuerpo = (
      <div className="entrada-veredicto" data-estado="neutro" aria-live="polite">
        <CircleCheck />
        <div>
          <p className="entrada-titulo">Ya registraste su entrada hace un momento</p>
          <p className="small muted">No se contó dos veces.</p>
        </div>
      </div>
    );
  } else if (intento.outcome === 'GRANTED') {
    cuerpo = (
      <div className="entrada-veredicto" data-ok="true" aria-live="polite">
        <CircleCheck />
        <div className="flex-1">
          <p className="entrada-titulo">{`${memberName} puede pasar`}</p>
          {vigencia && (
            <p className="row gap-8 flex-wrap" data-testid="vigencia-entrada">
              <span>{vigencia.texto}</span>
              {vigencia.vencePronto && <Badge tone="warn">Vence pronto</Badge>}
            </p>
          )}
          {intento.consumedVisit && <p className="small row gap-6"><Ticket size={14} />Se descontó una visita de su paquete.</p>}
          {intento.reentry && <p className="small row gap-6" data-testid="entrada-reentrada"><Repeat size={14} />Ya había entrado hoy: esta reentrada no cuenta otra visita ni descuenta.</p>}
          {intento.warning && <p className="small row gap-6"><TriangleAlert size={14} />{DENIAL_REASON[intento.warning] ?? intento.warning}</p>}
          <div className="entrada-cuenta" style={{ animationDuration: `${AUTO_MS}ms` }} aria-hidden />
        </div>
      </div>
    );
  } else {
    cuerpo = resolver.cuerpo;
  }

  let pie: React.ReactNode;
  if (!sede) pie = null;
  else if (error) pie = <><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button autoFocus icon={<RotateCw />} onClick={reintentar}>Reintentar</Button></>;
  else if (!previa) pie = null;
  else if (esperaMotivo) {
    pie = <><Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button icon={<DoorOpen />} onClick={confirmarExcepcion}>Registrar entrada por excepción</Button></>;
  } else if (!intento) pie = null;
  else if (rechazo && !resolver.resuelto && !resolver.yaResuelto) pie = resolver.pie;
  else {
    pie = <>
      {resolver.resuelto?.paymentId && <a className="btn btn-secondary" href={`/recibo/${resolver.resuelto.paymentId}`} target="_blank" rel="noreferrer"><Printer />Comprobante</a>}
      <Button autoFocus onClick={cerrar}>{verde ? 'Listo · Enter' : 'Listo'}</Button>
    </>;
  }

  return (
    <Dialog open onClose={cerrar} title={`Entrada · ${memberName}`} footer={pie}>
      {cuerpo}
    </Dialog>
  );
}
