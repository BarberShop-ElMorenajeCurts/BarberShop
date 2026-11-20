# C7 — protocolo de validación con Google y correo reales

Estado: preparado, pendiente de ejecución. Las 23 pruebas automáticas de la primera etapa usan adaptadores y respuestas controladas; no sustituyen las evidencias de este protocolo.

## Preparación

- C4: identificar cuenta administrativa y completar OAuth y autorización de Calendar/Gmail.
- C6: elegir entorno con persistencia y proceso continuamente activo, y comprobar recuperación del respaldo.
- Usar calendarios y destinatarios de prueba acordados; no solicitar reservas públicas para producir casos de prueba.
- Verificar que todos los calendarios de barberos estén configurados en `America/Curacao`. El cálculo actual de los eventos de día completo presupone la zona del negocio; no certificar calendarios de otra zona sin resolver esa diferencia.
- Preparar servicios y horarios de prueba identificados como tales. Los datos comerciales finales de C5 deben estar cargados antes de abrir reservas reales.
- Mantener la validación separada del negocio: una raíz de datos dedicada (por ejemplo, `DATA_DIR=.data/validation`) y calendarios de prueba. El catálogo de prueba necesita estar completo y su casilla de confirmación habilitada para recorrer el formulario en modo real; hacerlo solo en esa instancia aislada, sin acceso público y con destinatarios acordados. Esto no certifica los datos comerciales finales ni habilita la base de producción.
- Anotar versión del código, entorno y zona horaria. No incluir tokens, cookies ni datos de clientes reales en las evidencias compartidas.

## Registro de resultados

Todos los casos siguientes comienzan como **pendientes**. Por cada uno registrar: fecha/hora local de Curaçao, resultado, evidencia observada, incidencia y responsable. Las referencias de prueba pueden incluir el ID interno de reserva y el evento correspondiente, conservados en un registro privado.

| Caso | Acción | Resultado esperado | Estado |
| --- | --- | --- | --- |
| V01 | Acceder con cuenta autorizada y otra identidad de prueba. | Solo la autorizada entra al portal; no se filtran datos a la otra. | Pendiente |
| V02 | Solicitar cita en español con más de dos horas de anticipación. | Pendiente en portal, evento que ocupa el calendario del barbero sin invitado, correo de recepción y plazo de revisión coherente. | Pendiente |
| V03 | Repetir el caso en inglés. | Formulario, recepción y contenido del evento/invitación en el idioma correspondiente. | Pendiente |
| V04 | Reintentar una solicitud y enviar una distinta para el mismo intervalo. | Un único registro y evento para el reintento; el solapamiento distinto se rechaza. | Pendiente |
| V05 | Aprobar antes del plazo. | Actualiza el mismo evento, añade al cliente e informa confirmación; no crea una segunda cita. | Pendiente |
| V06 | Rechazar antes del plazo. | Libera capacidad en ambos sistemas e informa rechazo; después no confirma ni recuerda esa cita. | Pendiente |
| V07 | Dejar una solicitud sin decisión durante dos horas reales. | El servidor confirma sin navegador abierto; el plazo no se reinicia al recargar ni reiniciar. | Pendiente |
| V08 | Intentar solicitar a dos horas exactas o menos. | La web/API no aceptan la solicitud online e indican contactar al administrador. | Pendiente |
| V09 | Crear cita confirmada con más de 24 horas de anticipación y esperar el momento del recordatorio. | Llega el correo previsto 24 horas antes; se registra el resultado sin afirmar puntualidad si el proceso estuvo detenido. | Pendiente |
| V10 | Confirmar una cita a menos de 24 horas del inicio. | Llega confirmación; no se envía un recordatorio cuyo momento ya pasó. | Pendiente |
| V11 | Reprogramar y cancelar desde el portal. | Cambian evento y reserva; se actualizan o anulan comunicaciones pendientes. | Pendiente |
| V12 | Mover hora/barbero y eliminar una cita vinculada desde Calendar. | Se refleja en portal tras sincronizar; se conserva el plazo de revisión si seguía pendiente y se detienen trabajos al eliminar. | Pendiente |
| V13 | Agregar eventos ocupados, recurrentes y de día completo en calendarios de prueba con zona Curaçao. | No se ofrecen intervalos en conflicto ni se publican títulos de esos eventos. | Pendiente |
| V14 | Introducir un cambio externo que compita con una edición del portal. | Señala conflicto sin sobrescribir silenciosamente; el administrador puede resolverlo. | Pendiente |
| V15 | Interrumpir y reiniciar el servidor de prueba con tareas pendientes. | Recupera tareas y capacidad; no duplica eventos y señala envíos de resultado incierto. | Pendiente |
| V16 | Subir, ordenar, reemplazar y retirar imágenes; reiniciar/republicar. | Se reflejan en su sección y persisten; los textos alternativos ES/EN son correctos. | Pendiente |
| V17 | Respaldar y restaurar en un destino nuevo. | Base e imágenes recuperables; fuente intacta y clave de cifrado custodiada por separado. | Pendiente |
| V18 | Recorrer web y portal en móvil/escritorio bajo el dominio final. | Acceso, enlaces, idiomas y formularios operativos; sin datos ficticios presentados como reales. | Pendiente |

V07 y V09 requieren observar el comportamiento durante el tiempo real acordado. Una prueba con reloj simulado no cierra esos casos. Para mantener una prueba real en curso, se sigue su ejecución en el chat correspondiente y se registra el resultado al finalizar.

## Criterio de cierre

C7 se cierra con resultados observados y fallos resueltos. Si algún caso no pudo ejecutarse, se conserva como pendiente con causa explícita. No se declaran comprobados Calendar, correo o recordatorios únicamente porque la configuración local o la compilación sean correctas.

## Entrega a C8

Antes de abrir reservas: datos C5 confirmados, C4 conectado, respaldo y recuperación de C6 verificados, C7 aprobado y entorno de publicación definido. Preparar respaldo previo y procedimiento de reversión; comprobar luego el dominio, acceso administrativo, almacenamiento y ejecución continua en la versión publicada.
