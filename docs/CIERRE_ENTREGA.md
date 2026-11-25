# Cierre de entrega — ElMorenaje Cuts

Actualizado: 25 de noviembre de 2026. Estado actual de la instancia; los informes
anteriores conservan resultados históricos. No equivale a aceptación del cliente
ni a aprobación de Google.

## Publicación comprobada

- Dominio: `https://elmorenajecuts.com`, en Hostinger Node.js, entrada `app.cjs`.
- `/api/health`: `ok: true`, `mode: live`; catálogo con `bookingEnabled: true`.
- Cinco servicios en ANG, 30 minutos iniciales, cuatro barberos activos.
- La disponibilidad de Moreno, Nestor, Reimon y Noel respondió desde el dominio.
  Acredita lectura de disponibilidad, no todas las escrituras ni el correo.
- Páginas legales HTML públicas en español e inglés.
- Reimplementación comprobada: sin `noindex` en portada, URL canónica,
  `sitemap.xml` y `robots.txt` público con exclusión de administración/API.
  La aparición en buscadores no es inmediata ni está garantizada.
- El catálogo persistió entre las reimplementaciones observadas.
- Dirección autorizada: `133 Kaminda Saliña, Curaçao`. Pendiente de guardar en
  la configuración administrativa existente; cambiar el catálogo inicial del
  código no reemplaza los datos persistidos.

## Validación técnica

`npm test`, 25 de noviembre: 97 casos, 92 aprobados, cinco omitidos por
restricciones Windows para crear enlaces, cero fallos. Cubren OAuth, sesiones,
CSRF, reservas, concurrencia, trabajos, imágenes, paquetes y recuperación con
datos temporales. No sustituyen las pruebas reales de Google y del alojamiento.

## Pruebas reales autorizadas y pendientes

El propietario autorizó crear, aprobar, reprogramar y cancelar citas llamadas
**PRUEBA DE ENTREGA**, usando el teléfono público del negocio y avisos solo a
`web.elmorenajecuts@gmail.com`. No ampliar destinatarios ni usar citas de clientes.
Cancelar los turnos de prueba al finalizar y conservar su historial.

| Comprobación | Estado |
| --- | --- |
| Solicitud ES/EN, evento y correo recibido | Pendiente de ejecución controlada. |
| Aprobar, rechazar, reprogramar, cancelar y liberar horario | Pendiente de ejecución controlada. |
| Confirmación automática tras dos horas reales | Pendiente de observar el vencimiento. |
| Recordatorio al llegar a 24 horas antes de una cita | Pendiente de observar el envío. |
| Cambio desde Calendar y reflejo en el portal | Pendiente con eventos autorizados. |
| Respaldo de producción y restauración separada | Pendiente en Hostinger; herramientas locales probadas. |
| Recorrido final móvil, idiomas y administración | Pendiente de revisión final en el dominio. |
| Capacitación y aceptación del administrador | Guía preparada; entrega pendiente. |
| Verificación OAuth | En trámite según el propietario, aprobación no confirmada. |

Registrar fecha, evidencia y resultado de cada caso en
[VALIDACION_REAL.md](VALIDACION_REAL.md). No certificar un resultado por tener
la configuración habilitada.

## Material y custodia

- [Guía del cliente](ENTREGA_CLIENTE.md).
- [Administración](ADMINISTRACION.md).
- [Hostinger y cron](HOSTINGER_DESPLIEGUE.md).
- [Respaldo y recuperación](OPERACION.md).
- Código: `https://github.com/BarberShop-ElMorenajeCurts/BarberShop`.

Registrar por canal privado quién conserva las cuentas, las renovaciones,
la clave de cifrado y los respaldos. No incluir secretos en este documento.
