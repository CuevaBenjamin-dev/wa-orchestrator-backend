# Resolución de catálogo y generación persistente IPDE

## Propósito

`IpdeCatalogResolutionService` recibe la extracción ya validada del Bloque 3 y produce una resolución comercial estructurada. No interpreta nuevamente el mensaje, no responde por WhatsApp, no modifica PostgreSQL, estados o pedidos y no calcula precios.

La capacidad vive en `src/ipde-sales/catalog-resolution`. Solo el servicio principal se exporta como nueva API de `IpdeSalesModule`; los servicios de generación, similitud, IDs, locks y selección permanecen internos.

## Arquitectura

```text
IpdeCatalogResolutionService
├── CatalogService
│   ├── catálogo manual
│   └── catálogo generado persistente
├── IpdeFuzzyCatalogMatchService
├── IpdeGenerationLockService
├── IpdeSubjectListGenerationService
│   ├── OpenAiClientService
│   └── IpdeGeneratedEntryIdService
└── IpdeTopicSelectionResolutionService
```

La resolución específica de IPDE no se incorporó a `CatalogService`, `AiService` o `WhatsappService`. `CatalogService` conserva la responsabilidad de buscar, validar y persistir entradas, y ahora también ofrece una operación acotada para registrar el uso de entradas generadas.

## Entrada

`IpdeCatalogResolutionInputSchema` exige:

- `tenantCode: "IPDE"`;
- una `IpdeMessageExtraction` completa y válida;
- hasta cinco materias por resolución;
- hasta tres listas presentadas;
- entre uno y 25 temas por lista;
- posiciones únicas entre 1 y 25;
- textos e identificadores limitados;
- objetos estrictos sin propiedades desconocidas.

El caller entrega el resultado del intérprete. Este servicio nunca vuelve a llamar a `IpdeMessageUnderstandingService`.

## Salida

El resultado estricto contiene:

- ruta `DIRECT_TOPICS`, `CATALOG_LISTS_READY`, `NEEDS_CLARIFICATION` o `NO_ACTION`;
- resolución independiente de cada materia;
- entrada de catálogo encontrada o generada;
- origen manual, generado o generado ahora;
- modo de coincidencia exacta, alias, fuzzy o generación;
- candidatos de aclaración y código de error seguro;
- temas directos normalizados;
- selecciones numéricas resueltas y no resueltas;
- llamadas OpenAI, tokens, coincidencias y latencia total.

No existe un campo de respuesta para WhatsApp.

## Algoritmo de resolución

### Ruta directa

Cuando `requestPath` es `DIRECT_TOPICS`, los nombres escritos se normalizan, se deduplican y se conservan con su texto original. No se consulta OpenAI, no se crea una materia y no se genera una lista solamente para validar el tema.

Las posiciones numéricas sí pueden resolverse contra listas que el caller indique como previamente presentadas. Una posición o referencia no resoluble cambia la ruta final a `NEEDS_CLARIFICATION` sin descartar los temas válidos.

### Ruta de catálogo

Para cada materia no ambigua:

1. Se consulta `CatalogService.findExact`.
2. El catálogo manual tiene precedencia por el contrato existente.
3. Si no hay coincidencia exacta, se ejecuta la búsqueda aproximada conservadora.
4. Si no hay coincidencia segura, se adquiere el lock por `IPDE + normalizedName`.
5. Dentro del lock se consulta nuevamente el catálogo.
6. Solo si continúa ausente se genera la entrada.
7. La salida y la entrada completa se validan.
8. Se persiste mediante `CatalogService.saveGenerated`.

Cada materia conserva su resultado. Una falla parcial no elimina las resoluciones exitosas. Como máximo tres materias se procesan concurrentemente dentro de una solicitud.

### Ruta indeterminada y siglas

`UNDETERMINED` nunca genera contenido. Las materias marcadas como sigla o que requieren aclaración tampoco entran al generador. Por ejemplo, `IVA` devuelve `AMBIGUOUS_ACRONYM` hasta contar con contexto inequívoco.

## Prioridad de fuentes

La prioridad continúa siendo:

1. manual versionado;
2. generado persistente;
3. nueva generación OpenAI.

La resolución no lee archivos directamente. Toda lectura y escritura atraviesa `CatalogService` y los repositorios del módulo Catalog.

## Coincidencia aproximada

`IpdeFuzzyCatalogMatchService` es puro y usa distancia de Levenshtein normalizada, sin dependencias nuevas ni OpenAI.

- aceptación automática: puntaje mínimo `0.92`;
- candidato de aclaración: puntaje mínimo `0.82`;
- margen mínimo contra el segundo candidato: `0.08`;
- los tokens significativos deben corresponder en ambas direcciones con similitud mínima `0.80`.

La última regla impide que una coincidencia elimine palabras como `procesal`: `Derecho Civil` no se convierte automáticamente en `Derecho Procesal Civil`. Si dos candidatos son cercanos se devuelven para aclaración, sin elegir uno.

## Generación de 25 temas

`IpdeSubjectListGenerationService` reutiliza `OpenAiClientService` y `responses.parse` con `zodTextFormat`. La salida contiene `schemaVersion`, la materia y exactamente 25 objetos con título y hasta cinco aliases.

El schema rechaza:

- 24 o 26 temas;
- nombres o aliases duplicados después de normalizar;
- aliases iguales a cualquier título;
- numeración y títulos genéricos;
- propiedades extra o descripciones;
- instituciones, resoluciones oficiales, firmas, sellos;
- precios, promociones y descuentos;
- emojis.

La lista se transforma en un `SubjectCatalogEntry` completo y vuelve a validarse con `GeneratedSubjectCatalogEntrySchema`. La categoría candidata se reutiliza; cuando es `null` se usa `OTROS`. Los seis productos permitidos proceden de `PRODUCT_TYPES`, sin duplicar constantes.

## Seguridad del prompt

El nombre de la materia se delimita como JSON no confiable. El prompt prohíbe responder al cliente, utilizar web, inventar oficialidad o información comercial y obedecer instrucciones incluidas en el nombre.

Antes de llamar OpenAI se rechazan nombres vacíos, incoherentes con el normalizador, demasiado extensos, con código o saltos de línea, o claramente formulados como instrucciones. El texto completo no se registra en logs.

## IDs deterministas

El ID de materia combina:

- slug estable derivado del nombre normalizado;
- SHA-256 de `IPDE + normalizedName`, truncado a 12 caracteres hexadecimales.

Ejemplo conceptual: `GEN_ANDROLOGIA_151CA951023B`.

Los temas usan el ID de materia y una posición estable entre `TOPIC_01` y `TOPIC_25`. Los IDs no dependen de la fecha, modelo, mensaje o datos personales.

## Reintentos

`IPDE_TOPIC_GENERATION_MAX_ATTEMPTS` acepta valores entre uno y tres y usa dos por defecto.

Una salida nula, incompleta, duplicada o inválida activa un nuevo intento con instrucciones breves de reparación. Tras el máximo se devuelve `GENERATION_ATTEMPTS_EXHAUSTED` y no se guarda nada. Errores de autenticación, timeout, red, rate limit o modelo no disponible se devuelven inmediatamente con códigos seguros; no existe un fallback local que invente 25 temas.

## Single-flight y concurrencia

`IpdeGenerationLockService` mantiene un mutex en memoria por materia. La segunda solicitud espera y vuelve a consultar el catálogo dentro del lock, por lo que reutiliza lo creado por la primera. El lock se libera siempre mediante `finally`.

Este mecanismo es válido para el MVP de una sola instancia. No coordina varias réplicas; antes de escalar se necesitará un lock distribuido o persistencia central transaccional.

## Persistencia y Railway Volume

Las entradas se guardan exclusivamente mediante `CatalogService.saveGenerated`, que delega en la escritura JSON atómica existente. El directorio sigue resolviéndose mediante `PERSISTENT_DATA_DIR`, `RAILWAY_VOLUME_MOUNT_PATH` o `./data`.

Una nueva instancia de los repositorios recupera la misma entrada desde disco. No se escribe durante build o pre-deploy.

## Reutilización y métricas de uso

Cuando una entrada `OPENAI_GENERATED` se reutiliza, `CatalogService.recordGeneratedUse` incrementa `usageMetadata.useCount`, actualiza `lastUsedAt` y publica el JSON de forma atómica bajo el lock de escritura por materia.

La operación no puede modificar entradas manuales. Si falla, la resolución registra una advertencia segura y entrega la lista existente; una métrica auxiliar nunca bloquea la atención.

## Selecciones numéricas

`IpdeTopicSelectionResolutionService`:

- acepta nombre completo o referencia corta inequívoca;
- valida posiciones contra la lista presentada;
- mantiene el orden del cliente;
- elimina posiciones duplicadas;
- combina selecciones de la misma materia;
- devuelve `NO_PRESENTED_LIST`, `UNKNOWN_SUBJECT_REFERENCE`, `POSITION_NOT_AVAILABLE` o `AMBIGUOUS_SELECTION` sin inventar temas.

No modifica pedidos ni estados.

## Configuración

```dotenv
IPDE_TOPIC_GENERATION_MODEL=
IPDE_TOPIC_GENERATION_PROMPT_VERSION=v1
IPDE_TOPIC_GENERATION_MAX_ATTEMPTS=2
```

El modelo específico cae a `DEFAULT_OPENAI_MODEL` y después al fallback compatible centralizado. El timeout es el compartido `OPENAI_REQUEST_TIMEOUT_MS`. La versión del prompt acepta únicamente letras, números, punto, guion y guion bajo.

## Logs y costos

Los logs pueden incluir UUID de resolución, hash o nombre normalizado truncado, intento, modelo y código seguro. No incluyen API keys, mensajes, nombres de clientes, prompts o listas completas.

La metadata acumula llamadas OpenAI y tokens por resolución. Todavía no se persiste en `UsageDaily` ni se modifica `UsageService`.

## Pruebas y límites

Las pruebas usan catálogos temporales y clientes OpenAI mockeados. Cubren prioridad, persistencia entre instancias, reutilización, validación, reintentos, errores, prompt injection, IDs, fuzzy, varias materias, fallas parciales, single-flight y selecciones.

Este bloque no modifica Prisma, webhook, estados, pedidos o catálogo manual; no crea endpoints, jobs o cron; no llama Meta; no envía mensajes, imágenes o PDF; no usa búsqueda web.
