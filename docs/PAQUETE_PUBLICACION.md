# C6 — paquete local de publicación precompilado

La herramienta prepara una **carpeta nueva** para subir posteriormente a GoDaddy Node.js Hosting. No instala paquetes, no comprime archivos, no conecta cuentas y no publica la aplicación. Mantiene intactos el proyecto, su configuración privada y sus datos.

## Por qué tiene un perfil separado

El proyecto de desarrollo compila con Vite y Tailwind desde `devDependencies`. La documentación de GoDaddy indica que su flujo instala dependencias de producción antes de compilar. Para no depender de esa instalación, este perfil incluye el frontend **ya compilado** y un servidor Node nativo, sin dependencias externas. El script `build` del paquete verifica sus archivos; no vuelve a compilar React.

Referencia: [requisitos oficiales de aplicaciones Node.js](https://developer.godaddy.com/en/docs/api-users/hosting/app-requirements). La disponibilidad y las condiciones concretas del plan se comprueban antes del despliegue; ver [ALOJAMIENTO_GODADDY.md](ALOJAMIENTO_GODADDY.md).

## Preparar una carpeta de salida

Primero completar cambios en código y datos públicos y compilar:

```powershell
npm run check
npm run build
```

Crear un directorio padre para las entregas, si todavía no existe. El ejemplo usa `.release`, excluido del repositorio por la coordinación. El destino de cada entrega **no puede existir**:

```powershell
New-Item -ItemType Directory -Path '.release' -Force
node scripts/package-release.mjs --destination '.release/godaddy-2026-11-17'
```

También se puede usar `npm run package:release -- --destination 'DIRECTORIO_NUEVO'` cuando el alias esté integrado. `--project 'RAIZ_PROYECTO'` permite seleccionar otra fuente explícita. No hay destino implícito ni opción `--force`; el padre debe existir. Para repetir una entrega, usar otro nombre nuevo.

La herramienta rechaza destinos que ya existen, el proyecto o sus antecesores, salidas dentro de `dist`, `server`, `scripts` o `config`, rutas de red, segmentos `..`, enlaces simbólicos y uniones. Reserva exclusivamente la salida para no reemplazar una carpeta creada por otra operación. Valida primero un staging propio y solo informa éxito tras verificar la salida completa. Si falla, limpia únicamente sus directorios creados y marcados; no elimina directorios del usuario.

No ejecutar dos compilaciones o cambios de fuente mientras se empaqueta. Se comparan huellas antes y después de copiar; una fuente que cambie se rechaza cuando se detecta. Esto no sustituye el control de acceso del sistema de archivos frente a modificaciones hostiles concurrentes.

## Contenido de la entrega

```text
package.json
release-manifest.json
config/business.public.json
config/photography.public.json
dist/
server/                    módulos runtime .mjs, sin pruebas
scripts/start-release.mjs
scripts/verify-release.mjs
```

Se copia solo esa selección: no se lee ni se copia `.env`, `.data`, `.backups`, bases de datos, fotografías cargadas en el portal, `node_modules`, documentación ni pruebas. Las imágenes estáticas y el logo que forman parte de `dist` sí pertenecen a la entrega. La configuración comercial pública se copia porque el servidor la necesita al arrancar; debe contener únicamente datos destinados a publicarse, nunca calendarios privados o credenciales.

La entrega del 19 de noviembre también incluye las 31 fotografías propias optimizadas bajo `dist/assets/photos` y su manifiesto público. El empaquetador comprueba que cada URL declarada tenga un archivo estático en `dist`. No incluye los originales ni el video conservados fuera de `dist`. El ZIP actual es `.release/elmorenaje-fotos-2026-11-19.zip`; reemplaza a la entrega anterior.

El manifiesto registra tamaño y SHA-256 de cada archivo controlado. El verificador comprueba rutas, inventario, hashes y el contrato de `package.json`. Detecta cambios accidentales y archivos no declarados; **no es una firma digital** ni certifica la seguridad del contenido de código de una fuente no confiable. Los archivos generados por una instalación de npm (`package-lock.json` y `node_modules`) no forman parte del inventario del artefacto original.

## Comprobación independiente

Desde la raíz de la carpeta generada:

```powershell
npm run build
```

Funciona sin instalar Vite, React ni otras dependencias: todos los recursos del navegador están en `dist`, y el servidor usa módulos nativos. Cambiar un archivo del paquete invalida sus hashes; corregir en el proyecto, recompilar y generar otra entrega.

El `package.json` generado define:

- `main`: `server/index.mjs`.
- Node mínimo: 22.13, con disponibilidad de `node:sqlite` comprobada al arrancar.
- `build`: `node scripts/verify-release.mjs`.
- `start`: `node scripts/start-release.mjs`.
- Dependencias externas: ninguna.

El arranque conserva `PORT` asignado por el alojamiento. Si no se define `HOST`, usa `0.0.0.0`; si no se define `APP_MODE`, permanece en `setup`. Verifica los archivos antes de iniciar el servidor y cierra su proceso de forma controlada ante SIGINT/SIGTERM. No carga un `.env` incluido: los valores reales se proporcionan por el entorno privado de la plataforma.

Para una prueba local de arranque, definir las variables en el entorno y ejecutar `npm start`. Desde el proyecto también se puede ejecutar `npm run test:release -- --directory 'DIRECTORIO_DEL_PAQUETE'`: arranca el paquete en modo `setup` con puerto efímero y datos temporales separados, comprueba la web, el catálogo y la protección administrativa y detiene su proceso. No utiliza la base del negocio ni conecta Google.

## Subirlo posteriormente

Comprimir **el contenido de la carpeta**, con `package.json` en la raíz del ZIP, sin una carpeta contenedora extra. La compresión y la subida quedan fuera de la herramienta local actual. No añadir `.env`, bases o respaldos al ZIP. El coordinador ya preparó y verificó `.release/elmorenaje-godaddy-2026-11-17.zip`; la subida espera confirmar plataforma y persistencia.

Configurar en el alojamiento `APP_ORIGIN`, callback OAuth, identidad administrativa, clave estable y demás secretos según [SERVIDOR.md](SERVIDOR.md) y [CONEXION_GOOGLE.md](CONEXION_GOOGLE.md). Usar una ruta privada persistente para `DATA_DIR`, separada de los archivos de la entrega. La opción `.data` local se tolera al reiniciar el paquete, pero no acredita persistencia en GoDaddy ni debe incorporarse a una subida posterior.

El paquete no certifica:

- La cuenta y permisos efectivos de Google/Gmail.
- La disponibilidad exacta de Node en la cuenta comprada ni una ruta privada con SQLite/WAL persistente.
- La ejecución continua y el número de instancias del alojamiento.
- El dominio/HTTPS, la entrega de correos o las esperas reales de confirmación y recordatorios.

Esas comprobaciones corresponden a C4 real, C6 y [C7](VALIDACION_REAL.md), antes de publicar C8.

## Pruebas de esta herramienta

`scripts/tests/release.test.mjs` usa fuentes y salidas temporales. Comprueba la selección de archivos, el perfil independiente, la verificación CLI, integridad, rutas, destinos existentes, recuperación tras fallo de staging, dependencias externas y enlaces. Las pruebas no leen el `.env` del proyecto, datos del negocio ni servicios externos. Algunos sandboxes de Windows impiden crear los enlaces usados en una prueba; esa prueba se marca como omitida en ese caso y puede ejecutarse con permisos locales adecuados.
