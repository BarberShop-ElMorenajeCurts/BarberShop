# C6 — preparación para GoDaddy Hosting Deluxe

Actualización del 19 de noviembre de 2026: el propietario confirma la compra de **GoDaddy Hosting Deluxe**. El nombre de dominio todavía no se ha indicado. La compra no acredita las capacidades del entorno: el acceso a Node.js, la persistencia privada de SQLite/fotos y la ejecución continua siguen por comprobar en la cuenta. No se ha conectado ni desplegado la aplicación.

## Compatibilidad documentada

GoDaddy anuncia Node.js Hosting incluido en nuevos planes elegibles, entre ellos Deluxe, y un proceso Node 22 persistente. Esto permite mantener GoDaddy como objetivo de alojamiento, pendiente de comprobar el producto disponible en la cuenta y región elegidas. [Anuncio oficial](https://www.godaddy.com/resources/news/godaddy-nodejs-hosting-launch).

El contrato técnico de despliegue exige `package.json`, scripts `build` y `start`, escuchar el `PORT` asignado y disponer de las dependencias necesarias. Su documentación indica instalación de dependencias de producción antes de compilar. [Requisitos oficiales](https://developer.godaddy.com/en/docs/api-users/hosting/app-requirements).

Una guía de GoDaddy menciona `public/assets` para archivos que deben sobrevivir despliegues. Esa indicación no demuestra por sí sola la existencia de una ruta persistente **privada** apta para la base SQLite. No colocar la base, sesiones, tokens, respaldos ni `.env` en una carpeta que pueda servirse públicamente. [Guía de persistencia de archivos](https://www.godaddy.com/en-ca/help/deploy-my-loveable-app-with-godaddy-nodejs-hosting-42981).

## Ajustes y comprobaciones antes del despliegue

| Área | Situación del proyecto | Trabajo de C6 |
| --- | --- | --- |
| Modalidad del producto | Aplicación Node con API y frontend compilado. | Confirmar acceso a Node.js Hosting dentro del plan elegido; no limitarse a subir archivos a un hosting estático/PHP. |
| Versión | Requiere Node 22.13 o posterior y `node:sqlite`. | Comprobar versión exacta y disponibilidad del módulo en el entorno real. |
| Arranque | Ya existe `npm start`; usa `PORT`. El host predeterminado es local. | Configurar `HOST=0.0.0.0` si la plataforma requiere una interfaz accesible y verificar tráfico HTTPS hacia el puerto asignado. |
| Compilación | Vite/Tailwind y sus plugins están en `devDependencies`. | Preparar y probar un perfil de instalación/paquete compatible con la compilación de GoDaddy. La distribución actual de dependencias necesita revisión antes de subirla. |
| Persistencia | SQLite y fotos bajo `DATA_DIR`, fuera de `dist`. | Confirmar ruta privada que conserve base, WAL, sesiones, trabajos y fotos tras reinicios y republicaciones; probar restauración. |
| Trabajos | Un proceso ejecuta confirmaciones y recordatorios. | Verificar ejecución continua y una sola instancia; comprobar recuperación después de reiniciar. |
| Secretos | Variables de entorno y tokens cifrados. | Cargar valores en configuración privada de la plataforma y mantener estable la clave; no incluir `.env` en el ZIP. |
| Dominio/OAuth | Dominio pendiente. | Definir `APP_ORIGIN` HTTPS y callback Google exacto del entorno; separar datos/calendarios de validación. |

Si la ruta privada persistente no está disponible, C6 debe proponer una adaptación de almacenamiento y medir su alcance antes de cambiar la base actual. El soporte genérico de Node no equivale a certificar toda la aplicación.

## Preguntas concretas para confirmar en el producto o con soporte

1. ¿El Hosting Deluxe comprado incluye Node.js Hosting en esta cuenta y región?
2. ¿Qué versión exacta de Node ejecuta y permite importar `node:sqlite`?
3. ¿Existe una ruta de datos persistente no pública, con soporte de SQLite/WAL y conservación entre despliegues? ¿Cómo se respalda y recupera?
4. ¿Se mantiene un único proceso activo sin visitas y sin suspensión por inactividad? ¿Se puede controlar o conocer el número de instancias?
5. ¿Qué instalación de dependencias, límites de recursos y mecanismos de secretos/registro aplica al plan concreto?

## Secuencia de C6, C7 y C8

Primero confirmar esas condiciones y el dominio; luego preparar el paquete de despliegue y un entorno de prueba con datos separados. Verificar persistencia, arranque y recuperación antes de autorizar la cuenta Google en ese entorno. Ejecutar C7 y solo después publicar C8 con datos comerciales definitivos.

Estado al 19 de noviembre: Hosting Deluxe comprado por el propietario; compatibilidad general Node documentada. Persistencia privada, disponibilidad concreta de Node.js Hosting, versión exacta, acceso/configuración del entorno, dominio y prueba de despliegue pendientes. No se ha modificado la arquitectura ni desplegado la aplicación.
