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
