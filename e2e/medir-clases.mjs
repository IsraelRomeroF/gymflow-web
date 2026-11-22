// MEDICIÓN: cuántas clases se llenan (auditoría 8, fase 1.17a; decisión DA-14 /
// D11-03, «Lista de espera en clases»: no por ahora; se mide cuántas clases se
// llenan y, si se llena más de una al día, se le pregunta a Israel).
//
//   node e2e/medir-clases.mjs                          gymflow_pruebas, últimos 28 días
//   node e2e/medir-clases.mjs --dias 56                otra ventana
//   node e2e/medir-clases.mjs --base gymflow_local     el uso real (SOLO LECTURA)
//   node e2e/medir-clases.mjs --json                   para guardarlo o compararlo
//   node e2e/medir-clases.mjs --futuras 7              suma las de los próximos 7 días con lo
//                                                      reservado hasta ahora (para probar la medición)
//
// Solo lee: la consulta corre en una transacción READ ONLY (lib/base.mjs ·
// leer), así que la base rechazaría cualquier escritura. No lee nombres de
// socios: cuenta sesiones y reservas.
//
// Qué cuenta, por gimnasio y por día, de las clases que ya pasaron (no canceladas):
//   - LLENA: en algún momento tuvo tantas reservas vivas como cupo. Se
//     reconstruye con las reservas y cancelaciones en orden (bookedAt,
//     canceledAt), no con `bookedCount`, que solo dice cómo quedó.
//   - SE LIBERÓ: se llenó y alguien canceló después, y llegó a la hora con un
//     lugar vacío. Es justo el caso de la lista de espera: «si alguien
//     cancela, el lugar se queda vacío porque nadie se entera».
// Lo que no se puede medir hoy: cuántas personas quisieron reservar y la
// encontraron llena (ni el panel ni el portal guardan ese intento).
import { leer } from './lib/base.mjs';
import { ZONA } from './lib/entorno.mjs';

const args = process.argv.slice(2);
const valor = (nombre, def) => { const i = args.indexOf(nombre); return i >= 0 ? args[i + 1] : def; };
const base = valor('--base', 'gymflow_pruebas');
const dias = Math.max(1, Number(valor('--dias', 28)) || 28);
const comoJson = args.includes('--json');
const futuras = Math.max(0, Number(valor('--futuras', 0)) || 0);

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const desde = new Date(Date.parse(`${hoy}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
// Hasta ayer (las que ya pasaron); con --futuras, también las que vienen.
const hasta = new Date(Date.parse(`${hoy}T12:00:00Z`) + futuras * 86_400_000 + (futuras ? 86_400_000 : 0)).toISOString().slice(0, 10);

const filas = await leer(`
  WITH ses AS (
    SELECT s.id, s."organizationId", s."branchId", s."businessDate", s.capacity, s."startsAt"
      FROM class_schedules s
     WHERE s.status <> 'CANCELED' AND s."businessDate" >= $1::date AND s."businessDate" < $2::date
  ),
  ev AS (
    SELECT b."classScheduleId" AS id, b."bookedAt" AS t, 1 AS d
      FROM class_bookings b JOIN ses ON ses.id = b."classScheduleId"
    UNION ALL
    SELECT b."classScheduleId", b."canceledAt", -1
      FROM class_bookings b JOIN ses ON ses.id = b."classScheduleId"
     WHERE b."canceledAt" IS NOT NULL
  ),
  corrido AS (
    -- A la misma hora, primero la cancelación: así no se cuenta un «lleno» que no existió.
    SELECT id, t, sum(d) OVER (PARTITION BY id ORDER BY t, d ROWS UNBOUNDED PRECEDING) AS vivas FROM ev
  ),
  pico AS (SELECT id, max(vivas) AS pico FROM corrido GROUP BY id),
  lleno AS (
    SELECT c.id, min(c.t) AS cuando FROM corrido c JOIN ses ON ses.id = c.id WHERE c.vivas >= ses.capacity GROUP BY c.id
  ),
  liberada AS (
    SELECT DISTINCT b."classScheduleId" AS id
      FROM class_bookings b JOIN lleno l ON l.id = b."classScheduleId" JOIN ses ON ses.id = b."classScheduleId"
     WHERE b."canceledAt" IS NOT NULL AND b."canceledAt" > l.cuando AND b."canceledAt" < ses."startsAt"
  ),
  final AS (
    SELECT b."classScheduleId" AS id, count(*) FILTER (WHERE b."canceledAt" IS NULL) AS al_final
      FROM class_bookings b JOIN ses ON ses.id = b."classScheduleId" GROUP BY 1
  )
  SELECT o."tradeName" AS gimnasio, ses."businessDate"::text AS dia,
         count(*)::int AS sesiones,
         count(*) FILTER (WHERE coalesce(p.pico, 0) >= ses.capacity)::int AS llenas,
         count(*) FILTER (WHERE lib.id IS NOT NULL AND coalesce(f.al_final, 0) < ses.capacity)::int AS liberadas,
         coalesce(sum(f.al_final), 0)::int AS reservas,
         sum(ses.capacity)::int AS cupo
    FROM ses
    JOIN organizations o ON o.id = ses."organizationId"
    LEFT JOIN pico p ON p.id = ses.id
    LEFT JOIN liberada lib ON lib.id = ses.id
    LEFT JOIN final f ON f.id = ses.id
   GROUP BY o."tradeName", ses."businessDate"
   ORDER BY o."tradeName", ses."businessDate"`, [desde, hasta], { base });

const porGimnasio = new Map();
for (const f of filas) {
  const g = porGimnasio.get(f.gimnasio) ?? { gimnasio: f.gimnasio, dias: [], sesiones: 0, llenas: 0, liberadas: 0, reservas: 0, cupo: 0 };
  g.dias.push(f);
  for (const k of ['sesiones', 'llenas', 'liberadas', 'reservas', 'cupo']) g[k] += f[k];
  porGimnasio.set(f.gimnasio, g);
}
const resumen = [...porGimnasio.values()].map((g) => {
  const diasConClases = g.dias.length;
  const promedio = diasConClases ? g.llenas / diasConClases : 0;
  const diasConMasDeUna = g.dias.filter((d) => d.llenas > 1).length;
  return {
    gimnasio: g.gimnasio, diasConClases, sesiones: g.sesiones, llenas: g.llenas, liberadas: g.liberadas,
    ocupacion: g.cupo ? Math.round((g.reservas / g.cupo) * 100) : 0,
    llenasPorDia: Math.round(promedio * 100) / 100, maxEnUnDia: Math.max(0, ...g.dias.map((d) => d.llenas)), diasConMasDeUna,
    // La regla de DA-14: «si se llena más de una al día, se te pregunta».
    preguntar: promedio > 1,
  };
});

if (comoJson) {
  console.log(JSON.stringify({ base, desde, hasta, dias, futuras, resumen, porDia: filas }, null, 2));
} else {
  console.log(`Clases llenas · ${base} · del ${desde} al ${hasta} (sin incluir) · ${dias} días atrás${futuras ? ` y ${futuras} adelante` : ''} · solo lectura`);
  if (resumen.length === 0) console.log('  Ningún gimnasio dio clases en esa ventana: no hay nada que medir todavía.');
  for (const g of resumen) {
    console.log(`\n${g.gimnasio}: ${g.sesiones} clases en ${g.diasConClases} días, ocupación ${g.ocupacion} %`);
    console.log(`  se llenaron ${g.llenas} (${g.llenasPorDia} por día; máximo ${g.maxEnUnDia} en un día; ${g.diasConMasDeUna} días con más de una)`);
    console.log(`  ${g.liberadas} se llenaron y llegaron a la hora con un lugar vacío: alguien canceló y nadie se enteró`);
    console.log(`  DA-14: ${g.preguntar ? 'se llena MÁS de una al día: toca preguntarle a Israel por la lista de espera (opción b)' : 'no se llena más de una al día: se queda sin lista de espera (opción a) y se vuelve a medir'}`);
  }
}
