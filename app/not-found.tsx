import Link from 'next/link';

/** Una dirección que no existe: en español y con salida, no el 404 de fábrica. */
export default function NoExiste() {
  return (
    <div className="auth-form" style={{ minHeight: '100dvh' }}>
      <div className="card card-pad" style={{ maxWidth: 420, textAlign: 'center' }}>
        <p className="strong" style={{ fontSize: 18 }}>Esta página no existe</p>
        <p className="muted small mt-6">Puede que el enlace esté mal escrito o sea de una versión anterior.</p>
        <Link className="btn btn-primary mt-16" href="/panel">Ir a Inicio</Link>
      </div>
    </div>
  );
}
