'use client';

import { PageHeader, Breadcrumb } from '@/components/ui';
import { RutinaEditor } from '@/components/rutina-editor';

export default function NuevaRutinaPage() {
  return (
    <>
      <PageHeader eyebrow={<Breadcrumb items={[{ label: 'Rutinas', href: '/rutinas' }, { label: 'Nueva' }]} />} title="Nueva rutina" />
      <RutinaEditor inicial={null} />
    </>
  );
}
