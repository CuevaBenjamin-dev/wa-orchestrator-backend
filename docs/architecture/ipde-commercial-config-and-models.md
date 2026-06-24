# Configuración comercial y modelos referenciales IPDE

## Propósito

El Bloque 6 convierte productos, emisores, variantes y modelos referenciales de IPDE en configuración manual versionada y validada. La configuración informa al motor conversacional; no calcula precios, confirma pagos, inventa documentos ni envía archivos.

La fuente de verdad es el código estable `IPDE`. Los nombres visibles son únicamente copy comercial y nunca se usan para identificar el tenant.

## Archivos autoritativos

- `config/ipde/commercial-config.json`: productos activos, emisores, variantes, compatibilidad y recomendaciones por categoría.
- `config/ipde/model-pdf-assets.json`: metadatos de modelos referenciales por emisor, variante y producto.
- Los archivos `.example.json` documentan el mismo contrato sin depender de secretos ni archivos físicos.

Las rutas pueden reemplazarse mediante `IPDE_COMMERCIAL_CONFIG_PATH` e `IPDE_MODEL_PDF_ASSETS_PATH`. En ausencia de variables se usan las rutas versionadas anteriores.

El arranque de `IpdeCommercialConfigModule` carga ambos archivos. Un JSON ilegible, corrupto, con campos extra, referencias cruzadas inválidas o recomendaciones no aplicables impide iniciar la aplicación. Esta decisión evita atender con una configuración comercial parcialmente válida.

## Productos

El vocabulario central contiene exactamente:

- `DIPLOMADO`;
- `ESPECIALIZACION`;
- `CURSO`;
- `CURSO_CAPACITACION`;
- `CURSO_ACTUALIZACION`;
- `CURSO_ESPECIALIZACION`.

`IpdeProductLabelService` es el único traductor de estos códigos a etiquetas naturales. Derecho y Educación admiten diplomado, especialización y curso. Las demás categorías usan por defecto los seis productos.

Cuando un pedido reúne categorías distintas, la pregunta de producto ofrece la intersección válida para todas. Una selección dirigida a una materia o tema se valida solo contra su destino. Un valor ya persistido no se reemplaza salvo corrección explícita.

## Emisores y variantes

La configuración reconoce dos emisores:

- `CAC` con `CAC_DECANO`;
- `UNT` con `UNT_POSGRADO` y `UNT_DIRECTORAL`.

Para Derecho se recomienda `CAC_DECANO`. Para Educación y la regla general se recomienda `UNT_POSGRADO`. `UNT_DIRECTORAL` y las demás variantes activas permanecen como alternativas cuando son compatibles.

Toda recomendación tiene `autoApply: false`. El motor muestra la recomendación y explica las alternativas, pero solo crea una mutación cuando el usuario expresa una preferencia válida. Una mención genérica de UNT no se convierte silenciosamente en una resolución específica: produce aclaración.

La extracción actual no incluye un alcance estructurado para la preferencia de emisor. Por ello, una preferencia inequívoca se valida contra todos los ítems activos y se aplica con alcance `ALL`. No se infiere un alcance desde texto libre. Una ampliación futura deberá añadir ese alcance al esquema de entendimiento antes de permitir variantes por materia o tema.

La persistencia vuelve a filtrar ítems por `tenantId` y pedido. No pisa un emisor ya seleccionado sin corrección explícita. Si se corrige un ítem confirmado, vuelve a `DRAFT` y se limpia `confirmedAt`.

## Modelos referenciales

El manifiesto registra metadatos; no exige que un PDF exista físicamente durante build, deploy o arranque. Los campos de ubicación admitidos son nombres lógicos seguros, claves relativas seguras, URL HTTPS sin credenciales y un identificador multimedia opcional. No se aceptan recorridos `..`, rutas absolutas, barras invertidas ni URLs no HTTPS.

`IpdeModelPdfSelectionService` resuelve únicamente activos y deduplica combinaciones repetidas. Para las tres modalidades derivadas de curso usa el modelo base `CURSO` cuando no existe una coincidencia exacta.

El motor genera `OFFER_MODEL_PDF_OPTIONS` solo cuando tema, producto y emisor están completos. La acción expone ID, título, descripción y códigos comerciales; omite `fileName`, `storageKey`, `publicUrl` y `whatsappMediaId`. Si la combinación está completa pero no tiene modelo activo, devuelve `DEFERRED_COMMERCIAL_REQUEST` con `MEDIA_NOT_CONFIGURED`.

Este bloque no abre, genera ni envía PDFs. Tampoco llama Meta ni `WhatsappService`. Un bloque posterior podrá consumir el identificador lógico de la acción, resolver el medio en una capa autorizada y respetar `WHATSAPP_SEND_ENABLED`.

## Validación y operación

La validación independiente se ejecuta con:

```bash
npm run ipde:config:validate
```

El comando solo lee ambos JSON, aplica Zod y comprueba referencias cruzadas. No inicia Nest, no consulta Prisma, no llama OpenAI o Meta y no escribe en disco.

Después de editar la configuración se debe ejecutar:

```bash
npm run ipde:config:validate
npm run catalog:validate
npx prisma validate
npm run build
npm test -- --runInBand
```

## Pendientes deliberados

- envío real de archivos por WhatsApp;
- administración dinámica de configuración;
- pagos y envío real de medios de pago;
- archivos PDF definitivos y sus identificadores de Meta;
- selección de emisor con alcance por materia o tema;
- conexión del motor con el webhook.

Ninguno de estos pendientes debe resolverse dentro de controllers ni mediante lógica específica de IPDE en servicios genéricos.
