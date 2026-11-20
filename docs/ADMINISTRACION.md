# Administración de ElMorenaje Cuts

Actualizado: 18 de noviembre de 2026. El portal se encuentra en `/admin` y conserva el estilo negro y amarillo aprobado. El acceso real utiliza exclusivamente la cuenta Google autorizada del negocio.

## Probar mientras se prepara Google

Desde `C:\workspace\BarberShop`:

```powershell
npm run preview:admin
```

El comando compila la web y sirve la demostración en [localhost:8444/admin](http://localhost:8444/admin). Selecciona «Explorar el portal de demostración». Detén el proceso con Ctrl+C. Si ese puerto está ocupado, define `ADMIN_PREVIEW_PORT` con otro puerto local antes de ejecutar el comando.

Esta demostración no carga `.env` ni credenciales Google. Usa los cinco servicios, precios ANG, cuatro barberos y horarios iniciales confirmados, con calendarios ficticios y comunicaciones simuladas. Los cambios de prueba se conservan entre reinicios únicamente en `.data/admin-preview/demo`, separados de los datos reales y de la demostración técnica anterior. No se migran automáticamente a producción. No uses datos personales reales para ensayar.

El acceso de demostración solo funciona en loopback. No habilita acceso sin Google en el portal real ni se incorpora al paquete de publicación.

## Qué puedes administrar

| Sección | Funciones |
| --- | --- |
| Resumen | Solicitudes pendientes, citas del día, próximos turnos, estado de integración e historial de cambios. |
| Agenda y solicitudes | Buscar cliente, filtrar por fecha/barbero/estado, aprobar o rechazar, registrar citas manuales, cancelar y reprogramar. Bloquear un intervalo concreto y volver a habilitarlo. |
| Negocio y servicios | Nombre comercial, dirección ES/EN, Maps, WhatsApp y redes. Agregar servicios, modificar nombre/descripción ES/EN, precio, moneda, duración y estado activo. |
| Barberos | Agregar profesionales, editar nombre y especialidad ES/EN, activar/desactivar, asignar servicios y asociar el ID privado del calendario Google. |
| Horarios | Seleccionar un barbero, abrir/cerrar cada día, editar intervalos y copiar el horario de otro profesional. |
| Fotografías | Cargar, previsualizar, reemplazar, ordenar por número, cambiar sección y textos alternativos ES/EN o retirar una imagen. |

## Guardar configuración

Negocio, servicios, barberos y horarios comparten «Guardar configuración». Los cambios de esas pestañas se guardan juntos. «Descartar cambios» vuelve a la configuración más reciente recibida del servidor. Al cambiar de módulo o cerrar la página, el portal avisa si hay cambios pendientes.

La revisión de catálogo protege frente a dos sesiones: si otra guarda primero, el servidor rechaza el guardado antiguo. El borrador permanece visible; revisa los cambios antes de descartarlo y cargar la versión actual. No se sobrescriben silenciosamente los datos de otra sesión. Durante el guardado se deshabilitan los controles de configuración.

El ID del calendario puede quedar vacío durante la preparación. Cada barbero requiere un calendario distinto para operar realmente. No se puede cambiar un calendario o retirar su barbero mientras conserve citas activas o bloqueos asociados. Desactivar conserva su historial y sus citas; lo retira de nuevas reservas. No cancela automáticamente turnos existentes.

Los servicios nuevos pueden conservar precio o duración pendientes durante la preparación; una duración válida para reservas es un número entero entre 5 y 480 minutos. La duración inicial es 30 minutos y la moneda inicial es ANG. Puedes quitar un borrador nuevo antes de guardarlo; los registros ya guardados se desactivan para conservar referencias e historial.

## Horarios y cierres

Todos los intervalos se introducen en hora de Curaçao. Desmarcar un día lo cierra; volver a marcarlo propone 09:00–21:00 para que lo ajustes. Para una pausa, por ejemplo, configura 09:00–13:00 y 14:00–21:00. No se aceptan intervalos superpuestos ni cierre anterior a apertura.

«Copiar horario» reemplaza el horario semanal del barbero seleccionado por una copia independiente del profesional de origen, después de confirmar. Revisa y guarda. No enlaza sus horarios para cambios posteriores.

El horario semanal regula nuevas reservas. Para vacaciones o ausencias de fechas concretas, utiliza «Bloquear horario» en la agenda. Cambiar horarios no cancela reservas ya registradas; cancela o reprograma cada cita afectada desde la agenda. Para retirar un bloqueo, usa «Habilitar horario».

## Fotografías

Admite JPEG, PNG o WebP de hasta 5 MB. Completa textos alternativos en español e inglés y elige Portada, Galería o Equipo. Un número de orden menor se muestra primero. Al editar puedes conservar la imagen y cambiar solo sus datos, o seleccionar un archivo para reemplazarla.

El reemplazo conserva el identificador y cambia la URL para evitar que se muestre una versión en caché. Si falla la escritura, conserva la fotografía anterior. Retirar la última fotografía deja la galería vacía o muestra el logotipo en portada/equipo. Las 31 fotografías propias incluidas se cargan una sola vez si todavía no existe una publicación administrada; las retiradas no se reponen al reiniciar. Retirar oculta la referencia en el sitio; las versiones estáticas incluidas permanecen en los archivos del paquete. Abre o recarga el sitio público para revisar los cambios guardados.

## Conexión y validación pendientes

El portal en `setup` permite configuración administrativa después del acceso Google, pero mantiene bloqueadas las reservas y los trabajos externos. La demostración permite ensayar esos recorridos con adaptadores simulados. Asociar los calendarios, autorizar Calendar/Gmail y ejecutar pruebas reales continúa en [CONEXION_GOOGLE.md](CONEXION_GOOGLE.md) y [VALIDACION_REAL.md](VALIDACION_REAL.md).

Verificación de esta entrega: TypeScript y compilación aprobados; 65 pruebas aprobadas en la ejecución completa, sin omisiones. Smoke HTTP de catálogo, conflictos de revisión, disponibilidad, citas, bloqueos y reemplazo de imagen aprobado. Revisión en Chrome del cambio de nombre, guardado de horarios, cierre/apertura de día, copia y persistencia al recargar; adaptación comprobada a 390 px sin recorte de los controles de intervalo. No se enviaron correos ni se crearon eventos reales.

El paquete ZIP del 17 de noviembre es una entrega anterior a estas mejoras; no debe confundirse con la compilación actual del portal.
