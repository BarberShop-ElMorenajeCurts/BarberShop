# GitHub y despliegue en GoDaddy

Repositorio: [cerjattin/elmorenaje-cuts](https://github.com/cerjattin/elmorenaje-cuts), privado.

## Ramas

- `main`: fuente React/Vite, servidor, pruebas, documentación, configuración pública y fotografías optimizadas. Desarrollo y cambios de contenido se hacen aquí.
- `deploy/godaddy`: distribución precompilada del mismo proyecto. Contiene frontend, servidor Node nativo, fotografías, manifiesto de integridad y un `package.json` sin dependencias externas. Esta es la rama preparada para conectar con GoDaddy.

El perfil separado evita depender de que GoDaddy instale Vite y Tailwind desde `devDependencies` durante la compilación. Los [requisitos de GoDaddy](https://developer.godaddy.com/en/docs/api-users/hosting/app-requirements) indican que instala las dependencias de producción antes de ejecutar `build` y `start`.

Las ramas tienen historiales separados. La distribución se genera desde un commit validado de `main`; su mensaje registra ese commit. No editar archivos directamente en `deploy/godaddy`: cambiar `main`, verificar, recompilar y generar otra distribución con `npm run package:release -- --destination DIRECTORIO_NUEVO`, según [PAQUETE_PUBLICACION.md](PAQUETE_PUBLICACION.md). La rama de distribución no se actualiza automáticamente al cambiar `main`.

## Conectar el alojamiento

Cuando el panel de Hosting Deluxe confirme Node.js Hosting:

1. Conectar la cuenta GitHub propietaria y conceder a GoDaddy acceso únicamente al repositorio del proyecto.
2. Seleccionar `cerjattin/elmorenaje-cuts`, rama `deploy/godaddy`, directorio raíz.
3. Configurar `npm run build` y `npm start`. La compilación de esta rama verifica el manifiesto; React ya está compilado. Requiere Node 22.13 o posterior con `node:sqlite`.
4. Mantener `APP_MODE=setup`. El proceso respeta el `PORT` de la plataforma y escucha en `0.0.0.0` por defecto.
5. Configurar el dominio/origen HTTPS, callback OAuth y variables privadas en el alojamiento; nunca añadirlas al repositorio. Definir `DATA_DIR` en una ruta privada persistente que conserve SQLite, WAL, sesiones, trabajos y fotos subidas entre reinicios y despliegues.
6. Comprobar una sola instancia continua y ejecutar los casos reales de [VALIDACION_REAL.md](VALIDACION_REAL.md) antes de activar reservas.

La subida a GitHub no publica la web ni configura DNS, Google, correo o persistencia de GoDaddy. El dominio y las capacidades concretas del plan siguen sujetos a comprobación.

## Archivos excluidos

`.env` y credenciales descargadas de Google, bases SQLite, sesiones, tokens, respaldos, datos privados, originales fotográficos, video, dependencias instaladas y entregas ZIP permanecen fuera del repositorio. Solo `.env.example`, sin valores privados, documenta las variables necesarias. Las 31 fotografías optimizadas y el logotipo sí forman parte del proyecto; no dependen de Git LFS.

La configuración local de Git usa el correo `noreply` de la cuenta para evitar publicar el correo personal como autor de los commits. Los originales se conservan en el equipo y requieren una copia de custodia independiente de GitHub.
