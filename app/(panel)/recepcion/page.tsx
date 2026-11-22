import { redirect } from 'next/navigation';

/** Recepción y Socios se juntaron en una sola pantalla (2026-10-07): el enlace viejo sigue sirviendo. */
export default function RecepcionPage() {
  redirect('/socios');
}
