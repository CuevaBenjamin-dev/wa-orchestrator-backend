# Catálogo IPDE y almacenamiento persistente

## Propósito

El módulo `CatalogModule` administra materias comerciales de IPDE sin depender de PostgreSQL, WhatsApp u OpenAI. Carga una fuente manual versionada y entradas generadas persistentes, valida ambas con Zod y ofrece búsqueda exacta mediante `CatalogService`.

El tenant se identifica por el código estable `IPDE`; el nombre visible de la institución no participa en la resolución.

## Fuentes y prioridad

El orden de consulta es invariable:

1. Catálogo manual versionado en Git.
2. Catálogo generado guardado en el directorio persistente.
3. Una consulta sin coincidencia devuelve `null`; este bloque no genera contenido.

Una entrada generada no puede usar el mismo identificador, nombre normalizado o alias de una entrada manual. El repositorio también rechaza colisiones entre entradas generadas.

## Catálogo manual

La ruta predeterminada es `config/ipde/catalog.manual.json`. El archivo contiene:

```json
{
  "schemaVersion": 1,
  "tenantCode": "IPDE",
  "subjects": []
}
```

Puede comenzar vacío. Se lee una vez durante el arranque, se valida por completo y se indexa en memoria. Un error de lectura, sintaxis o esquema produce `ManualCatalogInvalidError` e impide inicializar el módulo, porque la fuente manual es autoritativa. El módulo nunca escribe este archivo.

El archivo [catalog.manual.example.json](../../config/ipde/catalog.manual.example.json) contiene una materia totalmente ficticia con 25 temas y sirve como ejemplo válido; no representa la oferta comercial real de IPDE.

## Catálogo generado

Cada materia generada ocupa un archivo independiente:

```text
<persistent-data-dir>/<generated-subdir>/<normalized-subject>.json
```

Por ejemplo, `materia generada demostrativa` corresponde a `materia-generada-demostrativa.json`. El archivo contiene una sola `SubjectCatalogEntry` con `source: "OPENAI_GENERATED"`. El ejemplo [catalog.generated.example.json](../../config/ipde/catalog.generated.example.json) muestra el formato completo y usa únicamente datos ficticios.

Los archivos se cargan e indexan durante el arranque. No existen watchers. Los nombres visibles, nombres normalizados y alias se comparan de forma exacta después de aplicar el normalizador oficial; no hay fuzzy search.

## Validación

Los esquemas están centralizados en `src/catalog/domain/catalog.schemas.ts`. Entre otras reglas, exigen:

- `schemaVersion: 1` y `tenantCode: "IPDE"`;
- categorías y tipos de producto pertenecientes a las listas centralizadas;
- identificadores estables en mayúsculas y guiones bajos;
- nombre normalizado idéntico al resultado del normalizador oficial;
- al menos un tipo de producto, sin duplicados;
- exactamente 25 temas, todos activos;
- identificadores, nombres y alias sin colisiones normalizadas;
- fechas ISO-8601 y versión entera mayor o igual a uno;
- `MANUAL` en la fuente manual y `OPENAI_GENERATED` en disco persistente;
- rechazo de campos desconocidos, incluidos precios, promociones o rutas de documentos.

La normalización convierte a minúsculas, elimina marcas diacríticas, puntuación no significativa y espacios redundantes, y conserva letras y números. No traduce ni expande siglas.

## Estructura

```text
src/catalog/
├── catalog.module.ts
├── catalog.service.ts
├── domain/
│   ├── catalog.errors.ts
│   ├── catalog.schemas.ts
│   └── catalog.types.ts
├── repositories/
│   ├── catalog-index.ts
│   ├── catalog.repository.ts
│   ├── generated-catalog.repository.ts
│   └── manual-catalog.repository.ts
├── storage/
│   ├── atomic-json-file.service.ts
│   ├── catalog-paths.service.ts
│   └── persistent-storage.service.ts
└── utils/
    ├── catalog-file-name.ts
    ├── is-final-catalog-json-file.ts
    └── normalize-catalog-text.ts

config/ipde/
├── catalog.manual.json
├── catalog.manual.example.json
└── catalog.generated.example.json

data/
└── .gitkeep

scripts/
└── validate-ipde-catalog.ts
```

## Variables de entorno

| Variable                        | Valor predeterminado                | Función                                                                    |
| ------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `IPDE_TENANT_CODE`              | `IPDE`                              | Código estable; cualquier otro valor se rechaza.                           |
| `IPDE_MANUAL_CATALOG_PATH`      | `./config/ipde/catalog.manual.json` | Archivo manual de solo lectura.                                            |
| `PERSISTENT_DATA_DIR`           | no definido                         | Override explícito del directorio persistente.                             |
| `RAILWAY_VOLUME_MOUNT_PATH`     | no definido                         | Punto de montaje provisto por Railway cuando no existe override explícito. |
| `IPDE_GENERATED_CATALOG_SUBDIR` | `generated-catalog`                 | Subdirectorio relativo para entradas generadas.                            |

La resolución del directorio persistente es:

1. `PERSISTENT_DATA_DIR` cuando está definida explícitamente.
2. `RAILWAY_VOLUME_MOUNT_PATH` cuando existe y no hay override.
3. `path.resolve(process.cwd(), 'data')` como fallback local.

Las variables nuevas se validan al resolverlas: no pueden estar vacías, el código debe ser `IPDE` y el subdirectorio generado no puede ser absoluto ni escapar mediante path traversal.

## Comportamiento local

Sin variables adicionales, la aplicación usa `./data/generated-catalog`. `data/*` está ignorado por Git salvo `data/.gitkeep`. Al inicializar, el módulo crea los directorios de ejecución que falten.

Para probar persistencia sin endpoints:

1. Resolver `CatalogService` desde un contexto Nest o una prueba controlada.
2. Llamar `saveGenerated(entry)` con una entrada válida de 25 temas y fuente `OPENAI_GENERATED`.
3. Cerrar y recrear el contexto o las instancias de repositorio.
4. Ejecutar la inicialización y recuperar mediante `getById` o `findExact`.

Las pruebas automatizadas reproducen este ciclo en directorios temporales, nunca en `data/`.

## Comportamiento esperado en Railway

Se debe montar un Railway Volume y exponer su ruta mediante `RAILWAY_VOLUME_MOUNT_PATH`. Si se configura también `PERSISTENT_DATA_DIR`, este actúa como override explícito. No existe una ruta `/app/data` hardcodeada.

El volumen se usa solo en runtime. Build y pre-deploy no deben iniciar el módulo ni escribir archivos persistentes.

## Inicialización

`CatalogService.onModuleInit` ejecuta en orden:

1. Validación de configuración y resolución de rutas.
2. Lectura y validación completa del catálogo manual.
3. Creación de los directorios generado y `quarantine`.
4. Lectura, validación y posible cuarentena de cada JSON generado.
5. Construcción de índices en memoria.
6. Logs resumidos de cantidad manual, cantidad generada, archivos puestos en cuarentena y ruta persistente.

Los logs no incluyen el contenido del catálogo ni secretos.

## Cuarentena

Un archivo generado con JSON corrupto, esquema inválido, nombre incoherente o colisión no impide iniciar el servicio. Se registra un error estructurado con nombre de archivo y rutas de campos, y se mueve sin pérdida a:

```text
<generated-subdir>/quarantine/
```

Los temporales y backups no se consideran entradas finales. Un fallo general al crear o listar el almacenamiento sigue siendo un error de infraestructura y se representa con `PersistentStorageUnavailableError`.

## Escritura atómica y concurrencia

`AtomicJsonFileService` es el único escritor JSON del módulo:

1. Valida el objeto en memoria con Zod.
2. Serializa el JSON completo.
3. Crea un temporal único en el mismo directorio.
4. Escribe UTF-8, sincroniza y cierra el descriptor.
5. Renombra al destino. En Windows utiliza un backup temporal para reemplazos que no admiten rename directo.
6. Restaura o limpia temporales ante errores.

Nunca escribe contenido parcial sobre el archivo definitivo. `GeneratedCatalogRepository` mantiene una cola en memoria por nombre normalizado para serializar dos escrituras simultáneas de la misma materia.

## Comando de validación

```bash
npm run catalog:validate
```

El comando carga `.env`, resuelve las mismas rutas y valida el catálogo manual y todos los JSON generados existentes. Muestra archivo, ruta de campo y mensaje; devuelve `0` cuando todo es válido y un código distinto de cero ante errores.

No inicia NestJS, no crea directorios, no mueve archivos, no se conecta a PostgreSQL, WhatsApp u OpenAI y no modifica datos.

## Limitación de una sola instancia

El lock de escritura vive en memoria, por lo que coordina únicamente procesos dentro de una instancia. Dos réplicas escribiendo al mismo volumen no están coordinadas. El diseño de este bloque asume el MVP de una sola instancia.

## Futura migración a PostgreSQL

`CatalogService` depende de un contrato `CatalogRepository` exportado mediante token. Una fase futura puede reemplazar los repositorios de archivos por PostgreSQL conservando las operaciones `findExact`, `listAll`, `getById` y `saveGenerated`. Antes de escalar a múltiples instancias se deberá adoptar coordinación transaccional o un repositorio central.

## Actualización de uso de entradas generadas

El Bloque 4 amplía la API pública con `recordGeneratedUse({ tenantCode, id })`. La operación:

- busca únicamente en el índice generado;
- nunca modifica la fuente manual;
- se serializa con el mismo lock por nombre normalizado que `saveGenerated`;
- incrementa `usageMetadata.useCount` y actualiza `lastUsedAt`;
- vuelve a validar el `SubjectCatalogEntry` completo;
- reemplaza el JSON mediante `AtomicJsonFileService`.

Si el identificador no pertenece al catálogo generado del tenant `IPDE`, devuelve `null`. El resolver comercial trata un fallo de esta métrica como recuperable y conserva la entrada ya encontrada.

## Fuera del alcance de este bloque

Este módulo no:

- llama OpenAI ni genera temas;
- se importa desde `WhatsappService` ni altera el webhook;
- implementa estados conversacionales, pedidos o cambios del lead;
- envía mensajes, imágenes o PDF;
- implementa fuzzy search, precios o promociones;
- crea endpoints HTTP;
- cambia Prisma, migraciones o la base de datos.
