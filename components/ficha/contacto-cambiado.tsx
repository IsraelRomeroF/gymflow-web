'use client';

import { useCallback, useState } from 'react';
import type { MemberContactChange, MemberContactChanges, MemberContactChangesReviewed } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fechaHora, telefono } from '@/lib/format';
import { useCarga } from '@/lib/carga';
import { useToast, errorText } from '@/components/session';
import { Button, Callout } from '@/components/ui';

/**
 * «CAMBIÓ SU CELULAR DESDE SU TELÉFONO» (auditoría 8, fase 4, bloque 4.8;
 * D-36 c). El socio cambia sus datos de contacto desde el portal, directo: el
 * cambio ya está hecho cuando el mostrador se entera. Este aviso de la ficha
 * es ese «se avisa a recepción»: dice qué cambió, con el antes y el después,
 * y se quita cuando alguien confirma con el socio que fue él.
 *
 * No aprueba ni deshace nada. Si no fue el socio, la gerencia regresa el dato
 * con «Editar datos» y le cierra el portal en sus teléfonos («Portal de…»).
 * Sin cambios por confirmar no pinta nada: la ficha no gana ruido.
 */

const QUE: Record<MemberContactChange['field'], string> = {
  PHONE: 'su celular', EMAIL: 'su correo', EMERGENCY_NAME: 'el nombre de su contacto de emergencia', EMERGENCY_PHONE: 'el teléfono de su contacto de emergencia',
};
const QUIEN_RESPONDE: Record<string, string> = {
  SELF: 'dijo que el número es suyo', MEMBER: 'dijo que responde su familiar, que ya es socio', ADULT: 'anotó a un adulto como responsable',
};
const valor = (c: MemberContactChange, v: string | null): string => (v === null || v.trim() === '' ? 'nada' : c.field === 'PHONE' || c.field === 'EMERGENCY_PHONE' ? telefono(v) : v);

export function ContactoCambiado({ memberId, nombre, onCambio }: { memberId: string; nombre: string; onCambio?: () => void }) {
  const toast = useToast();
  const carga = useCarga(useCallback(() => api<MemberContactChanges>(`/members/${memberId}/contact-changes`), [memberId]));
  const [confirmando, setConfirmando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const d = carga.datos;
  // Sin permiso en la sede del socio, o sin nada por confirmar: nada que decir.
  if (!d || d.pending === 0) return null;
  // Lo que se confirma con el socio es su celular y su correo; lo demás que cambió en el mismo toque se enseña junto.
  const porConfirmar = d.changes.filter((c) => c.reviewedAt === null);
  // Llegan del más reciente al más viejo: lo que importa es si el celular que tiene HOY quedó compartido.
  const ultimoCelular = porConfirmar.find((c) => c.field === 'PHONE');
  const comparte = ultimoCelular?.sharedPhone ? ultimoCelular : undefined;

  async function confirmar() {
    setConfirmando(true); setFallo(null);
    try {
      await api<MemberContactChangesReviewed>(`/members/${memberId}/contact-changes/review`, { method: 'POST', body: '{}' });
      toast('ok', 'Listo: quedó confirmado con el socio');
      await carga.recargar();
      onCambio?.();
    } catch (e) { setFallo(errorText(e, 'No se pudo confirmar')); } finally { setConfirmando(false); }
  }

  return (
    <div className="mt-12" data-testid="contacto-cambiado">
      <Callout tone={comparte ? 'warn' : 'info'} title={`${nombre} cambió sus datos de contacto desde su teléfono`}>
        <ul className="contacto-cambiado-lista small">
          {porConfirmar.map((c) => (
            <li key={c.id}>
              Cambió {QUE[c.field]} el {fechaHora(c.at)}
              {d.hidden ? '.' : <>: antes <strong>{valor(c, c.oldValue)}</strong>, ahora <strong>{valor(c, c.newValue)}</strong>.</>}
            </li>
          ))}
        </ul>
        {comparte && <p className="small">Ese celular también es el de otro socio: {QUIEN_RESPONDE[comparte.responsibleKind ?? ''] ?? 'falta anotar quién responde por el número'}. Revísalo abajo, en «Comparte celular».</p>}
        <p className="small">Cuando venga, confirma con {nombre} que el cambio es suyo. Si no lo es, la gerencia regresa el dato con «Editar datos» y le cierra el portal en sus teléfonos.</p>
        {fallo && <p className="small text-danger" role="alert">{fallo}</p>}
        <div className="row wrap gap-8 mt-8">
          <Button size="sm" loading={confirmando} onClick={() => void confirmar()}>Ya lo confirmé con {nombre}</Button>
        </div>
      </Callout>
    </div>
  );
}
