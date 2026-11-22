'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, FileUp } from 'lucide-react';
import { useSession } from '@/components/session';
import { Button, ButtonLink, PageHeader } from '@/components/ui';
import { NuevoSocioDialog } from '@/components/socio-form';
import { Mostrador } from '@/components/mostrador/mostrador';
import { Padron } from '@/components/mostrador/padron';

/**
 * SOCIOS: el mostrador y el padrón en una sola pantalla (decisión del
 * 2026-10-07: Recepción y Socios buscaban a la misma gente con la misma caja).
 *
 * Arriba, la búsqueda que más horas pasa abierta (`Mostrador`): el foco
 * arranca ahí, el resultado elegido muestra su tarjeta con Entrada, Cobrar,
 * Vender y Clase (bloque 2.1, 2-08), Enter abre la ficha y Ctrl+Enter registra
 * la entrada. Con el buscador vacío, abajo está el padrón completo con sus
 * filtros (`Padron`), para mirar el conjunto.
 *
 * Esta página solo orquesta: el alta nueva y cuál de las dos mitades se ve.
 */
export default function SociosPage() {
  const router = useRouter();
  const { can, me } = useSession();
  // El coach ve solo a sus socios asignados (2026-10-09).
  const soloCoach = !!me.roleKeys?.length && me.roleKeys.every((k) => k === 'COACH');
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  // `/socios?q=…` llega desde otros buscadores. Se lee al montar: con useSearchParams la página dejaría de prerenderse.
  const [q0, setQ0] = useState('');
  useEffect(() => { setQ0(new URLSearchParams(window.location.search).get('q') ?? ''); }, []);

  return (
    <>
      <PageHeader title={soloCoach ? 'Mis socios' : 'Socios'} sub="Busca por nombre, código o teléfono (tolera errores de captura). Con el buscador vacío, abajo está el padrón completo."
        actions={(can('members:create') || can('members:import')) ? <>
          {can('members:import') && <ButtonLink href="/importar" variant="ghost" icon={<FileUp />}>Importar</ButtonLink>}
          {can('members:create') && <Button icon={<UserPlus />} onClick={() => setNuevo('')}>Nuevo socio</Button>}
        </> : undefined} />

      <Mostrador etiqueta="Buscar en el padrón" autoFoco pegajoso consultaInicial={q0} onBuscando={setBuscando}
        onRegistrar={can('members:create') ? (nombre) => setNuevo(nombre) : undefined} />

      {!buscando && <Padron soloCoach={soloCoach} onNuevo={() => setNuevo('')} />}

      {nuevo !== null && (
        <NuevoSocioDialog nombreInicial={nuevo} onClose={() => setNuevo(null)} onCreado={(id) => router.push(`/socios/${id}?vender=1`)} />
      )}
    </>
  );
}
