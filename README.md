# ElMorenaje Cuts

Web React + Vite + Tailwind, portal administrativo y API Node para una barbería en Curaçao.

## Documentación y equipo

- [Alcance acordado](docs/ALCANCE.md)
- [Asignaciones, dependencias y contrato de API](docs/CONTRATOS.md)
- [Etapa 2: preparación y contratos C4–C8](docs/ETAPA_2.md)
- [Protocolo de validación real C7](docs/VALIDACION_REAL.md)
- [Datos comerciales pendientes C5](docs/DATOS_NEGOCIO.md)
- [Preparación de alojamiento GoDaddy Deluxe](docs/ALOJAMIENTO_GODADDY.md)
- [Respaldo y restauración C6](docs/OPERACION.md)
- [Paquete de publicación precompilado](docs/PAQUETE_PUBLICACION.md)
- [Servidor e integración Google](docs/SERVIDOR.md)
- [Administración y demostración sin Google](docs/ADMINISTRACION.md)
- [Fotografías propias y originales](assets/photography/README.md)
- [GitHub y rama para despliegue en GoDaddy](docs/GITHUB_DESPLIEGUE.md)

El diseño y el logo existentes se conservan. El propietario confirmó el catálogo inicial de cinco servicios, precios en ANG, duración de 30 minutos, cuatro barberos, horario de lunes a sábado 09:00–21:00 y contactos. Son editables desde el portal. Las 31 fotografías propias ya están incorporadas. Dirección exacta y configuración real de Google/alojamiento siguen pendientes; los datos aislados del modo demo no son una oferta comercial.

## Entorno local

Requiere Node 22.13 o posterior y pnpm. Este comando usa un almacén dentro de `.cache/` y copias para facilitar su uso en Windows.

```text
pnpm install --frozen-lockfile --store-dir .cache/pnpm --node-linker=hoisted --package-import-method=copy
pnpm dev:api
```

El servidor de Vite del proyecto utiliza el puerto 8443. Si el entorno ya lo mantiene abierto, se reutiliza; para un checkout sin servidor se inicia con `pnpm dev`. Vite dirige `/api` y `/media` a la API en el puerto 3001. La web está en `/` y el portal en `/admin`.

### Demostración local

Para revisar directamente el portal con los cuatro barberos y el catálogo confirmado, sin configurar Google:

```text
npm run preview:admin
```

Sirve la web compilada en `http://localhost:8444/admin`; selecciona «Explorar el portal de demostración». Conserva sus datos de prueba separados en `.data/admin-preview/demo`. No carga `.env`, no conecta Google y no envía correos. Ctrl+C detiene el servicio. El [manual administrativo](docs/ADMINISTRACION.md) describe los módulos y el guardado.

La demostración técnica anterior para desarrollar con Vite continúa disponible:

```text
pnpm dev:api:demo
```

Este modo usa datos separados y no crea eventos ni envía correos reales. El acceso administrativo de prueba solo está disponible en la demostración local explícita. La interfaz indica el modo activo. Detener la API antes de cambiar de modo; no ejecutar dos instancias sobre la misma base de datos.

### Configuración real

Copiar `.env.example` a `.env` y completar los valores siguiendo `docs/SERVIDOR.md`. El archivo `.env` y `.data/` están excluidos del repositorio. Usar una cuenta personal de Google autorizada para administrar el negocio. No compartir la contraseña de Google ni incluir credenciales en el código frontend.

Antes de habilitar reservas reales hay que conectar Google, asociar cada barbero con su calendario, confirmar servicios y horarios y configurar los correos. Si falta esa configuración, la aplicación debe mantener las reservas deshabilitadas o informar el error; nunca simular una confirmación real.

## Verificación

```text
pnpm check
pnpm test
pnpm build
```

Los mismos scripts están disponibles con `npm run check`, `npm test` y `npm run build`. `npm run test:smoke` comprueba la API HTTP local de demostración ya iniciada; se niega a modificar una instancia real.

Las pruebas automatizadas usan adaptadores de prueba y no envían comunicaciones reales. La integración con la cuenta Google y la entrega de correo reales se verifican después de configurar las credenciales del negocio.

## Comprobar configuración y preparar la operación

```text
npm run check:config
npm run check:config:live
```

El diagnóstico es offline y no muestra secretos. El primero admite la preparación local y enumera pendientes; el segundo falla intencionalmente mientras no estén completos los requisitos del modo real. Ninguno certifica la conexión efectiva a Google ni la entrega de Gmail.

Los comandos `npm run backup` y `npm run restore` requieren rutas explícitas, un destino nuevo y la opción `--offline` después de detener la API. Véase [OPERACION.md](docs/OPERACION.md). Nunca se restaura sobrescribiendo la base actual por defecto.

`npm run package:release -- --destination ".release/mi-version"` prepara una distribución con `dist` ya compilado y el servidor, sin datos ni credenciales. Ejecutar `npm run build` antes y seguir [PAQUETE_PUBLICACION.md](docs/PAQUETE_PUBLICACION.md). Generar el paquete no lo publica ni comprueba las condiciones del alojamiento.

Para probar el arranque HTTP de un paquete generado: `npm run test:release -- --directory ".release/mi-version"`. Usa modo `setup`, un puerto efímero y datos temporales externos al paquete; no conecta Google ni envía correos.

## Operación

```text
pnpm build
pnpm start
```

La API sirve el resultado compilado y las fotografías. El propietario confirmó el 19 de noviembre de 2026 la compra de GoDaddy Hosting Deluxe. El dominio no se ha indicado y todavía deben comprobarse Node.js Hosting, `node:sqlite`, almacenamiento privado persistente y ejecución continua en el plan concreto; la aplicación no está desplegada. Esta base requiere una instancia Node con disco persistente para SQLite, fotografías y trabajos pendientes, HTTPS y ejecución continua para la confirmación automática y los recordatorios. No desplegar esta configuración en un alojamiento puramente estático ni en discos efímeros. Planificar copias de seguridad antes de producción.

Reglas: más de dos horas de anticipación online; solicitudes que retienen horario y se confirman automáticamente tras dos horas si no son rechazadas; cambios del cliente a través del administrador; recordatorio por correo 24 horas antes; sincronización de cambios realizados desde Calendar.
