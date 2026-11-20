# Servidor de ElMorenaje Cuts

La API usa Node nativo y SQLite, sin paquetes de servidor adicionales. Requiere Node **22.13 o posterior**; se verificó con Node 24.22.1. Los contratos públicos y administrativos están en `src/lib/contracts.ts` y `docs/CONTRATOS.md`.

## Arranque local

Con Vite ya abierto en `http://localhost:8443`, iniciar la API en otra terminal:

```powershell
npm run dev:api
```

El script usa `API_HOST=127.0.0.1` y `API_PORT=3001`; Vite reenvía `/api` y `/media` al servidor. `APP_ORIGIN` debe coincidir exactamente con el origen que usa el navegador, incluido puerto y protocolo. Abrir `localhost` y configurar `127.0.0.1` como origen no son equivalentes.

Para probar el flujo sin Google ni correos reales:

```powershell
npm run dev:api:demo
```

El modo demo es explícito, mantiene datos separados en `.data/demo` y sustituye Calendar/Gmail por adaptadores locales. El acceso administrativo demo exige dirección remota de loopback y `Host`/`Origin` locales; no confía en cabeceras `X-Forwarded-*`. No exponer Vite ni el servidor demo mediante un proxy público.

## Modos y variables

Copiar `.env.example` a `.env` y completar los valores en el entorno del servidor; no incluir credenciales en Git ni en variables `VITE_*`.

| Variable | Uso |
| --- | --- |
| `APP_MODE` | `setup`, `demo` o `live`. `setup` impide reservas y tareas externas; permite preparar configuración y autorizar Google. Sin valor, se elige `live` solo si existen los requisitos OAuth básicos; de lo contrario, `setup`. |
| `APP_ORIGIN` | Origen público exacto de la web. HTTPS obligatorio para operación real fuera de localhost. |
| `API_HOST`, `API_PORT` | Dirección/puerto cuando se usa `dev:api`; valores locales predeterminados `127.0.0.1:3001`. |
| `HOST`, `PORT` | Dirección/puerto de `npm start` o `node server/index.mjs`; valores predeterminados `127.0.0.1:3001`. En alojamiento, usar la interfaz/puerto exigidos por el proveedor. |
| `DATA_DIR` | Raíz de almacenamiento persistente, por defecto `.data`. Se crean subdirectorios `live` y `demo` independientes. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Credenciales de un cliente OAuth de tipo aplicación web. |
| `GOOGLE_REDIRECT_URI` | Callback registrado exactamente; local: `http://localhost:8443/api/auth/google/callback`. |
| `ADMIN_GOOGLE_SUB` | Identificador estable de la identidad administrativa autorizada. Si se configura, tiene prioridad sobre el correo. |
| `ADMIN_GOOGLE_EMAIL` | Alternativa de autorización mediante correo Google verificado; comparación sin distinguir mayúsculas. Basta uno de los dos identificadores administrativos. |
| `TOKEN_ENCRYPTION_KEY` | Clave aleatoria de 32 bytes codificada en base64 para cifrado AES-256-GCM de tokens. Mantenerla estable y respaldarla fuera del código. |
| `EMAIL_ENABLED` | `true` para solicitar y utilizar `gmail.send`. Debe estar habilitado y autorizado antes de ofrecer reservas reales. |
| `GOOGLE_POLL_INTERVAL_MS` | Intervalo de sincronización; mínimo 10000 ms, predeterminado 30000 ms. El ejemplo propone 60000 ms. |

Generar la clave localmente, sin compartirla en el chat:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Cambiar la clave impide descifrar las credenciales guardadas y obliga a reconectar Google. Cambiar la identidad administrativa invalida tanto sesiones anteriores como las credenciales offline del propietario anterior.

## Conectar la cuenta personal de Google

1. Crear o seleccionar un proyecto de Google Cloud y habilitar **Google Calendar API** y **Gmail API**. Esta implementación necesita un buzón Gmail activo en la cuenta autorizada; una cuenta Google creada con otro proveedor de correo no garantiza tenerlo.
2. Configurar la pantalla de consentimiento OAuth para la audiencia correspondiente. Durante pruebas, añadir la cuenta del propietario como usuario de prueba.
3. Crear un cliente OAuth de tipo **Web application**. Registrar la URI exacta de retorno, incluido esquema, dominio, puerto y `/api/auth/google/callback`. En producción usar el dominio HTTPS definitivo.
4. Completar las variables del servidor, `EMAIL_ENABLED=true` y la identidad administrativa. Reiniciar la API.
5. Abrir `/admin` e iniciar sesión con Google desde un navegador normal. El servidor usa código de autorización, `state`, PKCE y acceso offline. Nunca solicita la contraseña Google ni entrega tokens al navegador.
6. Aceptar los permisos de Calendar y envío de Gmail. Si se activó Gmail después de una conexión previa, volver a autorizar para otorgar `gmail.send`.
7. En Google Calendar, crear un calendario distinto por barbero y copiar su ID desde la configuración de cada calendario. La cuenta conectada debe poder editar los calendarios e invitar asistentes. Registrar cada ID en Configuración del portal.
8. Completar servicios, precios/moneda, profesionales, horarios y datos comerciales; marcar su confirmación solo después de revisarlos. Cambiar `APP_MODE=live` y reiniciar cuando corresponda. El catálogo público sigue con reservas deshabilitadas mientras falten integración Google, permiso Gmail o datos comerciales válidos.

Permisos solicitados: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar.events` y, con correo habilitado, `https://www.googleapis.com/auth/gmail.send`. No se solicita lectura del buzón Gmail. La API pública nunca devuelve IDs de calendarios privados ni datos de clientes.

Los proyectos OAuth externos con estado **Testing** emiten normalmente refresh tokens que vencen a los siete días cuando solicitan estos permisos adicionales. Para operación continua, revisar la configuración de publicación y los requisitos aplicables al uso personal y los permisos solicitados. No se presupone que toda aplicación privada requiera el mismo proceso de revisión. Los tokens también pueden revocarse o caducar por otros motivos; el portal muestra desconexiones y es necesario volver a autorizar. Véanse las [reglas de vencimiento de tokens](https://developers.google.com/identity/protocols/oauth2/#expiration), el [estado de publicación OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) y los [permisos de Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).

Conectar Calendar o Gmail como plugin de un chat no configura esta aplicación publicada: necesita sus propias credenciales y autorización del servidor.

## Reservas, trabajos y sincronización

- Las solicitudes online se validan otra vez al recibirlas: contacto completo, servicio/barbero válidos, horario de trabajo, más de dos horas de anticipación y ausencia de solapamientos. La oferta online llega hasta 180 días y avanza en intervalos de 15 minutos desde cada horario configurado.
- Una transacción SQLite retiene el intervalo antes de crear el evento pendiente. Un identificador idempotente con huella del contenido evita reservas duplicadas y rechaza su reutilización con datos de otro cliente.
- El evento pendiente ocupa el calendario sin invitados. Tras sincronizar el bloqueo, se fija una sola vez el plazo de dos horas. Los reintentos y reprogramaciones no lo reinician. Una sincronización fallida conserva la retención local y devuelve un fallo explícito; no simula una solicitud recibida correctamente.
- Aprobar actualiza ese mismo evento e invita al cliente. La confirmación automática se ejecuta desde trabajos persistentes; no depende del navegador. Rechazar solo es válido antes del límite; después se utiliza cancelar, incluso si el proceso automático se retrasó.
- La confirmación vuelve a leer el evento y comprueba conflictos. Nunca confirma una cita cuyo inicio ya pasó. Los conflictos o cambios incompatibles quedan señalados para revisión; aprobar o reprogramar explícitamente permite resolverlos cuando el intervalo es válido.
- Versiones esperadas y transacciones resuelven decisiones simultáneas. Los cambios externos no comparten una transacción con SQLite: se usan ETags/condiciones de Google, detección de conflicto y reconciliación. No se afirma atomicidad entre ambos sistemas.
- Los trabajos se revisan aproximadamente cada dos segundos. Los fallos transitorios de Calendar se reintentan con espera creciente. Un proceso detenido recupera los trabajos de Calendar pendientes usando IDs estables y sin crear otra cita.
- La sincronización usa polling incremental, páginas completas y tokens persistentes. Un HTTP 410 reinicia la sincronización completa. No se implementan webhooks ni se promete actualización instantánea. La disponibilidad consulta también eventos expandidos de Calendar en el intervalo solicitado, incluidos recurrentes y de día completo; nunca muestra sus títulos al visitante.
- Mover una cita vinculada desde Calendar actualiza hora/barbero admitido, conserva el plazo y recalcula comunicaciones. Eliminarla cancela la reserva y anula confirmaciones/recordatorios pendientes. Un evento externo sin vínculo bloquea disponibilidad sin crear clientes ficticios.
- Una edición de Calendar que compite con una reprogramación local conserva el estado externo, detiene la escritura obsoleta y registra el cambio local pendiente en el historial. El administrador revisa y aprueba, reprograma o cancela; no se sobreescribe el cambio externo silenciosamente.
- Los bloqueos administrativos se reflejan en Calendar; eliminarlos desde el portal retira su evento. Cambiar o eliminar desde Calendar un bloqueo vinculado en su calendario también se incorpora al portal.
- Los estados de negocio y sincronización permanecen separados. El portal expone errores y un historial de cambios. Un ID de calendario con citas activas no se cambia directamente: primero se reprograman o cancelan esas citas.

## Correos y cuotas

Gmail envía correos MIME en ES/EN desde la cuenta autorizada: recepción, confirmación, rechazo, cancelación, reprogramación y recordatorio. Calendar puede emitir además su invitación o actualización al cliente; sus avisos y los correos del sistema son mecanismos distintos.

El recordatorio corresponde a 24 horas antes, solo para citas confirmadas. Si ese momento ya pasó al confirmar/reprogramar, se omite. Se invalida al cancelar o cambiar la cita. Si una interrupción retrasa un recordatorio más de 15 minutos, se omite para evitar avisos retroactivos.

Las cuotas y restricciones de Gmail/Google dependen de la cuenta y del proyecto; no se garantiza envío ilimitado ni costo total cero. Un límite explícito de cuota puede reintentarse con espera. Consultar [errores y límites de Gmail](https://developers.google.com/workspace/gmail/api/guides/handle-errors) y [users.messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).

**La entrega de correo no tiene garantía exactly-once.** Gmail no ofrece una clave idempotente para este envío. La base de datos evita repetir trabajos completados y usa `Message-ID` estable, pero esa cabecera no garantiza deduplicación en Gmail. Si se pierde la respuesta o el proceso se detiene durante un envío, el trabajo queda `uncertain` y aparece una advertencia en el portal/historial; no se reenvía automáticamente. El administrador debe comprobar el correo enviado en Gmail y resolver el caso operativamente. Actualmente no hay botón de reenvío ni reconciliación automática del buzón, porque el permiso concedido es solo de envío.

## Persistencia y publicación

`DATA_DIR/live/appointments.sqlite` contiene reservas, catálogo, sesiones, tokens cifrados, auditoría, trabajos y caché de Calendar. Las fotos se guardan en `DATA_DIR/live/media`, fuera de `dist`. Las imágenes aceptadas son JPEG, PNG y WebP, hasta 5 MB, con comprobación de firma y metadatos ES/EN. Las mutaciones requieren autenticación y CSRF; las imágenes publicadas se sirven mediante `/media` con tipo fijo y `nosniff`.

El despliegue admitido es **una instancia** con proceso Node continuamente activo y disco persistente. No usar un sistema de archivos efímero ni suspender el proceso si se requiere puntualidad de las dos horas. Para escalar a varias instancias habría que cambiar coordinación de trabajadores y almacenamiento. Respaldar SQLite junto con sus archivos WAL mediante una copia coherente o con el proceso detenido, fotos y clave de cifrado. Restringir el acceso del sistema operativo a `.env` y `DATA_DIR`.

```powershell
npm run build
npm start
```

La API sirve `/api`, las fotos `/media` y el frontend compilado `dist`, incluido `/admin`. Un proxy HTTPS debe conservar cookies y el origen configurado; el servidor no confía en cabeceras de proxy para permitir el modo demo. Sesiones HttpOnly/SameSite=Lax duran ocho horas y usan Secure cuando `APP_ORIGIN` es HTTPS; las mutaciones administrativas exigen el token CSRF recibido en `/api/session`.

La identidad del cliente, enlaces de redes, dirección, fotos y horarios comerciales definitivos todavía requieren revisión del propietario. No habilitar el lanzamiento únicamente porque la compilación pase.

## Verificación

```powershell
npm test
npm run check
npm run build
```

Las pruebas `server/*.test.mjs` usan SQLite temporal, relojes controlados, adaptadores locales y respuestas OAuth simuladas. Cubren anticipación, reservas simultáneas, idempotencia, aprobación/rechazo al límite, recuperación de trabajos, cambios externos, conflictos, recordatorios, fotos, acceso HTTP, cookies, CSRF, estados OAuth/PKCE y vinculación de credenciales al propietario. No crean eventos ni envían correos reales. En entornos que bloquean conexiones HTTP de loopback, las pruebas HTTP necesitan permiso para conectar a `127.0.0.1`.

Con la API **demo** abierta y Vite funcionando se puede ejecutar `npm run test:smoke`; el script se niega a operar fuera del modo demo. La prueba con Calendar y Gmail reales queda pendiente de configurar y autorizar la cuenta del negocio.

Fuentes adicionales: [OAuth de servidor](https://developers.google.com/identity/protocols/oauth2/web-server), [sincronización incremental](https://developers.google.com/workspace/calendar/api/guides/sync), [creación de eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).
