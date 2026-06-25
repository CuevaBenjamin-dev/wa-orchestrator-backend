# Recursos multimedia y ejecución saliente IPDE

## Propósito

El Bloque 8 agrega la capa que resuelve recursos multimedia de IPDE y ejecuta acciones salientes ya producidas por el motor conversacional. La responsabilidad queda separada en dos partes:

1. `src/ipde-sales/media`: carga y valida la configuración manual de imágenes.
2. `src/ipde-sales/outbound`: convierte acciones IPDE en envíos de texto, imagen o documento mediante un gateway de WhatsApp.

Esta capa no está conectada todavía al webhook principal. Tampoco guarda mensajes salientes en `Message`, no modifica pedidos, no procesa comprobantes y no confirma pagos.

## Archivo `media-assets.json`

La fuente manual versionada es:

```text
config/ipde/media-assets.json
```

El archivo de ejemplo es:

```text
config/ipde/media-assets.example.json
```

La ruta se puede reemplazar con:

```dotenv
IPDE_MEDIA_ASSETS_PATH=./config/ipde/media-assets.json
```

El JSON contiene assets activos para:

- promoción general de Derecho;
- promoción general de Educación;
- promoción general de Gestión Pública;
- promoción general de otras categorías;
- imagen general de medios de pago.

Los valores versionados son placeholders lógicos mediante `storageKey`; no incluyen imágenes reales ni secretos. En ejecución real, un `storageKey` solo se puede enviar si el archivo existe en el almacenamiento persistente.

## Fuentes de media

Cada asset se resuelve en este orden:

1. `whatsappMediaId`: se usa directamente como ID de Meta, sin leer archivos.
2. `publicUrl`: se usa como link HTTPS, sin credenciales.
3. `storageKey`: se resuelve bajo el directorio persistente y el subdirectorio seguro de IPDE media.

No se aceptan rutas absolutas, `..`, backslashes, URLs no HTTPS ni URLs con usuario/contraseña.

## Railway Volume y `storageKey`

Los archivos físicos se resuelven bajo:

```text
<persistent-root>/<IPDE_MEDIA_STORAGE_SUBDIR>/<storageKey>
```

El root persistente sigue la misma prioridad operacional del catálogo:

1. `PERSISTENT_DATA_DIR`;
2. `RAILWAY_VOLUME_MOUNT_PATH`;
3. `./data`.

El subdirectorio se configura con:

```dotenv
IPDE_MEDIA_STORAGE_SUBDIR=ipde-media
```

El validador no comprueba existencia física. Esa verificación ocurre solo cuando se intenta ejecutar un envío real desde storage.

## Gateway de WhatsApp

`WhatsappMessageGatewayService` vive en `src/whatsapp` y ofrece:

- `sendText`;
- `sendImage`;
- `sendDocument`;
- `uploadMedia`.

El gateway respeta siempre:

```dotenv
WHATSAPP_SEND_ENABLED=false
WHATSAPP_REQUEST_TIMEOUT_MS=10000
IPDE_WHATSAPP_DRY_RUN_PAYLOAD_LOG=false
```

Cuando `WHATSAPP_SEND_ENABLED=false`, no llama a Meta y devuelve un resultado simulado exitoso. Si el envío está habilitado, usa Graph API con timeout entre 1 000 y 120 000 ms.

## Manejo de errores de Meta

Los resultados salientes son estructurados y no exponen tokens:

- timeout: `TIMEOUT`;
- 400: `BAD_REQUEST`;
- 401/403: `AUTHORIZATION_ERROR`;
- 429: `RATE_LIMIT`;
- 5xx: `META_SERVER_ERROR`;
- error de red: `NETWORK_ERROR`;
- JSON inválido: `JSON_INVALID`;
- respuesta sin ID: `PROVIDER_MESSAGE_ID_MISSING` o `PROVIDER_MEDIA_ID_MISSING`.

El gateway no registra access tokens ni payload completo. El dry-run puede registrar solo una línea segura de tipo de payload si `IPDE_WHATSAPP_DRY_RUN_PAYLOAD_LOG=true`.

## Executor de acciones

`IpdeOutboundActionExecutorService` recibe:

```ts
{
  tenantCode: "IPDE";
  tenantId: string;
  phoneNumberId: string;
  to: string;
  actions: IpdeOutboundAction[];
}
```

Devuelve resultados por envío preparado, con secuencia, éxito, simulación, provider ID y código de error seguro.

No escribe en base de datos. El webhook futuro será responsable de persistir mensajes salientes y provider IDs.

## Orden de ejecución

La política inicial es:

1. enviar textos y chunks en orden;
2. enviar imágenes cuando la acción lo indique;
3. enviar documentos de modelos cuando existan medios reales configurados.

Si falla un texto principal, se detienen acciones siguientes. Si falla un medio después del texto, el executor registra el fallo y puede continuar con otros medios independientes.

## Promociones

El planner puede producir:

```text
SEND_PROMOTION_IMAGE
```

Solo lo hace cuando la intención de promoción está presente y existe un asset activo. La selección usa:

1. promoción exacta por categoría;
2. fallback `ANY` u `OTROS`;
3. mayor prioridad;
4. error de configuración si hay empate real.

No se envían promociones visuales de manera automática si el cliente no pidió promoción.

## Medios de pago

El planner puede producir:

```text
SEND_PAYMENT_METHODS_IMAGE
```

La acción envía primero texto y luego imagen. No cambia `paymentStatus`, no pasa a `WAITING_FOR_PAYMENT` y no confirma pagos. Si no hay asset activo, mantiene la solicitud como `DEFERRED_COMMERCIAL_REQUEST` con razón `PAYMENT_METHODS_NOT_CONFIGURED`.

## Modelos PDF

`OFFER_MODEL_PDF_OPTIONS` mantiene su contrato público: expone solo ID, título, descripción y códigos comerciales.

El executor resuelve cada ID contra `model-pdf-assets.json`. Solo envía documento cuando el asset activo tiene `whatsappMediaId`, `publicUrl` o `storageKey`. Si el manifiesto contiene solo placeholder sin ubicación real, envía únicamente el texto de la oferta y no inventa archivos.

## Comando de validación

```bash
npm run ipde:media:validate
```

El comando solo lee `media-assets.json`, valida Zod y devuelve código de error ante fallas. No inicia Nest, no lee archivos físicos, no llama Prisma, OpenAI, Meta ni escribe en disco.

## Fuera de alcance

Este bloque no:

- conecta `IpdeConversationTurnService` al webhook;
- modifica `WhatsappService.handleIncomingWebhook`;
- persiste mensajes salientes;
- procesa comprobantes;
- confirma, aprueba o rechaza pagos;
- genera PDFs finales;
- crea endpoints, controllers, jobs o cron;
- modifica Prisma o migraciones;
- hace llamadas reales en pruebas.

## Pendiente para Bloques 9 y 10

Bloque 9 deberá manejar comprobantes y pausa humana asociada. Bloque 10 podrá integrar el motor IPDE con el webhook real, persistir mensajes salientes y ejecutar esta capa respetando idempotencia, tenant isolation y `WHATSAPP_SEND_ENABLED`.
