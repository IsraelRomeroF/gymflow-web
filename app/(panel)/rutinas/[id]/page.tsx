'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { UserPlus, Archive } from 'lucide-react';
import { api } from '@/lib/api';
import type { Rutina } from '@/lib/rutinas';
import { useSession, useToast, errorText } from '@/components/session';
import { Breadcrumb, Button, Callout, Dialog, PageHeader, Skeleton } from '@/components/ui';
import { RutinaEditor } from '@/components/rutina-editor';
import { AsignarRutinaDialog } from '@/components/rutina-asignar';

export default function RutinaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { can } = useSession();
  const [r, setR] = useState<Rutina | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asignar, setAsignar] = useState(false);
  const [archivando, setArchivando] = useState(false);

  useEffect(() => { api<Rutina>(`/routines/${id}`).then(setR).catch((e) => setError(errorText(e, 'No se encontró la rutina'))); }, [id]);

  async function archivar() {
    try {
      await api(`/routines/${id}/archive`, { method: 'POST', body: '{}' });
      toast('ok', 'Rutina archivada. Quien la tenía asignada la conserva hasta que le asignes otra.');
      router.push('/rutinas');
    } catch (e) { toast('error', errorText(e, 'No se pudo archivar')); }
  }

  if (error) return <Callout tone="danger">{error}</Callout>;
  if (!r) return <div className="stack"><Skeleton h={28} w={300} /><Skeleton h={180} r={16} /><Skeleton h={260} r={16} /></div>;

  return (
    <>
      <PageHeader eyebrow={<Breadcrumb items={[{ label: 'Rutinas', href: '/rutinas' }, { label: r.name }]} />} title={r.name}
        actions={<>
          {/* La copia personal de un socio no se le da a otro. */}
          {can('training:assign') && !r.personalFor && <Button icon={<UserPlus />} onClick={() => setAsignar(true)}>Asignar a un socio</Button>}
          <Button variant="ghost" icon={<Archive />} onClick={() => setArchivando(true)}>Archivar</Button>
        </>} />
      {/* Editar una rutina compartida le cambia la suya a todos al instante: se dice antes (12-05). */}
      {r.personalFor ? (
        <div className="mb-16"><Callout tone="info">
          Copia personal de {r.personalFor.name
            ? <Link href={`/socios/${r.personalFor.memberId}?tab=rutina`}>{r.personalFor.name}</Link>
            : 'un socio'}: lo que cambies aquí solo le llega a esa persona. No aparece en el catálogo.
        </Callout></div>
      ) : r.activeMembers > 1 && (
        <div className="mb-16"><Callout tone="warn" title={`La tienen ${r.activeMembers} socios`}>
          Lo que cambies les llega a todos al instante. Para ajustarla solo a una persona, abre su ficha → Rutina → «Personalizar».
        </Callout></div>
      )}
      <RutinaEditor key={r.updatedAt} inicial={r} />
      {asignar && <AsignarRutinaDialog rutina={r} onClose={() => setAsignar(false)} onListo={() => setR({ ...r, activeMembers: r.activeMembers + 1 })} />}
      {/* Archivar pide confirmación (UX7 Clases 6): antes era un clic y la rutina se iba. */}
      {archivando && (
        <Dialog open onClose={() => setArchivando(false)} title={`¿Archivar «${r.name}»?`}
          footer={<><Button variant="secondary" onClick={() => setArchivando(false)}>Cancelar</Button><Button variant="danger" icon={<Archive />} onClick={() => void archivar()}>Archivar rutina</Button></>}>
          <p>Deja de aparecer para asignar. Quien ya la tiene la conserva hasta que le asignes otra.</p>
        </Dialog>
      )}
    </>
  );
}
