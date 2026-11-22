'use client';

import { CircleCheck, Lock } from 'lucide-react';
import { useSession } from '@/components/session';
import { ArranqueLista, ArranqueSkeleton, useArranque } from '@/components/arranque';
import { ButtonLink, Callout, Empty, ErrorCarga, PageHeader } from '@/components/ui';

/**
 * PRIMER ARRANQUE (ADR-038): todo lo que una marca recién liberada deja listo
 * antes de abrir el mostrador, con un enlace a cada pantalla. No escribe
 * nada: cada paso se resuelve en su propia sección.
 */
export default function ArranquePage() {
  const { org } = useSession();
  const { a, fallo, recargar } = useArranque();
  return (
    <>
      <PageHeader title="Primer arranque" sub={`Lo que ${org.tradeName} necesita dejar listo para abrir. Cada paso te lleva a su pantalla; la lista se actualiza sola.`}
        actions={a?.complete ? <ButtonLink href="/panel" variant="secondary">Ir a Inicio</ButtonLink> : undefined} />
      {fallo && <ErrorCarga mensaje="No se pudo revisar el arranque." onReintentar={recargar} />}
      {!a && !fallo && <ArranqueSkeleton />}
      {a && !a.canAct && <Callout tone="info"><Lock size={14} /> Estos pasos los resuelve la gerencia; tu rol solo los consulta.</Callout>}
      {a?.complete && (
        <div className="mb-16">
          <Empty icon={<CircleCheck />} title="Listo para abrir" text="Lo obligatorio está hecho. Lo demás se puede ir armando con el gimnasio ya operando." />
        </div>
      )}
      {a && <ArranqueLista a={a} onCambio={recargar} />}
    </>
  );
}
