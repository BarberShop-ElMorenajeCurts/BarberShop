# ElMorenaje Cuts — alcance y plan de trabajo

Actualizado: 17 de noviembre de 2026.

Documento de definición. No implica que las funcionalidades descritas ya estén implementadas.

## Requisitos confirmados por el cliente

- Una sede en Curaçao; marca ElMorenaje Cuts.
- Conservar logo, diseño, composición y colores aprobados.
- Web pública en español e inglés.
- Contacto por WhatsApp mediante conversación iniciada por el visitante. Sin mensajes automáticos de WhatsApp.
- Formulario de reserva con nombre, correo y teléfono, además de servicio, barbero, fecha y hora.
- Las solicitudes bloquean horario y quedan pendientes durante dos horas. El administrador puede aprobarlas o rechazarlas antes; si no las rechaza en ese plazo, se confirman automáticamente.
- Una cuenta personal de Google con un calendario por barbero; cada cita se asigna al calendario correspondiente.
- El administrador accede al portal con esa misma cuenta de Google, sin una contraseña adicional del sitio.
- Las citas pueden modificarse tanto en el portal como directamente en Google Calendar.
- El cliente debe contactar al administrador para cancelar o reprogramar; no habrá autogestión de esos cambios mediante enlaces.
- Un recordatorio por correo 24 horas antes de la cita.
- La web solo ofrece citas con más de dos horas de anticipación. Para citas más próximas, el cliente debe contactar al administrador.
- Correos de notificación y recordatorios; buscar una opción sin costo adicional de envío dentro de las cuotas disponibles.
- Portal interno autenticado para aprobar solicitudes, habilitar o inhabilitar horarios, registrar citas manualmente, cancelar y reprogramar.
- Gestión de fotografías de las distintas áreas de la web mediante usuario administrador.

## Datos todavía por definir

- Dirección exacta y pin de Maps. El material fotográfico propio ya se incorporó el 19 de noviembre.
- Excepciones de horario, cierres especiales y pausas, si las hay; no se crean pausas que el propietario no haya indicado.
- Nombre del dominio, compra del alojamiento y fecha de publicación. El propietario confirma GoDaddy Hosting Deluxe comprado; falta comprobar su configuración y capacidades.
- Completar las credenciales del cliente OAuth ya creado, autorizar Google y asociar los calendarios de los cuatro barberos.
- No se ha solicitado integrar pagos en esta definición; confirmar antes de ampliar el alcance.

Los datos del prototipo que no estén confirmados expresamente siguen siendo provisionales. El modo demo conserva sus ejemplos aislados para pruebas; no representa el catálogo definitivo del negocio.

## Catálogo inicial confirmado el 17 de noviembre de 2026

| Servicio | Precio indicado | Duración inicial |
| --- | --- | --- |
| Corte de pelo + barba | 40 ANG | 30 minutos |
| Corte de pelo (sin barba) | 35 ANG | 30 minutos |
| Corte para niños | 30 ANG | 30 minutos |
| Lavado de pelo | 5 ANG | 30 minutos |
| Cejas (damas) | 10 ANG | 30 minutos |

El propietario eligió mantener el código ANG en los precios. Precios, moneda y duración pueden ajustarse desde el portal.

Profesionales: **Moreno, Nestor, Reimon y Noel**. Los cuatro realizan inicialmente los cinco servicios, de **lunes a sábado de 09:00 a 21:00**, en hora de Curaçao. Horarios y asignaciones también son editables.

Contacto indicado: WhatsApp **+59996768925**, Instagram **el_morenajecuts**, TikTok **el_morenajecuts2** y Facebook **el_morenajecuts**. Se incorpora Facebook al editor y a los contactos públicos. Los enlaces construidos a partir de esos identificadores requieren comprobación del propietario antes de publicar.

Cuenta administrativa prevista: **web.elmorenajecuts@gmail.com**. El propietario confirma haber creado el cliente OAuth; esto no equivale a que el servidor esté autorizado ni a que Calendar y Gmail hayan sido probados.

## Flujo de reserva acordado y detalle técnico propuesto

1. El visitante elige servicio, barbero, fecha y hora disponible.
2. Completa nombre, correo y teléfono y revisa el resumen.
3. El servidor registra la solicitud y retiene el intervalo completo del servicio para ese barbero. Propuesta técnica: reflejar la retención con un evento interno que ocupe horario en Google Calendar, claramente marcado como pendiente, sin invitar todavía al cliente.
4. Cuando la solicitud está registrada y su bloqueo sincronizado, se fija una sola vez la recepción efectiva y su plazo de revisión: dos horas después. Se muestra y envía al cliente «Solicitud recibida; se confirmará automáticamente a las HH:mm si no es rechazada», en su idioma y con fecha y zona horaria inequívocas. Los reintentos no reinician el plazo.
5. El administrador puede aprobar o rechazar desde el portal durante ese plazo. Rechazar libera el intervalo y retira el bloqueo de Calendar; aprobar inicia inmediatamente la confirmación.
6. Al cumplirse las dos horas sin rechazo, un proceso de servidor inicia la confirmación automáticamente, aunque ningún navegador esté abierto. Esta tarea debe recuperarse si el servidor se reinicia.
7. Antes de confirmar, se comprueba que la solicitud siga pendiente y que no existan conflictos externos. Se actualiza el mismo evento del calendario del barbero y se invita al cliente; no se crea una segunda cita. La confirmación al cliente depende de que la sincronización haya finalizado correctamente.
8. Un conflicto, una desconexión de Google o un fallo de sincronización se muestra al administrador y se reintenta cuando corresponde; no se presenta al cliente una confirmación falsa. La retención local no se libera silenciosamente.
9. Cancelaciones y reprogramaciones actualizan reserva, Google Calendar y comunicaciones pendientes. El cliente las solicita contactando al administrador.

Las dos horas son un plazo para confirmar automáticamente, no un vencimiento que cancele la solicitud o libere el horario.

Regla acordada para citas de última hora: ofrecer online solo citas con más de dos horas de anticipación y atender las urgentes mediante contacto con el administrador. El servidor vuelve a comprobar esta condición al recibir el formulario: no basta con que el horario fuera válido cuando se mostró. No confirmar automáticamente una cita cuyo inicio ya haya pasado si el proceso de confirmación se retrasa.

El cliente no necesitaría una cuenta de Google para solicitar su cita. La cuenta conectada a Calendar sería la del negocio.

## Arquitectura propuesta, sin proveedor contratado

- Mantener React, Vite y Tailwind para la web pública y el portal.
- Añadir un servidor/API para autenticación, disponibilidad, reservas, sincronización con Calendar y envío de correos.
- Guardar reservas, estados, servicios, barberos, horarios y configuración en una base de datos persistente. Calendar no sustituye estos datos ni la gestión de fotografías.
- Guardar imágenes en almacenamiento persistente, con sección, orden y textos alternativos ES/EN.
- Inicio de sesión con Google y autorización administrativa restringida a la identidad del propietario configurada en el servidor. Iniciar sesión con cualquier cuenta Google no concede acceso administrativo.
- Autorizar la integración Google desde el servidor, con acceso renovable para operar sin que el administrador esté conectado, y mantener las credenciales fuera del navegador y del repositorio.
- Procesar sincronizaciones y correos con trabajos reintentables y protección frente a duplicados.
- Calcular disponibilidad combinando horarios, duración del servicio, bloqueos, reservas y ocupaciones de Google Calendar.
- Aplicar controles transaccionales para solicitudes simultáneas. Calendar no impide por sí solo crear eventos superpuestos.
- Usar la hora local de Curaçao en la experiencia pública y convertir fechas de forma coherente en el servidor.
- Sincronización en ambas direcciones para los calendarios asignados a los barberos; incorporar los cambios externos sin sobrescribirlos con trabajos antiguos.
- Mantener estados de negocio (pendiente, confirmada, rechazada, cancelada) separados de los estados técnicos de sincronización. Un error técnico no equivale a un rechazo.
- Rechazo, aprobación manual y confirmación automática deben competir por una única transición transaccional. Si el rechazo llega después de confirmar, mostrar el estado actual y ofrecer cancelación; no enviar mensajes contradictorios.
- El límite de revisión se evalúa con la hora del servidor: un rechazo pendiente solo es válido antes del plazo. Si el trabajo automático se retrasa, eso no extiende las dos horas; una intervención posterior debe tratarse como cancelación de la cita que corresponde confirmar, sin enviar primero una confirmación obsoleta.

## Cambios realizados directamente en Google Calendar

Detalle técnico propuesto para cumplir la gestión desde ambas interfaces:

- Respetar como bloqueos los eventos externos marcados como ocupados, incluidos los de día completo; no mostrar sus títulos ni datos al público.
- Conservar una relación entre reserva y evento para distinguir citas del sitio de otros eventos y reconocer las actualizaciones emitidas por el propio sistema.
- Incorporar los cambios de fecha y hora de una cita vinculada al portal y recalcular sus recordatorios. Si se mueve a otro calendario de barbero admitido, actualizar la asignación tras validar el destino.
- Una eliminación externa de una cita vinculada cancela esa reserva en la web y anula sus recordatorios. Si estaba pendiente, también detiene su confirmación automática. Registrar el origen del cambio para no confundirlo con un fallo de lectura o de permisos.
- Un evento externo sin una reserva vinculada bloquea disponibilidad; no se inventan nombre, correo, teléfono ni mensajes al cliente.
- Mover una cita pendiente no equivale por sí solo a aprobarla ni reinicia el plazo de dos horas. Si aparece un conflicto o queda fuera de las reglas de anticipación, señalar revisión administrativa.
- Obtener cambios mediante sincronización incremental y, si el alojamiento lo permite, notificaciones de Google. Renovar las suscripciones y disponer de reconciliación periódica; no prometer actualización instantánea.
- Los cambios externos no pueden compartir una transacción con la base de datos del sitio. Detectar solapamientos, conservar el historial y avisar al administrador en lugar de resolverlos silenciosamente.

Las solicitudes pendientes, la aprobación administrativa y la respuesta del invitado en Google Calendar son conceptos distintos.

## Correos y límites

Calendar puede enviar invitaciones y avisos de cambios a los invitados. Los recordatorios del organizador no configuran los del cliente; para cumplir el requisito de recordatorios por correo, el sistema debe programar sus propios envíos.

Mensajes previstos: solicitud recibida con hora límite de revisión, confirmación manual o automática, rechazo, cancelación, reprogramación y recordatorio previo. Deben respetar el idioma de la reserva y evitar duplicar innecesariamente los avisos de Google.

El recordatorio acordado es 24 horas antes del inicio y solo para citas confirmadas y vigentes. Como criterio inicial, si la confirmación ocurre cuando ya faltan menos de 24 horas, enviar la confirmación y omitir el recordatorio cuyo momento ya pasó. No enviar recordatorios retroactivos. Reprogramar invalida el envío anterior y calcula el nuevo; cancelar o rechazar impide cualquier recordatorio posterior.

La cuenta confirmada es personal de Google; el proveedor de correo y sus cuotas quedan pendientes del volumen previsto. No se garantiza costo total cero: alojamiento, almacenamiento y cuotas de envío deben revisarse al elegir infraestructura.

## Portal interno propuesto

- Acceso con la cuenta personal de Google del propietario, restringido a la identidad administrativa autorizada.
- Solicitudes con filtros por fecha, barbero y estado; aprobar o rechazar con motivo opcional.
- Mostrar el plazo restante hasta la confirmación automática y diferenciar confirmación manual, automática y error de sincronización.
- Vista de agenda, bloqueos, altas manuales, cancelación y reprogramación.
- Asociación explícita entre barbero y calendario de Google.
- Historial de cambios y estado de sincronización.
- Fotografías: cargar, previsualizar, asignar sección, ordenar, reemplazar y retirar; textos alternativos en español e inglés.
- Validar tipo y tamaño de las imágenes y proteger todas las operaciones administrativas desde el servidor.
- Propuesta adicional: permitir editar servicios y horarios para completar los datos pendientes sin modificar código. No se presupone un editor completo de todos los textos del sitio.

## Equipo y orden de trabajo

| Responsable | Entrega |
| --- | --- |
| Coordinación y frontend | Integración del proyecto, interfaz pública bilingüe y portal, manteniendo el diseño aprobado. |
| UX/UI y contenido | Flujo pendiente/aprobado, traducciones, accesibilidad y experiencia del gestor de fotografías. |
| Reservas e integraciones | Modelo de datos, aprobación, disponibilidad, Google Calendar, autenticación y correos. |
| Verificación, coordinada por el responsable principal | Recorridos completos, móvil, idiomas, concurrencia, errores, sincronización y publicación. |

1. Preparación: confirmar decisiones operativas, restablecer dependencias y comprobar compilación; definir contratos de datos.
2. Interfaz: ES/EN, formulario de solicitud y pantallas administrativas con estados explícitos. Cualquier demostración debe identificarse como tal.
3. Operación real: persistencia, acceso administrativo, Google Calendar, correos y almacenamiento de fotografías.
4. Publicación: cargar información definitiva y validar los recorridos completos en el entorno elegido.

## Decisiones operativas cerradas

1. Cuenta personal de Google e inicio de sesión administrativo con esa misma identidad.
2. Retención durante dos horas y confirmación automática si no se rechaza antes; posibilidad de aprobación anticipada.
3. Cancelación y reprogramación solicitadas por el cliente mediante contacto con el administrador.
4. Recordatorio por correo 24 horas antes.
5. Gestión desde el portal y desde Google Calendar, con sincronización hacia la web.
6. Solo se ofrecen online citas con más de dos horas de anticipación; las demás se gestionan por contacto con el administrador.

Las reglas operativas del flujo quedan definidas. La identidad exacta del administrador, los calendarios y la configuración OAuth se completarán al conectar la cuenta; no se requieren contraseñas compartidas. Siguen pendientes los datos comerciales y la elección de infraestructura indicados arriba.

Por ahora se propone que la gestión de contenido se limite a fotografías y sus textos alternativos. Los servicios y horarios serían configurables; ampliar a títulos y textos editoriales requiere definir ese alcance.

## Criterios de aceptación

- El diseño y el logo aprobados se conservan en móvil y escritorio.
- Navegación, formularios, mensajes y correos están disponibles en ES/EN.
- La web distingue solicitud recibida y cita confirmada, y no muestra éxito si falla el almacenamiento.
- Dos operaciones simultáneas no confirman reservas solapadas para el mismo barbero desde el sistema.
- La solicitud pendiente bloquea el intervalo tanto en la web como en el calendario del barbero antes de darse por recibida correctamente.
- El plazo de dos horas se calcula en el servidor y sobrevive a recargas, reintentos y reinicios; el cliente ve cuándo se confirmará automáticamente.
- Una solicitud no rechazada se confirma automáticamente tras las dos horas, sujeto a disponibilidad y sincronización correctas; la falta de respuesta no la cancela.
- La oferta y recepción de solicitudes online exigen más de dos horas hasta el inicio; un formulario que quedó abierto no permite eludir ese límite.
- Rechazo y confirmación simultáneos no producen dos decisiones o correos contradictorios.
- Una aprobación manual o automática actualiza un solo evento en el calendario correcto; un reintento no lo duplica.
- Si hay un conflicto o falla de Calendar, se informa al administrador y no se confirma indebidamente al cliente.
- Cancelación y reprogramación mantienen coherencia entre web, evento y recordatorios.
- Cambiar o eliminar una cita vinculada desde Calendar se refleja en la web y actualiza sus comunicaciones sin crear bucles de sincronización.
- Eventos externos no vinculados bloquean disponibilidad sin generar reservas ficticias ni comunicaciones.
- Los recordatorios solo se envían para citas vigentes y en el idioma correspondiente.
- No se envía un recordatorio de 24 horas cuyo momento ya haya pasado al confirmarse o reprogramarse la cita.
- Un usuario sin autorización no puede leer datos de clientes ni modificar agenda o fotografías.
- Los cambios de fotografías persisten y se reflejan en la sección elegida.
- Antes del lanzamiento se sustituyen contactos y datos provisionales y se comprueban compilación, accesibilidad y metadatos.

## Fuentes técnicas consultadas

- [Crear eventos en un calendario específico](https://developers.google.com/workspace/calendar/api/guides/create-events)
- [Consultar ocupación de calendarios](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Recordatorios y notificaciones](https://developers.google.com/workspace/calendar/api/concepts/reminders)
- [Autorización OAuth](https://developers.google.com/workspace/guides/configure-oauth-consent)
- [OAuth de servidor y acceso sin sesión activa](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Sincronización incremental de calendarios](https://developers.google.com/workspace/calendar/api/guides/sync)
- [Notificaciones de cambios de Calendar](https://developers.google.com/workspace/calendar/api/guides/push)
- [Cuotas de Apps Script, si se evalúa esta opción para correo](https://developers.google.com/apps-script/guides/services/quotas)

La conexión opcional de Google Calendar al asistente sirve para ayudar con la configuración; no reemplaza la autorización ni el servidor de la web publicada.
