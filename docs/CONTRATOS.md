# Contratos de construcción — ElMorenaje Cuts

Inicio: 11 de noviembre de 2026. Fuente funcional: `docs/ALCANCE.md`.

## Coordinación y dependencia

El responsable principal fija `src/lib/contracts.ts` y `src/lib/api.ts` antes de implementar. Los tres asistentes trabajan luego en paralelo sobre esos tipos. Solo la integración y las pruebas de recorridos completos esperan a que terminen los tres frentes. Los cambios en contratos se consultan al coordinador; nadie modifica archivos de otro frente.

| Contrato | Responsable | Archivos propios | Depende de | Entrega |
| --- | --- | --- | --- | --- |
| C0 | Coordinador | tipos/API compartida, configuración, scripts, ruta principal y documentación | Alcance aprobado | Contrato estable, instalación, integración y verificación. |
| C1 | UX/UI y web pública | `src/App.tsx`, `src/index.css`, `src/public/` | C0 | Mantener diseño y logo, ES/EN, formulario completo, disponibilidad real, estados de solicitud, fotos por sección y contactos configurables. |
| C2 | Reservas e integraciones | `server/` y sus pruebas; `docs/SERVIDOR.md` | C0 | API persistente, Google OAuth restringido, Calendar, trabajos durables, correo, imágenes y pruebas de reglas. |
| C3 | Portal administrador | `src/admin/` | C0 | Acceso Google y vistas de agenda, solicitudes, bloqueos, citas manuales, configuración y fotografías. |

## Estado de entrega

Los cuatro contratos están implementados e integrados localmente. C1, C2 y C3 se construyeron en paralelo una vez fijado C0. La coordinación integró los frentes y corrigió las diferencias detectadas durante la revisión.

- TypeScript y compilación de producción comprobados.
- 23 pruebas de servidor: reglas de reserva, concurrencia, recuperación, integración Google simulada, OAuth, sesiones, CSRF, imágenes y correo.
- Prueba HTTP en modo demo: catálogo, disponibilidad, idempotencia, conflicto, aprobación, cancelación, bloqueos, publicación de imagen y cierre de sesión.
- Recorrido en navegador: ES/EN, móvil y escritorio, menú/modal, solicitud en inglés, aprobación/cancelación administrativa, carga de fotografía, aparición en galería pública, retirada y cierre de sesión.
- La cuenta real de Google, la entrega real de Gmail y el alojamiento definitivo requieren configuración del propietario. El catálogo comercial inicial ya está incorporado; dirección, Maps y fotografías propias siguen pendientes. No se han creado eventos ni enviado correos reales.

Actualización del 17 de noviembre: C4–C6 incorporan diagnóstico offline, catálogo confirmado, respaldo/restauración y paquete de publicación. La verificación local ampliada pasó 60 pruebas, TypeScript, compilación y arranque HTTP del paquete generado. El estado y las dependencias reales se mantienen en [ETAPA_2.md](ETAPA_2.md).

## API acordada

La siguiente etapa se organiza en los [contratos C4–C8](ETAPA_2.md), con sus dependencias y criterios de aceptación.

Los objetos y campos exactos están en `src/lib/contracts.ts`; el cliente está en `src/lib/api.ts`.

- `GET /api/catalog` → `Catalog` público, sin IDs privados de calendarios ni datos de clientes.
- `Catalog.revision` identifica la configuración recibida. `CatalogUpdate.expectedRevision` es obligatorio al guardar; una revisión desactualizada devuelve `409 CATALOG_CHANGED`.
- `GET /api/availability?serviceId=&barberId=&date=YYYY-MM-DD` → `Availability`.
- `POST /api/bookings` → `BookingReceipt`; cuerpo `CreateBookingInput`.
- `GET /api/session` → `Session`; CSRF para mutaciones administrativas.
- `GET /api/auth/google` → inicio OAuth; callback `/api/auth/google/callback`.
- `POST /api/auth/demo` → `Session`, solo modo demo local explícito.
- `POST /api/auth/logout` → 204.
- `GET /api/admin/overview` → `AdminOverview`.
- `PUT /api/admin/catalog` → `Catalog`; cuerpo `CatalogUpdate`.
- `POST /api/admin/bookings` → `Booking`; cuerpo `ManualBookingInput`.
- `POST /api/admin/bookings/:id/action` → `Booking`; cuerpo `BookingAction` con versión esperada.
- `POST /api/admin/blocks` → `Block`; `DELETE /api/admin/blocks/:id` → 204.
- `POST /api/admin/photos` → `Photo`; cuerpo `PhotoUpload` (JPEG, PNG o WebP, máximo 5 MB).
- `PATCH /api/admin/photos/:id` → `Photo`; actualiza sección, orden y texto alternativo ES/EN. `dataUrl` opcional reemplaza la imagen conservando ID y generando una URL nueva.
- `DELETE /api/admin/photos/:id` → 204.

Errores: `{ error: { code, message } }` y HTTP adecuado. Fechas: ISO 8601 con zona/offset; se guardan como instantes. Negocio: `America/Curacao`. Los horarios semanales usan día 0=domingo y HH:mm locales.

`settings.whatsapp` contiene el número internacional (con + opcional, sin espacios), no una URL; la interfaz construye `https://wa.me/…`. Los demás contactos son URLs HTTPS o cadenas vacías.

## Reglas comunes obligatorias

- Una solicitud online requiere más de dos horas de anticipación, también al enviarla.
- Retención pendiente de dos horas; confirmación manual anticipada o automática al vencer si no fue rechazada.
- Nunca usar un temporizador del navegador para decidir el estado de una cita.
- Rechazo/cancelación/reprogramación cancelan o recalculan los trabajos de correo aplicables.
- El evento pendiente ocupa Calendar sin invitar todavía al cliente. Confirmar actualiza ese evento.
- Fallar de forma explícita si falta configuración; no mostrar éxitos ficticios ni credenciales de Google en el navegador.
- El modo demostración es explícito, local, con datos separados y sin correos ni eventos reales. La interfaz debe identificarlo.
- No habilitar reservas reales hasta confirmar datos comerciales, horarios, cuenta Google y correo.
- Inicio de sesión Google no concede administración a cualquier usuario: verificar la identidad autorizada en servidor.
- Las imágenes y registros deben persistir fuera de `dist/`. Se adopta SQLite y disco local como base portable para una sola instancia; el alojamiento deberá proporcionar persistencia.

## Verificación de integración

Compilación y TypeScript; pruebas del servidor para anticipación, concurrencia, idempotencia, auto-confirmación, rechazo, sincronización, acceso, recordatorios y fotos. Comprobar recorridos con adaptadores de prueba sin enviar comunicaciones reales. La comprobación con Google y correo reales queda pendiente de credenciales y autorización configuradas.
