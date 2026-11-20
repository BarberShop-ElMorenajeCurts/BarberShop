# Fotografías propias

El 19 de noviembre de 2026 se recibieron 31 fotografías y un video en `dist/assets`. Se copiaron sin modificar a `originals/` antes de compilar: Vite reemplaza `dist`, por lo que esa carpeta no se utiliza como fuente.

`originals/` se conserva localmente y queda excluida del repositorio y del paquete web. Incluye el video `IMG_9321.MP4`, reservado para una incorporación posterior; no se ha publicado como parte de la galería de fotografías.

Las versiones web están en `public/assets/photos/`. Para regenerarlas en Windows:

```powershell
powershell -File scripts/prepare-photography.ps1
```

El script lee únicamente los originales enumerados en `config/photography.public.json`, respeta proporciones y orientación EXIF, limita el lado mayor a 1600 píxeles y guarda JPEG con calidad 84, sin metadatos EXIF. No retoca personas ni altera el contenido de la foto. No aumenta imágenes pequeñas ni cambia los originales.

Distribución inicial: `IMG_4371.png` en portada, `IMG_6753.png` para mostrar el área de trabajo junto al equipo, y 29 fotografías de cortes en galería. Las descripciones ES/EN y el orden están en el manifiesto público. La web presenta cinco trabajos inicialmente y permite cargar los siguientes sin cambiar la composición aprobada.

El servidor inicializa las fotos una sola vez si la base todavía no contiene una publicación administrada. Después se gestionan desde `/admin`: cambiar sección, orden o descripciones, reemplazar o retirar. No se vuelven a insertar fotos retiradas al reiniciar. Los originales no se borran desde el portal.

La entrega web suma 6.886.962 bytes, frente a unos 108,6 MiB de originales fotográficos. La mayor fotografía web pesa menos de 471 KB. Conservar también los originales fuera del equipo como parte de la custodia del material del negocio.
