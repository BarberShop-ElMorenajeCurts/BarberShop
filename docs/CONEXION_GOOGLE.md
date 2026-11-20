# Conexión Google: preparación del propietario

Esta guía corresponde a C4 de `docs/ETAPA_2.md`. La aplicación local y sus pruebas simuladas ya existen. **La cuenta del negocio, Calendar y la entrega real de Gmail todavía no están comprobadas.** Esta fase prepara la configuración; no abre reservas públicas ni ejecuta pruebas que envíen mensajes.

La referencia técnica completa continúa en [SERVIDOR.md](SERVIDOR.md). Aquí se indican las acciones del propietario y las evidencias necesarias para avanzar.

## Lo que debe definir el propietario

Cuenta indicada: `web.elmorenajecuts@gmail.com`. Se utilizará como identidad prevista para `ADMIN_GOOGLE_EMAIL`; todavía no se ha autorizado ni comprobado su conexión. El dominio y Hosting Deluxe se comprarán en GoDaddy; el callback HTTPS definitivo espera el dominio y la preparación del alojamiento.

Actualización del 17 de noviembre de 2026: el propietario confirma que el cliente OAuth ya fue creado. Falta completar sus credenciales directamente en el entorno privado y ejecutar la autorización y las comprobaciones; no hace falta crear otro cliente por defecto.

- Comprobar que la cuenta indicada puede iniciar sesión y usar Gmail. La identidad prevista ya está definida; no es necesario volver a elegirla.
- El origen que utilizará el navegador en el entorno de prueba: local o dominio HTTPS preparado. Debe mantenerse estable durante la autorización.
- Un calendario editable distinto por barbero y calendarios de prueba controlados para la homologación. No hace falta compartir la contraseña.
- Destinatarios de prueba que acepten recibir invitaciones y correos. No utilizar clientes reales para comprobar el desarrollo.

La identidad administrativa y los datos comerciales se completan en el servidor y el portal correspondientes; los secretos se guardan directamente en el entorno privado del alojamiento o en `.env` local, nunca en el chat ni en código del navegador.

## Preparación offline

1. Copiar `.env.example` a `.env`, si todavía no existe, sin reemplazar una configuración previa. Completar las credenciales del cliente OAuth web, la identidad autorizada y una clave aleatoria de 32 bytes codificada en base64. El comando de generación y cada variable están documentados en `SERVIDOR.md`.
2. Definir `APP_ORIGIN` explícitamente y usar el mismo origen al navegar. Configurar `GOOGLE_REDIRECT_URI` con ese origen más `/api/auth/google/callback`, sin parámetros ni fragmentos. Registrar exactamente esa URI en Google Cloud. Si no se configura la variable de callback, el servidor la deriva del origen; el diagnóstico lo señala para que también se registre en la consola.
3. Mantener `APP_MODE=setup` mientras se prepara la cuenta. Este modo permite el inicio de sesión administrativo y completar datos, pero impide reservas y trabajos externos. `demo` es exclusivamente una simulación local y no sirve como evidencia de conexión Google.
4. Ejecutar la comprobación local:

```powershell
node scripts/preflight.mjs
node scripts/preflight.mjs --live
```

El coordinador añade el alias `npm run check:config`; para exigir los requisitos reales con ese alias se utiliza `npm run check:config -- --live`.

El primer comando admite una preparación `setup`/`demo` coherente y enumera los requisitos pendientes. `--live` devuelve un resultado no apto hasta que el modo efectivo y los requisitos locales sean los de operación real. Que falle en `setup` es intencional: no obliga a cambiarlo antes de preparar Google. No activar `live` solo para conseguir que el diagnóstico termine correctamente.

La comprobación usa las mismas reglas base de `server/config.mjs`, lee `.env` mediante `process.loadEnvFile` si existe y respeta las variables ya establecidas en el entorno. No modifica archivos, no crea SQLite, no imprime valores de configuración, no inicia sesión y no contacta Google. Un resultado apto solo valida coherencia local; **no demuestra conexión ni permisos efectivos**.

## Configuración de Google y acción del propietario

1. En el proyecto Google Cloud elegido, habilitar Google Calendar API y Gmail API. Crear un cliente OAuth de tipo aplicación web y configurar su pantalla de consentimiento para la audiencia correspondiente. Si está en pruebas, incluir la cuenta del propietario como usuario de prueba.
2. Registrar el callback exacto del entorno. Guardar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` únicamente en el servidor. Configurar `ADMIN_GOOGLE_SUB` o `ADMIN_GOOGLE_EMAIL`; si existen ambos, el identificador `sub` tiene prioridad y ambos deben corresponder al mismo propietario.
3. Habilitar `EMAIL_ENABLED=true` para solicitar el permiso de envío Gmail y reiniciar la API. Si la cuenta ya estaba conectada sin ese permiso, el propietario debe volver a autorizarlo.
4. Abrir `/admin` desde un navegador normal y elegir el inicio de sesión Google. El propietario inicia sesión y acepta el consentimiento directamente en Google. La aplicación usa código de autorización con `state`, PKCE y acceso offline; no requiere compartir contraseñas.
5. Revisar el usuario mostrado en el portal. Una cuenta ajena a la identidad configurada debe ser rechazada por la aplicación aunque pueda iniciar sesión en Google.
6. Asociar los calendarios de los profesionales desde Configuración del portal. Verificar que la cuenta autorizada pueda editar cada calendario e invitar asistentes. **Configurar y comprobar `America/Curacao` como zona horaria de cada calendario** y del entorno del negocio.
7. Mantener sin confirmar los datos comerciales provisionales. Completar la ficha [DATOS_NEGOCIO.md](DATOS_NEGOCIO.md) y cargar solamente información revisada antes de habilitar reservas reales.

Permisos utilizados: identidad básica (`openid`, `email`, `profile`), `https://www.googleapis.com/auth/calendar.events` y `https://www.googleapis.com/auth/gmail.send`. El servidor no solicita lectura del buzón Gmail. Su funcionamiento y las restricciones están en [OAuth de servidor](https://developers.google.com/identity/protocols/oauth2/web-server) y [permisos de Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).

Los tokens renovables pueden revocarse. En proyectos OAuth externos con estado Testing y estos permisos adicionales, el refresh token normalmente vence a los siete días; revisar la [configuración de publicación y vencimiento](https://developers.google.com/identity/protocols/oauth2/#expiration) antes de una operación continua. Pasar el proyecto a una configuración adecuada y revisar las condiciones aplicables no sustituye comprobar la renovación real.

Conectar un plugin Google al chat no sustituye esta autorización del servidor de la web.

## Evidencia pendiente para cerrar C4 real

Registrar fecha, entorno, responsable y resultado sin guardar tokens, cookies ni secretos:

| Comprobación | Evidencia que debe obtenerse después de autorizar la cuenta |
| --- | --- |
| Identidad administrativa | El propietario accede y una cuenta distinta no obtiene acceso administrativo. |
| Renovación sin sesión | Con navegador desconectado y token de acceso anterior vencido, el servidor conserva acceso mediante renovación autorizada. Un indicador local de conexión no basta para demostrarlo. |
| Calendario por barbero | Cada profesional apunta al calendario previsto y la cuenta posee permisos de edición/invitación. |
| Zona horaria | Todos los calendarios asociados usan `America/Curacao`; comprobar además un evento ocupado de día completo en C7. El diagnóstico offline no puede consultar ni validar esta propiedad remota. |
| Gmail | Un destinatario de prueba recibe el correo esperado; conservar referencia del caso y hora, sin copiar datos privados al informe. |
| Desconexión y cuotas | Los fallos de autorización o envío aparecen en el portal/historial y no generan confirmaciones falsas. |

La implementación actual interpreta los eventos de día completo en la zona del negocio. Si un calendario utiliza otra zona, la ocupación podría discrepar: no certificar ese calendario hasta ajustar la zona y comprobar un caso de día completo. No se cambia el servidor en esta preparación.

Crear eventos o enviar correo para obtener estas evidencias corresponde a la fase real posterior, con cuenta y calendarios configurados y destinatarios de prueba acordados. Los casos C7 de retención, aprobación, cancelación, cambios desde Calendar, espera efectiva de dos horas y recordatorio de 24 horas están enumerados en `ETAPA_2.md`; las pruebas con reloj simulado no sustituyen esas esperas reales.

Calendar puede enviar invitaciones y el servidor envía correos por Gmail, sujetos a sus cuotas. Si la entrega de un envío queda desconocida, el sistema la marca para revisión y no la reenvía automáticamente; ver la limitación documentada en `SERVIDOR.md`. No se garantiza coste total cero ni entrega ilimitada.

**Estado de esta entrega:** preparación offline y guía disponibles. Conexión, renovación y entrega reales pendientes de la cuenta y autorización del propietario. No se publican ni habilitan reservas por completar esta preparación.
