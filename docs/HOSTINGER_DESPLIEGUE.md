# Arranque en Hostinger

El proyecto combina una web React/Vite y un servidor Node que sirve `dist`,
`/admin`, `/api/*` y las imágenes cargadas. Configurar únicamente los archivos
estáticos deja fuera las rutas de administración y la integración con Google.

## Configuración

| Campo | Valor |
| --- | --- |
| Tipo de aplicación | Other |
| Node.js | 24 |
| Directorio raíz | `./` |
| Gestor de paquetes | npm |
| Script de compilación | `build` (ejecuta `npm run build`) |
| Directorio de salida | `dist` |
| Archivo de entrada | `app.cjs` |

Publica primero el commit que incorpora `app.cjs`; después selecciona ese archivo
de entrada y vuelve a desplegar. `npm start` utiliza la misma entrada.

La entrada CommonJS usa `import()` para cargar el servidor ESM, inicia el servicio
incluso si el proveedor carga el archivo mediante `require()` y fija el directorio
de trabajo en la raíz del proyecto. Así las rutas de `dist` y de datos relativos no
dependen del directorio del cargador. Las variables del hosting tienen prioridad
sobre un archivo `.env` local.

## Variables del servidor

- `HOST=0.0.0.0` y el `PORT` que proporciona el hosting. No fijar un puerto propio.
- `APP_MODE=setup` durante la preparación y las pruebas de la integración.
- `APP_ORIGIN=https://elmorenajecuts.com`.
- `GOOGLE_REDIRECT_URI=https://elmorenajecuts.com/api/auth/google/callback`.
- `ADMIN_GOOGLE_EMAIL=web.elmorenajecuts@gmail.com`.
- Completar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`
  (32 bytes aleatorios en base64) y `EMAIL_ENABLED=true` desde el panel privado.
  Conservar la clave de cifrado entre despliegues.
- `DATA_DIR` debe apuntar a una carpeta privada y escribible que sobreviva a los
  despliegues. Una ruta propuesta para esta cuenta es
  `/home/u435797455/elmorenaje-data`; comprobar su acceso desde el proceso Node y
  su persistencia tras un nuevo despliegue. El servidor crea `live/appointments.sqlite`
  dentro de ella. No es una URL pública. Si hay datos existentes, respaldarlos y
  migrarlos antes de cambiar de directorio.

## Comprobación y diagnóstico

1. `/api/health` debe responder JSON con `ok: true` y `mode: "setup"`.
2. `/admin` debe servir la pantalla de acceso y `/api/session` debe responder JSON.
3. Autorizar la cuenta del negocio y asignar los cuatro calendarios desde el portal.
4. Comprobar que la configuración permanece después de volver a desplegar.

Un registro de compilación que termina en "Deployment completed" no comprueba
que el servidor haya arrancado. Ante un 503, consultar los registros de ejecución
en el panel o `domains/elmorenajecuts.com/hbuilds/current/nodejs/stderr.log`.

`ERR_REQUIRE_ASYNC_MODULE` indica que un cargador intentó usar `require()` sobre
un módulo ESM con top-level await; `app.cjs` evita ese modo de carga. Esto no
demuestra por sí solo que sea la causa de un 503 concreto: revisar el registro.
`EACCES` o `EPERM` requiere revisar el acceso a `DATA_DIR`. No cambiar a otra base
vacía ni ampliar permisos indiscriminadamente para ocultar el problema.

Antes de habilitar reservas reales también deben verificarse las tareas
programadas, el correo y la sincronización con Calendar.

## Disparador de tareas programadas

El servidor mantiene los ciclos de trabajo mientras está activo. Configurar
también un cron externo cada minuto permite despertarlo y recuperar ciclos tras
interrupciones del proceso. Ambos caminos comparten las tareas en curso para
evitar ejecuciones simultáneas del mismo trabajo dentro del servidor.

1. Publicar la versión que incluye `scripts/run-scheduled.mjs`.
2. Generar una clave nueva en la terminal local y guardarla solo en Hostinger como
   `CRON_SECRET`. No reutilizar `TOKEN_ENCRYPTION_KEY`:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Aplicar las variables y reiniciar la aplicación. Una clave ausente o mal formada
   deshabilita el disparador, pero no impide arrancar el sitio.
4. En **Avanzado → Cron Jobs**, configurar cada minuto (`* * * * *`) con este comando
   de 203 caracteres, sin agregar de nuevo el ejecutable si el panel ya lo prefija:

   ```sh
   /opt/alt/alt-nodejs24/root/bin/node --env-file=/home/u435797455/domains/elmorenajecuts.com/hbuilds/config/.env /home/u435797455/domains/elmorenajecuts.com/hbuilds/current/nodejs/scripts/run-scheduled.mjs
   ```

   Comprobar que esas rutas existen en esta cuenta. Si Hostinger utiliza otra
   carpeta para el dominio, ajustar las dos rutas al directorio real.
5. Revisar la salida del cron en `.logs` o **Ver salida**: debe indicar
   `Iniciando ciclo de tareas.` y `Ciclo de tareas completado.`
   En modo `setup`, Calendar y los envíos siguen suspendidos; este resultado
   comprueba el disparador, no la entrega de correo ni el acceso a cada calendario.

Si Node muestra su versión y las rutas del archivo de entorno y del script existen,
pero el cron no imprime nada, comprobar la versión del cliente. La entrada resuelve
las rutas reales antes de compararlas, para admitir el enlace `hbuilds/current`.
Los errores controlados aparecen como `ERROR: ...` en la salida del cron, con código
de salida distinto de cero y sin incluir valores de configuración privados.

El cliente hace un POST a `/api/internal/jobs` con la clave en la cabecera
Authorization, nunca en la URL. No abre SQLite, no solicita una sesión de usuario
y no imprime claves, tokens, cuerpos de error ni datos de clientes. No sigue
redirecciones y utiliza HTTPS, salvo en pruebas locales.

El cron de Hostinger no hereda las variables de la web: el comando usa el archivo
de configuración privado del proveedor. No subir ese archivo al repositorio.
La frecuencia de un minuto no equivale a una garantía de ejecución en un segundo
exacto; los ciclos internos se ejecutan con mayor frecuencia mientras el proceso
está activo. Comprobar el vencimiento de solicitudes y los recordatorios antes
de dar por validada la operación real.

Referencia: [cron para Node.js en Hostinger](https://www.hostinger.com/support/how-to-run-cron-jobs-for-node-js-websites-at-hostinger/).
