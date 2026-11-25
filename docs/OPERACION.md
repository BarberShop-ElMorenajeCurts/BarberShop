# C6 — respaldo, recuperación y operación

Actualizado: 25 de noviembre de 2026. Herramientas verificadas con datos temporales.
La instancia real está publicada en Hostinger; el respaldo y la restauración de
producción siguen pendientes de comprobación. Estado: [CIERRE_ENTREGA.md](CIERRE_ENTREGA.md).

Las herramientas usan Node nativo y `node:sqlite` (Node 22.13 o posterior). No leen `.env`, no llaman a Google y no envían correos. El servidor y sus requisitos se describen en [SERVIDOR.md](SERVIDOR.md).

## Qué se conserva

El respaldo contiene una copia SQLite consolidada, las fotografías subidas mediante el portal y referenciadas con URLs `/media/…`, y un manifiesto con tamaños, SHA-256 y recuentos. La base incluye catálogo, reservas, trabajos, sesiones, auditoría y las credenciales Google que ya estaban cifradas dentro de SQLite.

Las fotografías propias incluidas en el sitio bajo `/assets/photos/img-NNNN.jpg` pertenecen al **paquete de publicación**. Sus referencias permanecen en SQLite, pero sus archivos no se copian al respaldo de datos. El manifiesto las enumera en `bundledPhotos` como dependencias externas de ese paquete; la lista se comprueba contra `config/photography.public.json`, mediante una ruta fija de la herramienta. No se aceptan URLs arbitrarias ni rutas fuera de esa lista. La herramienta no abre ni transforma las imágenes estáticas.

`counts.photos` cuenta todos los registros de fotografías, tanto subidas como incluidas en el paquete. `files` enumera solo los archivos realmente incluidos y hasheados en la copia; `bundledPhotos` es una lista de URLs únicas, aunque una imagen se reutilice en varias secciones. Los respaldos anteriores que solo contenían subidas `/media` siguen siendo válidos sin `bundledPhotos`.

**Conservar el paquete de código/compilación correspondiente junto con el respaldo de datos**, incluida su configuración pública de fotografías y sus imágenes originales. Validar el respaldo solo comprueba que sus referencias estáticas están declaradas en el manifiesto local; no certifica que esos archivos estén incluidos, disponibles o íntegros en la copia de datos. Si una versión futura retira una URL del manifiesto, verificar o restaurar una copia que la utiliza exige el paquete correspondiente; no editar el respaldo para omitir la dependencia.

No copia `.env`, claves externas, dependencias, código, archivos de imágenes huérfanos ni otros archivos encontrados en el directorio de datos. La clave de cifrado debe conservarse por separado en un lugar privado: sin la clave original no se podrán leer los tokens restaurados. No pegarla en el chat ni incorporarla al respaldo.

El respaldo **no está cifrado en su totalidad** y contiene datos de clientes. Debe guardarse en almacenamiento privado con acceso restringido, fuera de carpetas públicas y del repositorio. SHA-256 detecta cambios respecto del manifiesto; no constituye una firma de autenticidad si alguien puede sustituir tanto los archivos como el manifiesto.

## Condiciones antes de usar los comandos

1. Detener la API y sus trabajos; no basta con cerrar el navegador. Impedir que otro proceso escriba en la misma base o cambie las imágenes mientras dura la operación.
2. Identificar el directorio de **modo** que corresponde a la instancia. Con la configuración predeterminada, los datos reales y de preparación están en `.data/live` y los de demostración en `.data/demo`. Si `DATA_DIR` se cambió, utilizar la ruta correcta sin divulgar los demás valores de configuración.
3. Elegir un destino nuevo cuyo padre ya exista, separado de la fuente. El destino no puede ser la fuente, un padre suyo ni un subdirectorio suyo.
4. Usar rutas locales literales. Se rechazan raíces de volumen, rutas UNC, segmentos `..`, enlaces simbólicos/uniones y nombres ambiguos con punto o espacio final.

`--offline` es una declaración explícita del operador de que la API está detenida; **no es un detector de procesos ni un bloqueo del servidor**. Las herramientas comparan huellas durante la copia y rechazan cambios detectados. Esa comprobación no permite prometer una captura coherente si otro proceso sigue modificando los datos: detener las escrituras es un requisito.

## Crear un respaldo

Los siguientes comandos son ejemplos para una futura instancia real. No se han ejecutado contra los datos del negocio.

Desde la carpeta del proyecto, con la API detenida:

```powershell
New-Item -ItemType Directory -Path '.backups' -Force
npm run backup -- --source ".data/live" --destination ".backups/2026-11-17-antes-publicar" --offline
```

Si es demostración, utilizar `.data/demo` como fuente y un nombre de respaldo que lo identifique. No mezclar demostración y producción.

El comando exige un destino inexistente. Lee los bytes originales y, si existe un WAL, lo recupera y consolida **solo en la copia temporal**. No abre la base original mediante SQLite ni hace checkpoint junto a ella. Verifica cabecera y esquema, `quick_check`, referencias de imágenes, firmas de formato y SHA-256 de los archivos copiados. Las referencias estáticas se validan como dependencias del paquete, sin copiar sus archivos. Un journal de recuperación pendiente se rechaza; debe recuperarse y cerrarse correctamente la instancia antes de volver a respaldar.

Solo se anuncia éxito después de comprobar también el destino final. El manifiesto está en `manifest.json`; no editarlo para hacer pasar una copia dañada. El destino puede aparecer mientras se termina de copiar: no usarlo hasta recibir el mensaje de éxito.

Al fallar, se intenta retirar únicamente los archivos creados por esa operación y sus directorios vacíos. No se borra recursivamente una ruta calculada ni se eliminan entradas desconocidas; en un fallo de permisos pueden quedar archivos temporales para revisión manual. La fuente no se sustituye ni se elimina.

## Restaurar para comprobar un respaldo

Primero mantener la API detenida. Restaurar siempre en un destino nuevo, conservando la base actual y el respaldo originales:

```powershell
New-Item -ItemType Directory -Path '.data-recuperada' -Force
npm run restore -- --source ".backups/2026-11-17-antes-publicar" --destination ".data-recuperada/live" --offline
```

El comando valida todos los archivos incluidos y el esquema antes de publicar la restauración, comprueba la copia temporal y vuelve a verificar el destino. Se niega a sobrescribir un directorio existente, incluso uno vacío. Una discrepancia de hash, subida `/media` referenciada ausente, dependencia estática no declarada o distinta a la base, archivo adicional no declarado o ruta insegura impide restaurar. Las fotos del paquete deben recuperarse desplegando su paquete correspondiente; la restauración de datos no las extrae ni las da por incluidas.

Para probar la recuperación sin ejecutar trabajos externos, configurar una instancia separada con `APP_MODE=setup` y `DATA_DIR=.data-recuperada`; el directorio de modo será `.data-recuperada/live`. No apuntar `DATA_DIR` directamente a `.../live`, pues el servidor añade ese subdirectorio. Mantener la clave de cifrado original en su configuración privada y no arrancar la instancia anterior al mismo tiempo.

Comprobar catálogo, reservas y fotografías con el responsable técnico. La instancia restaurada pasa a ser una base operativa cuando el servidor la abre: su SQLite puede cambiar y el manifiesto original deja de describir ese estado. Conservar intacto el respaldo fuente y generar una copia nueva cuando corresponda.

## Volver a operar y revertir un despliegue

El respaldo devuelve los archivos al estado de su fecha. **No deshace eventos de Google Calendar ni correos ya enviados.** Puede contener trabajos pendientes que ya se ejecutaron después de esa fecha; antes de volver a `live`, conciliar la agenda y las comunicaciones con el responsable técnico. No habilitar envíos reales únicamente porque el archivo restaurado sea íntegro.

Para una nueva versión:

1. Conservar el código o paquete de la versión anterior y una referencia de su versión, incluidas las imágenes estáticas y `config/photography.public.json` utilizados por sus referencias SQLite.
2. Detener la API y crear un respaldo nuevo verificado antes de cambiar código o datos.
3. Desplegar el paquete validado conservando el directorio privado de datos y la clave; comprobar inicio, acceso, fotografías y trabajos con el protocolo [VALIDACION_REAL.md](VALIDACION_REAL.md).
4. Si es necesario volver atrás, detener el proceso nuevo y usar el paquete anterior compatible. Si también se recuperan datos, restaurarlos en otro directorio y cambiar `DATA_DIR` de forma explícita; no copiar sobre la base anterior.
5. Revisar cambios externos ocurridos durante el intento y verificar el recorrido antes de reabrir reservas.

No restaurar una base con una versión de código de esquema incompatible. Estas herramientas comprueban el esquema esperado por la aplicación actual; no realizan migraciones de versiones ni sincronizan manualmente los sistemas de Google.

## Alojamiento y custodia

El sitio actual usa Hostinger y el dominio `elmorenajecuts.com`. La raíz privada
configurada es `/home/u435797455/elmorenaje-data`, con datos reales en `live/`.
Las instrucciones vigentes están en [HOSTINGER_DESPLIEGUE.md](HOSTINGER_DESPLIEGUE.md).
GoDaddy corresponde a una alternativa anterior y no es el alojamiento actual.

La aplicación actual requiere una sola instancia Node continuamente activa, disco persistente privado y copias fuera de ese mismo punto de fallo. Un proceso suspendido no ejecuta la confirmación de dos horas ni los recordatorios en su momento. Los trabajos se recuperan al volver a ejecutar el servidor, según las reglas documentadas, pero eso no equivale a haberlos ejecutado puntualmente durante la interrupción.

Antes de publicar, acordar quién conserva la clave, quién realiza las copias, frecuencia y retención, almacenamiento privado externo y cómo se prueba una recuperación. Repetir una restauración de prueba después de cambios de esquema o infraestructura. No hay copia remota automática, rotación ni cifrado integral de respaldos implementados en estos comandos.

## Verificación de las herramientas

```powershell
node --test scripts/tests/backup.test.mjs
```

Las pruebas usan únicamente SQLite e imágenes temporales y leen la lista pública de URLs del paquete. Cubren conservación de fuente y WAL, restauración de catálogo/reservas/fotos, mezcla de subidas e imágenes estáticas sin copiar estas últimas, dependencia estática ausente/no permitida, compatibilidad con respaldos previos, rechazo de destinos, corrupción, esquema incompleto, modo WAL no consolidado, rutas ambiguas, manifiestos inseguros y CLI explícito. La prueba de enlaces/uniones se omite si Windows no permite crearlos en el entorno de prueba; esa omisión se informa y no se presenta como una comprobación ejecutada.

Esta preparación no sustituye la restauración real de C7. No se ha probado la
recuperación de datos reales de Hostinger; no tratar las pruebas temporales como
evidencia de una copia de producción recuperable.
