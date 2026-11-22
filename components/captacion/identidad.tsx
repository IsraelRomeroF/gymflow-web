'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { IdentityCheck, IdentityMatch } from '@gymflow/core/contracts';
import { ESTADO_DE_INTERESADO, TIPO_DE_PERSONA } from '@gymflow/core/vocabulario';
import { api } from '@/lib/api';
import { MEMBER_STATUS } from '@/lib/labels';
import { useSession } from '@/components/session';
import { Badge } from '@/components/ui';

/**
 * «¿YA EXISTE?» — el buscador de identidad único (auditoría 8, bloque 2.4).
 *
 * Una sola pregunta al servidor (`POST /members/check-duplicates`) para las
 * puertas por las que entra una persona: Nuevo prospecto, Nuevo socio y la
 * revisión de un alta digital. Responde con socios, exsocios, interesados en
 * seguimiento y altas por revisar, y cada resultado lleva a donde se atiende:
 * la ficha, la bandeja de interesados o la de altas. De otra sede solo avisa.
 */
export type Persona = IdentityMatch;

const TONO: Record<Persona['kind'], 'ok' | 'warn' | 'info' | 'neutral'> = { MEMBER: 'ok', FORMER_MEMBER: 'warn', PROSPECT: 'info', INTAKE: 'info' };

/** ¿Hay con qué buscar? Un celular completo, un correo, o nombre y apellido. */
function buscable(d: { firstName?: string; lastName?: string; phone?: string; email?: string }): boolean {
  const digitos = (d.phone ?? '').replace(/\D/g, '');
  return digitos.length >= 10 || /\S+@\S+\.\S+/.test(d.email ?? '') || ((d.firstName ?? '').trim().length >= 2 && (d.lastName ?? '').trim().length >= 3);
}

/**
 * Busca mientras se captura, sin estorbar: espera a que se deje de teclear y
 * calla si falla (el alta sigue teniendo su propia comprobación al guardar).
 */
export function useIdentidad(datos: { firstName?: string; lastName?: string; phone?: string; email?: string }, opts: { excludeIntakeId?: string; apagado?: boolean } = {}): { people: Persona[]; buscando: boolean } {
  const [people, setPeople] = useState<Persona[]>([]);
  const [buscando, setBuscando] = useState(false);
  const turno = useRef(0);
  const { firstName = '', lastName = '', phone = '', email = '' } = datos;
  const { excludeIntakeId, apagado } = opts;
  useEffect(() => {
    const yo = ++turno.current;
    if (apagado || !buscable({ firstName, lastName, phone, email })) { setPeople([]); setBuscando(false); return; }
    setBuscando(true);
    const t = setTimeout(() => {
      const digitos = phone.replace(/\D/g, '');
      api<IdentityCheck>('/members/check-duplicates', {
        method: 'POST',
        body: JSON.stringify({
          ...(firstName.trim().length >= 2 ? { firstName: firstName.trim() } : {}), ...(lastName.trim().length >= 2 ? { lastName: lastName.trim() } : {}),
          ...(digitos.length >= 10 ? { phoneE164: phone.trim() } : {}), ...(/\S+@\S+\.\S+/.test(email) ? { email: email.trim() } : {}),
          ...(excludeIntakeId ? { excludeIntakeId } : {}),
        }),
      }).then((r) => { if (turno.current === yo) setPeople(r.people); })
        .catch(() => { if (turno.current === yo) setPeople([]); })
        .finally(() => { if (turno.current === yo) setBuscando(false); });
    }, 350);
    return () => clearTimeout(t);
  }, [firstName, lastName, phone, email, excludeIntakeId, apagado]);
  return { people, buscando };
}

/** A dónde lleva cada resultado. */
function destino(p: Persona): { href: string; texto: string } | null {
  if (!p.id) return null;
  if (p.kind === 'MEMBER') return { href: `/socios/${p.id}`, texto: 'Ver su ficha' };
  if (p.kind === 'FORMER_MEMBER') return { href: `/socios/${p.id}`, texto: 'Abrir su ficha y reactivarla' };
  if (p.kind === 'PROSPECT') return { href: `/prospectos?q=${encodeURIComponent(p.fullName)}`, texto: 'Abrirlo en Prospectos' };
  return { href: `/altas?alta=${p.id}`, texto: 'Abrir su alta' };
}

/** Las personas encontradas, cada una con lo que es y a dónde ir. `filtro`: qué tipos pinta esta puerta. */
export function Coincidencias({ people, filtro, nuevaPestana, alAbrir }: {
  people: readonly Persona[]; filtro?: readonly Persona['kind'][]; nuevaPestana?: boolean;
  /** Al ir a la persona encontrada: quien lo pinta dentro de un diálogo lo cierra. */
  alAbrir?: () => void;
}) {
  const { branchName } = useSession();
  const lista = filtro ? people.filter((p) => filtro.includes(p.kind)) : people;
  if (lista.length === 0) return null;
  return (
    <ul className="list identidad" data-testid="ya-existe" aria-label="Personas que ya existen">
      {lista.map((p, i) => {
        const ir = destino(p);
        const estado = p.kind === 'PROSPECT' ? ESTADO_DE_INTERESADO[p.status ?? ''] : p.kind === 'INTAKE' ? null : MEMBER_STATUS[p.status ?? '']?.label;
        return (
          <li key={`${p.kind}-${p.id ?? i}`} className="list-item identidad-fila" data-kind={p.kind}>
            <div className="flex-1 min-w-0">
              <div className="row wrap gap-6">
                <Badge tone={p.sharedPhone ? 'warn' : TONO[p.kind]}>{p.sharedPhone ? 'Comparte celular' : TIPO_DE_PERSONA[p.kind]}</Badge>
                <span className="strong small">{p.fullName}</span>
                {p.memberCode && <code className="tiny">{p.memberCode}</code>}
              </div>
              <div className="tiny muted">
                {p.explanation}{estado ? ` · ${estado}` : ''}{p.branchId ? ` · ${branchName(p.branchId)}` : ''}
                {p.sharedPhone ? ' · es otra persona con el mismo celular' : ''}
              </div>
            </div>
            {ir
              ? <Link className="btn btn-secondary btn-sm" href={ir.href} {...(nuevaPestana ? { target: '_blank' } : {})} onClick={alAbrir}>{ir.texto}<ArrowRight /></Link>
              // De otra sede solo se avisa: lo atienden allá.
              : <span className="tiny muted">Lo atienden en {p.branchId ? branchName(p.branchId) : 'otra sucursal'}</span>}
          </li>
        );
      })}
    </ul>
  );
}
