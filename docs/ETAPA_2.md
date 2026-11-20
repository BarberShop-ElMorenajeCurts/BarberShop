# Etapa 2 — preparación para operación real

Los contratos C0–C3 entregaron la versión local, con integración simulada y 23 pruebas de servidor aprobadas al cerrar esa etapa. Al 17 de noviembre de 2026, el catálogo comercial inicial está incorporado y la preparación local de operación está comprobada. El propietario confirmó el 19 de noviembre la compra de GoDaddy Hosting Deluxe. La conexión real Google, la validación del entorno de alojamiento y el despliegue siguen pendientes.

Esta etapa conserva el alcance y el diseño aprobados. No contrata servicios ni habilita reservas reales por el solo hecho de completar las tareas locales.

## Contratos y dependencias

| Contrato | Responsable | Objetivo | Puede empezar ahora | Dependencias para cerrar |
| --- | --- | --- | --- | --- |
| C4 · Google y correo | Asistente de reservas e integraciones | Preparar y comprobar la configuración; después conectar Calendar/Gmail del propietario. | Diagnóstico local y guía de conexión. | Cuenta administradora identificada, proyecto OAuth configurado y autorización del propietario; origen y callback del entorno elegido. |
| C5 · Datos y contenido | Asistente de UX/UI y contenido | Recoger y validar servicios, profesionales, horarios, contactos y fotografías definitivos en ES/EN. | Ficha de datos y revisión de pendientes. | Datos y materiales confirmados por el negocio. |
| C6 · Operación y alojamiento | Asistente de apoyo técnico | Respaldos, restauración en destino nuevo y preparación del despliegue con persistencia. | Herramientas locales de respaldo y restauración verificable. | Elección de alojamiento, dominio, presupuesto y configuración de secretos. |
| C7 · Validación real | Coordinador, con apoyo de integraciones | Verificar en un entorno controlado todo el recorrido con Calendar y correo reales. | Preparar los casos y las evidencias. | C4 conectado, datos de prueba controlados y entorno preparado por C6. C5 debe estar completo antes del lanzamiento público. |
| C8 · Publicación y entrega | Coordinador | Publicar la versión validada, comprobarla y entregar la operación al administrador. | Definir criterios de salida y manual de entrega. | C4–C7 aprobados, dominio y alojamiento disponibles y alcance de publicación definido. |

C4, C5 y C6 avanzan en paralelo en su preparación local. C7 espera las integraciones y el entorno; C8 espera la validación. No se duplica el desarrollo ya entregado en C0–C3.

## C4 — Google y correo

**Propiedad de la preparación:** `scripts/preflight.mjs`, sus pruebas bajo `scripts/tests/` y `docs/CONEXION_GOOGLE.md`. Cambios en `server/` solo si la validación identifica un defecto y se coordinan antes.

Entregables:

- Comando de comprobación offline de variables y coherencia del entorno, sin mostrar sus valores secretos, abrir bases de datos, contactar Google ni enviar correos.
- Distinguir un modo demo local de una configuración apta para pruebas reales; el modo demo no certifica la conexión Google.
- Guía de pasos del propietario, permisos requeridos y evidencia esperada, basada en el servidor existente.
- En una fase posterior, asociar cada barbero a su calendario y verificar acceso renovable y entrega de correo con destinatarios de prueba definidos.

Aceptación: los fallos de configuración tienen una explicación accionable; el diagnóstico no cambia datos ni imprime secretos. La conexión real solo se declara comprobada con evidencia de la cuenta autorizada.

## C5 — Datos y contenido

**Propiedad de la preparación:** `docs/DATOS_NEGOCIO.md` y `config/business.public.json`, integrados con el servidor, la web pública y el portal. Se conserva el diseño aprobado al incorporar los datos confirmados.

Entregables:

- Ficha para completar datos oficiales, servicios ES/EN, moneda, precio, duración, barberos, horarios por intervalos, pausas, calendarios y contactos.
- Inventario de imágenes para portada, galería y equipo, con orden y textos alternativos ES/EN.
- Separación entre datos confirmados, pendientes y ejemplos de demostración. No inventar precios, profesionales, dirección, reseñas ni afirmaciones comerciales.
- Relación de cada dato con su pantalla de configuración actual.

Aceptación: el propietario puede completar la ficha sin conocer código; ningún campo provisional se trata como confirmado. El catálogo inicial confirmado ya está incorporado; dirección, Maps y fotografías propias siguen pendientes.

## C6 — Operación y alojamiento

**Propiedad de la preparación:** `scripts/backup.mjs`, `scripts/restore.mjs`, sus pruebas bajo `scripts/tests/` y `docs/OPERACION.md`.

Entregables:

- Respaldo coherente de SQLite y las fotografías, con manifiesto verificable. Trabajar sobre una instancia detenida y comprobar lo que permite garantizar la herramienta.
- Restauración en un directorio nuevo; rechazar destinos existentes y rutas que pongan en riesgo la fuente. Nunca sobrescribir el almacenamiento actual por defecto.
- Prueba con datos temporales que compruebe lectura de reservas, catálogo y fotos restaurados; no utilizar información real del negocio en pruebas.
- Manual de respaldo, recuperación, ejecución continua, persistencia y reversión del despliegue. La clave de cifrado se conserva por separado; no copiar `.env` al respaldo ni mostrar secretos.
- Selección de alojamiento y configuración concreta cuando el propietario indique dominio, proveedor o presupuesto.

Aceptación: se puede recuperar un respaldo verificado en un destino nuevo; no se modifican ni borran la base original ni sus imágenes; no se contratan recursos.

## C7 — Validación real

Casos requeridos:

1. Acceso del administrador correcto y rechazo de otras identidades.
2. Solicitud en ES y EN, bloqueo del intervalo y evento pendiente sin invitación prematura.
3. Aprobación manual, rechazo y confirmación automática de dos horas en una prueba controlada con servidor continuamente activo.
4. Recordatorio de 24 horas en una cita de prueba y ausencia de recordatorios tras cancelar o reprogramar.
5. Cambios de fecha/barbero y eliminación desde Google Calendar, con reflejo correcto en el portal.
6. Recuperación tras reinicio y tratamiento visible de conflictos o desconexiones.
7. Fotografía publicada y persistente después de reiniciar/desplegar.
8. Respaldo y restauración comprobados; revisión de móvil y escritorio en el entorno elegido.

Las pruebas que creen eventos o envíen correo se limitan a calendarios y destinatarios de prueba acordados. Los relojes simulados ya usados en pruebas automáticas no se presentan como evidencia de una espera real de dos o veinticuatro horas.

Aceptación: registrar resultado, fecha, entorno y evidencia de cada caso; resolver fallos antes de C8. No habilitar reservas públicas para conseguir datos de prueba.

## C8 — Publicación y entrega

Entregables: despliegue validado, dominio/HTTPS comprobado, persistencia y trabajos activos, información comercial definitiva, prueba posterior al despliegue y guía del administrador. Conservar un punto de reversión y un respaldo antes de abrir reservas reales.

Aceptación: recorrido cliente–administrador operativo en el dominio final, sin modo demo ni información ficticia presentada como real; instrucciones de recuperación y responsable de la cuenta definidos.

## Información que requiere al propietario

- Cuenta administradora indicada por el propietario: `web.elmorenajecuts@gmail.com`. Falta configurarla y autorizarla; el correo facilitado no equivale a una conexión verificada.
- Dirección exacta, enlace de Maps y fotografías propias. Los cinco servicios, precios ANG, duración inicial de 30 minutos, cuatro barberos, contactos y horario de lunes a sábado de 09:00 a 21:00 ya están incorporados y son ajustables en el portal.
- Hosting Deluxe de GoDaddy comprado, según confirmación del propietario del 19 de noviembre. Nombre de dominio todavía no indicado; capacidades concretas de Node/SQLite persistente, configuración y despliegue pendientes. Ver [ALOJAMIENTO_GODADDY.md](ALOJAMIENTO_GODADDY.md).
- Autorización OAuth en la cuenta del negocio y posterior configuración de secretos en su entorno; no se solicitan contraseñas ni claves por chat.

## Estado verificado al 17 de noviembre de 2026

| Contrato | Resultado local | Pendiente para cierre real |
| --- | --- | --- |
| C4 | Diagnóstico offline y guía disponibles. Cuenta administradora configurada para preparación. Cliente OAuth creado, según el propietario. | Completar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` directamente en `.env`, autorizar la cuenta y comprobar calendarios, renovación y Gmail. |
| C5 | Cinco servicios con precios ANG y 30 minutos iniciales; Moreno, Nestor, Reimon y Noel con todos los servicios; lunes a sábado 09:00–21:00; WhatsApp y redes incorporados. | Dirección, Maps, fotografías propias y asociación privada de calendarios. Confirmación final del catálogo en el portal antes de abrir reservas. |
| C6 | Respaldo y restauración a destino nuevo probados. Paquete precompilado independiente y ZIP con manifiesto SHA-256 verificados. | Compra/configuración de dominio y alojamiento, persistencia privada SQLite/fotos y ejecución continua de una sola instancia. |
| C7 | Casos definidos; reglas verificadas con adaptadores simulados y arranque HTTP del paquete real comprobado. | Recorridos con cuenta, calendarios y destinatarios reales controlados; esperas efectivas y pruebas de persistencia en el alojamiento. |
| C8 | Entrega local preparada. | Publicación después de cerrar dependencias y comprobar dominio/HTTPS. |

Validación local: TypeScript y compilación aprobados; **60 pruebas aprobadas, sin omisiones** (23 del núcleo, 6 del catálogo, 9 del diagnóstico, 12 de respaldo/restauración y 10 del paquete). La prueba adicional `npm run test:release -- --directory .release/godaddy-2026-11-17` arrancó el paquete en `setup`, comprobó frontend, portal, catálogo, horarios y protección administrativa, y detuvo su proceso temporal. No contactó Google ni utilizó datos del negocio.

Entrega generada: `.release/godaddy-2026-11-17` y `.release/elmorenaje-godaddy-2026-11-17.zip`, con `package.json` en la raíz y 20 archivos de aplicación más el manifiesto. El ZIP no incluye `.env`, bases, respaldos ni `node_modules`. Ver [PAQUETE_PUBLICACION.md](PAQUETE_PUBLICACION.md) y [OPERACION.md](OPERACION.md).

El diagnóstico actual solo señala como pendientes las dos credenciales OAuth; se mantiene `APP_MODE=setup`. Este resultado no acredita conexión Google, envío real de correos ni publicación.

## Ampliación administrativa del 18 de noviembre

Se separaron Barberos y Horarios en el menú. El editor semanal permite abrir/cerrar días, gestionar intervalos y copiar horarios entre profesionales; protege los cambios no guardados y las ediciones concurrentes de catálogo. El servidor protege calendarios con bloqueos y reemplaza imágenes por una sola operación conservando su identidad. La demostración independiente se inicia con `npm run preview:admin`; ver [ADMINISTRACION.md](ADMINISTRACION.md) para uso, alcance de los ensayos y verificación. Esta ampliación no cambia las dependencias reales de C4, C7 y C8.

## Actualización de alojamiento del 19 de noviembre

La compra de Hosting Deluxe queda confirmada por el propietario. C6 continúa con la comprobación de Node.js Hosting, `node:sqlite`, almacenamiento privado persistente y una sola instancia continua. El dominio no se ha indicado y no existe un despliegue verificado. La compra no cierra C6 ni habilita C7/C8 por sí sola; ya no se solicita comprar de nuevo el plan.

## Fotografías y entrega del 19 de noviembre

Se preservaron 31 fotografías propias y un video recibidos en `dist/assets`, trasladando la fuente a `assets/photography/originals` mediante copia verificada antes de compilar. Las 31 versiones JPEG para web ocupan 6,6 MiB y no incluyen EXIF. El video permanece como original y no se publica en esta entrega. Ver [custodia y preparación](../assets/photography/README.md).

La portada, imagen del local y galería utilizan material propio, con textos ES/EN. La galería presenta cinco trabajos y permite mostrar los siguientes. Las fotos se inicializan una sola vez, respetan publicaciones administradas existentes y pueden editarse, reemplazarse o retirarse desde el portal sin reaparecer por un reinicio. Los respaldos distinguen referencias estáticas del paquete y fotografías subidas a `/media`.

Verificación: TypeScript y compilación aprobados, **72 pruebas aprobadas sin omisiones**, revisión en Chrome de portada/galería/visor/idiomas y 31 tarjetas del gestor. La prueba HTTP del paquete comprobó además cada una de las 31 imágenes. Se preservaron los hashes de los 32 originales. Sin Google, correo real ni despliegue externo.

Entrega actualizada: `.release/godaddy-fotos-2026-11-19` y `.release/elmorenaje-fotos-2026-11-19.zip`, con 52 archivos de aplicación y manifiesto, 8,35 MiB. El ZIP fue verificado por inventario, tamaño y SHA-256, con `package.json` en la raíz y sin secretos, datos, originales ni dependencias de desarrollo. Sustituye al ZIP del 17 de noviembre para el siguiente despliegue.
