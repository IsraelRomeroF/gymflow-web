'use client';

import { useCallback } from 'react';
import { ScanFace, UserMinus } from 'lucide-react';
import type { MemberConservation, MemberStanding } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha } from '@gymflow/ui/format';
import { useCarga } from '@gymflow/ui/carga';

/**
 * «DE BAJA DESDE» en la ficha (fase 4, bloque 4.4 · D-18), y desde 4.18 lo que
 * la conservación hace con su rostro (P-01). Baja es quien
 * canceló su membresía o lleva el plazo del gimnasio (30 días) con la
 * membresía terminada sin renovar. Nadie lo guarda: la API lo calcula
 * (`GET /members/:id/standing`). De quien fue dado de baja en su ficha no dice
 * nada: eso ya lo dice su insignia. Si la consulta falla, no pinta nada: es
 * un dato de contexto, no una acción.
 */
export function BajaDelSocio({ memberId, version = 0 }: { memberId: string; version?: number }) {
  return <><BajaD18 memberId={memberId} version={version} /><ConservacionDelSocio memberId={memberId} version={version} /></>;
}

function BajaD18({ memberId, version }: { memberId: string; version: number }) {
  // `version` cambia cuando la ficha vuelve a pedir la cuenta (una venta, una cancelación): se pregunta de nuevo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const carga = useCarga(useCallback(() => api<MemberStanding>(`/members/${memberId}/standing`), [memberId, version]));
  const s = carga.datos;
  if (!s) return null;
  if (s.churn && s.churn.cause !== 'ARCHIVED') {
    return (
      <span data-testid="de-baja-desde"><UserMinus />
        De baja desde el {fecha(s.churn.since)}: {s.churn.cause === 'CANCELED' ? 'canceló su membresía' : `su membresía terminó${s.churn.endedOn ? ` el ${fecha(s.churn.endedOn)}` : ''} y no renovó`}
      </span>
    );
  }
  if (s.churnsOn) return <span data-testid="de-baja-desde"><UserMinus />Su membresía terminó: contará como baja el {fecha(s.churnsOn)} si no renueva</span>;
  return null;
}

/**
 * LO QUE LA CONSERVACIÓN HACE CON ESTE SOCIO (P-01; bloque 4.18). Su baja
 * para borrar el rostro y para la lista puede no ser la de arriba: quien
 * sigue viniendo sin membresía no cuenta (`GET /members/:id/conservation`).
 * Solo dice algo cuando hay algo que decir: un rostro que se va a borrar, o
 * por qué todavía no cuenta como baja. Si la consulta falla, no pinta nada.
 */
function ConservacionDelSocio({ memberId, version }: { memberId: string; version: number }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const carga = useCarga(useCallback(() => api<MemberConservation>(`/members/${memberId}/conservation`), [memberId, version]));
  const c = carga.datos;
  if (!c?.baja) return null;
  if (!c.baja.counts) {
    const porque = c.baja.exception === 'PAQUETE_VIVO' ? 'Tiene un paquete de visitas vigente' : `Sigue viniendo sin membresía${c.baja.lastEntryOn ? ` (vino el ${fecha(c.baja.lastEntryOn)})` : ''}`;
    return (
      <span data-testid="conservacion-socio"><ScanFace />
        {porque}: {c.face.stored ? 'su rostro y sus datos se conservan' : 'sus datos se conservan'}{c.baja.countsFrom ? `; si no vuelve, cuenta como baja desde el ${fecha(c.baja.countsFrom)}` : ''}
      </span>
    );
  }
  if (!c.face.stored) return null;
  return (
    <span data-testid="conservacion-socio"><ScanFace />
      {c.face.deletesOn ? `Su rostro se borra el ${fecha(c.face.deletesOn)} si no regresa` : 'Su rostro se borra 30 días después de su baja si no regresa (empieza a contar con el próximo cierre del día)'}
    </span>
  );
}
