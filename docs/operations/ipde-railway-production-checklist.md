# Checklist Railway e inicio de conversación real IPDE

Este checklist sirve para pasar de staging seguro a una prueba real con tu WhatsApp personal. No pegues secretos en el chat; ingrésalos solo en Meta, Railway, OpenAI o tu `.env` privado.

## 1. Variables obligatorias en Railway

En Railway, entra al servicio backend y abre `Variables`. Configura:

```dotenv
APP_PORT=${{PORT}}
DATABASE_URL=<url privada de Railway Postgres>

IPDE_TENANT_CODE=IPDE
IPDE_WHATSAPP_PHONE_ID=<phone number id de Meta>

WHATSAPP_VERIFY_TOKEN=<cadena aleatoria que también pondrás en Meta>
WHATSAPP_API_VERSION=v21.0
WHATSAPP_REQUEST_TIMEOUT_MS=10000
WHATSAPP_SEND_ENABLED=false
WHATSAPP_ACCESS_TOKEN=replace_with_meta_access_token

WHATSAPP_WEBHOOK_SIGNATURE_VALIDATION_ENABLED=true
META_APP_SECRET=<app secret de Meta>

OPENAI_API_KEY=<api key privada de OpenAI>
DEFAULT_OPENAI_MODEL=gpt-5.4-mini
OPENAI_REQUEST_TIMEOUT_MS=10000

IPDE_COMMERCIAL_CONFIG_PATH=./config/ipde/commercial-config.json
IPDE_MODEL_PDF_ASSETS_PATH=./config/ipde/model-pdf-assets.json
IPDE_PRICING_PROMOTIONS_PATH=./config/ipde/pricing-promotions.json
IPDE_MEDIA_ASSETS_PATH=./config/ipde/media-assets.json
IPDE_MANUAL_CATALOG_PATH=./config/ipde/catalog.manual.json

IPDE_MEDIA_STORAGE_SUBDIR=ipde-media
IPDE_GENERATED_CATALOG_SUBDIR=generated-catalog
IPDE_OUTBOUND_MAX_ATTEMPTS=3
IPDE_OUTBOUND_RETRY_DELAY_SECONDS=60
```

Notas:

- Mantén `WHATSAPP_SEND_ENABLED=false` para la primera prueba inbound. Con eso el sistema procesa y simula envíos sin llamar a Meta.
- Cambia `WHATSAPP_SEND_ENABLED=true` solo cuando ya tengas token real y quieras recibir respuestas en WhatsApp.
- Si Railway no resuelve `APP_PORT=${{PORT}}` en tu proyecto, configura `APP_PORT` con el puerto expuesto por Railway para el servicio.

## 2. Meta Developers / WhatsApp Cloud API

En Meta Developers:

1. Abre tu App.
2. En `Settings > Basic`, copia `App Secret` y colócalo en Railway como `META_APP_SECRET`.
3. En el producto WhatsApp, copia el `Phone Number ID` y colócalo como `IPDE_WHATSAPP_PHONE_ID`.
4. Crea o usa un token con permisos de WhatsApp Cloud API. Para la prueba real necesitas capacidad de enviar mensajes desde ese número.
5. En `Webhooks`, configura:
   - Callback URL: `https://<tu-dominio-railway>/webhooks/whatsapp`
   - Verify token: exactamente el valor de `WHATSAPP_VERIFY_TOKEN`
6. Suscribe el webhook al evento `messages`.
7. Si usas el número de prueba de Meta, agrega tu WhatsApp personal como destinatario permitido en la pantalla de API setup.

El endpoint `GET /webhooks/whatsapp` sirve para la verificación de Meta. El endpoint `POST /webhooks/whatsapp` procesa mensajes y, con firma habilitada, exige `x-hub-signature-256`.

## 3. Base de datos

Verifica que el tenant de IPDE tenga el `whatsappPhoneId` correcto.

Opción recomendada para revisar manualmente:

1. Conéctate a la base de Railway desde un entorno privado.
2. Abre Prisma Studio o un cliente SQL.
3. Busca la fila de `Tenant` correspondiente a IPDE.
4. Actualiza `Tenant.whatsappPhoneId` con el mismo `Phone Number ID` de Meta.

No uses el nombre visible como regla de negocio; el código debe seguir operando con `IPDE_TENANT_CODE=IPDE` y el `phone_number_id`.

## 4. Railway Volume y archivos

Si usas catálogo generado o archivos multimedia por `storageKey`, monta un Railway Volume y deja que Railway exponga:

```dotenv
RAILWAY_VOLUME_MOUNT_PATH=<ruta del volumen>
```

No escribas durante build. En runtime, los archivos de media se buscan bajo:

```text
<RAILWAY_VOLUME_MOUNT_PATH>/ipde-media/<storageKey>
```

Si tus assets usan `whatsappMediaId` o `publicUrl`, no necesitas subir archivo físico para esos assets.

## 5. Comandos antes de desplegar

En local:

```bash
npx prisma validate
npm run catalog:validate
npm run ipde:config:validate
npm run ipde:pricing:validate
npm run ipde:media:validate
npm run ipde:env:validate
npm run build
npm test -- --runInBand
```

En producción/Railway, aplica migraciones con:

```bash
npx prisma migrate deploy
```

No uses `prisma migrate reset` en producción.

## 6. Prueba segura sin envío real

Primero deja:

```dotenv
WHATSAPP_SEND_ENABLED=false
```

Envía desde tu WhatsApp personal un texto al número de WhatsApp Cloud API, por ejemplo:

```text
Hola, quiero información sobre un diplomado en derecho civil.
```

Resultado esperado:

- Railway recibe el webhook.
- Se persiste el inbound en `Message`.
- Se crea o actualiza lead y conversación.
- Se generan entregas en `IpdeOutboundDelivery`.
- Las entregas quedan `SENT` simuladas.
- Se persiste el mensaje `ASSISTANT` con `externalId` tipo `ipde-outbox:<deliveryId>`.
- No recibes respuesta real en WhatsApp porque el envío está apagado.

## 7. Prueba real con respuesta en WhatsApp

Cuando la prueba segura esté correcta:

1. En Railway, configura `WHATSAPP_ACCESS_TOKEN` con el token real de Meta.
2. Cambia `WHATSAPP_SEND_ENABLED=true`.
3. Redeploy/restart del servicio.
4. Envía desde tu WhatsApp personal:

```text
Hola, quiero precios de diplomados.
```

Resultado esperado:

- El agente responde en WhatsApp.
- `IpdeOutboundDelivery.status` pasa a `SENT`.
- `providerMessageId` queda registrado cuando Meta devuelve ID.
- El mensaje `ASSISTANT` se persiste usando el ID de Meta.

Para probar comprobantes, envía una imagen o documento con caption relacionado a pago solo después de tener una conversación comercial. El sistema debe informar recepción y pausar la automatización para revisión humana; no debe afirmar que el pago es válido.

## 8. Señales de error comunes

- `403` en POST: firma inválida, `META_APP_SECRET` incorrecto o raw body ausente.
- Meta no verifica webhook: `WHATSAPP_VERIFY_TOKEN` no coincide o URL pública incorrecta.
- No llega respuesta real: `WHATSAPP_SEND_ENABLED=false`, token inválido, phone number ID incorrecto o tu número personal no está autorizado como destinatario de prueba.
- Outbox queda `PENDING`: hubo fallo temporal y espera reintento.
- Outbox queda `FAILED`: agotó intentos o falta ruta de envío.

## 9. Rollback seguro

Si algo falla durante una prueba real:

1. Cambia `WHATSAPP_SEND_ENABLED=false`.
2. Reinicia el servicio.
3. Revisa `IpdeOutboundDelivery` y logs sin exponer tokens.
4. No borres datos ni resetees migraciones.
