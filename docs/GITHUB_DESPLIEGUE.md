# GitHub y despliegue en GoDaddy

Repositorio actual: [cerjattin/BarberShop](https://github.com/cerjattin/BarberShop), rama de desarrollo `main`.

## Recuperación sin soporte — 20 de noviembre de 2026

La aplicación GoDaddy `sgjoj7c7yh` tiene dos fallos observados: el arranque con `pnpm-native` devuelve `EACCES` y la actualización de GitHub encuentra un `package-lock.json` no rastreado que impide el merge. Su administrador de archivos es de solo lectura; no permite corregir ese checkout desde el panel.

La alternativa preparada es importar **una aplicación nueva** desde el ZIP `.release/elmorenaje-godaddy-npm-2026-11-20.zip`. Esto evita reutilizar el checkout y los comandos generados de la aplicación anterior. No borrar la aplicación anterior para probar esta vía.

1. En Mis aplicaciones, crear una aplicación Node.js mediante carga ZIP. Seleccionar el ZIP completo, sin descomprimirlo ni añadir una carpeta contenedora. Si aparece un cobro o un cambio de plan, detenerse y comprobarlo antes de aceptar.
2. El paquete contiene la web ya compilada, un `package-lock.json` de npm sin dependencias y `.npmrc` con el registro público. No contiene `pnpm-lock.yaml`, Vite ni `node_modules`. El perfil de `build` verifica archivos y `start` ejecuta `node scripts/start-release.mjs`.
3. Esperar a que la vista previa responda en `/api/health` y en `/`. Si los registros todavía indican `pnpm start`, la plataforma no está usando este perfil; no declarar el despliegue válido.
4. Configurar las variables **en la aplicación nueva**, porque no se heredan: `APP_MODE=setup`, `HOST=0.0.0.0`, `APP_ORIGIN=https://elmorenajecuts.com`. La vista previa usa su propio origen HTTPS si se necesita probar autenticación allí. Conservar `PORT` asignado por GoDaddy.
5. El panel identifica `/private` como almacenamiento privado persistente. Para la nueva instalación, configurar `DATA_DIR=/private/elmorenajecuts`. Antes de activar reservas, comprobar escritura y persistencia de SQLite y medios tras reinicio y nueva publicación. Esta ruta no migra datos de la aplicación anterior.
6. Publicar y vincular el dominio solo cuando el arranque de la nueva aplicación esté comprobado. La autenticación Google, los correos y las reservas reales requieren su validación independiente.

El ZIP no incorpora `.airo/config.json`: se permite únicamente ese archivo regular de metadatos si GoDaddy lo genera al importar. No se ejecuta pnpm desde ningún script incluido. El funcionamiento real en GoDaddy debe verificarse después de la importación; las pruebas locales no acreditan el alojamiento.

## Perfil anterior de distribución

- `main`: fuente React/Vite, servidor, pruebas, documentación, configuración pública y fotografías optimizadas. Desarrollo y cambios de contenido se hacen aquí.
- `deploy/godaddy`: perfil de distribución usado anteriormente en el repositorio sustituido. No seleccionar esta rama en el repositorio actual sin generarla y verificarla allí. La recuperación actual utiliza el ZIP indicado arriba.

El perfil separado evita depender de que GoDaddy instale Vite y Tailwind desde `devDependencies` durante la compilación. Los [requisitos de GoDaddy](https://developer.godaddy.com/en/docs/api-users/hosting/app-requirements) indican que instala las dependencias de producción antes de ejecutar `build` y `start`.

Las ramas tienen historiales separados. La distribución se genera desde un commit validado de `main`; su mensaje registra ese commit. No editar archivos directamente en `deploy/godaddy`: cambiar `main`, verificar, recompilar y generar otra distribución con `npm run package:release -- --destination DIRECTORIO_NUEVO`, según [PAQUETE_PUBLICACION.md](PAQUETE_PUBLICACION.md). La rama de distribución no se actualiza automáticamente al cambiar `main`.

## Conectar el alojamiento

Cuando el panel de Hosting Deluxe confirme Node.js Hosting:

1. Conectar la cuenta GitHub propietaria y conceder a GoDaddy acceso únicamente al repositorio del proyecto.
2. Seleccionar `cerjattin/BarberShop` y una rama de distribución previamente generada y verificada; para la recuperación actual, usar la carga ZIP en una aplicación nueva.
3. Configurar `npm run build` y `npm start`. La compilación de esta rama verifica el manifiesto; React ya está compilado. Requiere Node 22.13 o posterior con `node:sqlite`.
4. Mantener `APP_MODE=setup`. El proceso respeta el `PORT` de la plataforma y escucha en `0.0.0.0` por defecto.
5. Configurar el dominio/origen HTTPS, callback OAuth y variables privadas en el alojamiento; nunca añadirlas al repositorio. Definir `DATA_DIR` en una ruta privada persistente que conserve SQLite, WAL, sesiones, trabajos y fotos subidas entre reinicios y despliegues.
6. Comprobar una sola instancia continua y ejecutar los casos reales de [VALIDACION_REAL.md](VALIDACION_REAL.md) antes de activar reservas.

La subida a GitHub no publica la web ni configura DNS, Google, correo o persistencia de GoDaddy. El dominio confirmado es `elmorenajecuts.com`; el panel confirma Node.js 22 y un lugar usado de los diez del plan Deluxe. El funcionamiento y la persistencia de la nueva aplicación siguen sujetos a comprobación.

## Archivos excluidos

`.env` y credenciales descargadas de Google, bases SQLite, sesiones, tokens, respaldos, datos privados, originales fotográficos, video, dependencias instaladas y entregas ZIP permanecen fuera del repositorio. Solo `.env.example`, sin valores privados, documenta las variables necesarias. Las 31 fotografías optimizadas y el logotipo sí forman parte del proyecto; no dependen de Git LFS.

La configuración local de Git usa el correo `noreply` de la cuenta para evitar publicar el correo personal como autor de los commits. Los originales se conservan en el equipo y requieren una copia de custodia independiente de GitHub.
