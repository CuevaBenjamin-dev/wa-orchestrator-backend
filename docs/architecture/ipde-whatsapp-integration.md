# Integración IPDE con Webhook Real de WhatsApp

Este documento describe el contrato implementado para conectar el webhook real de WhatsApp con el motor conversacional comercial de IPDE sin romper el flujo multi-tenant existente.

## Alcance

- Se mantiene `GET /webhooks/whatsapp` como endpoint de verificación de Meta.
- Se mantiene el flujo genérico existente para tenants no IPDE.
- IPDE se activa por configuración explícita y estable, no por nombre visible del tenant.
- Bloque 11 agrega validación de firma y outbox persistente; no agrega endpoints, jobs ni cron jobs.
- Las pruebas automatizadas no envían mensajes reales: el gateway respeta `WHATSAPP_SEND_ENABLED`.

## Identificación del tenant IPDE

El webhook resuelve primero el tenant por `metadata.phone_number_id`, como antes. Luego `IpdeWhatsappMessageMapperService` decide si ese tenant puede ser atendido por el flujo IPDE.

La estrategia actual es temporal y explícita:

- `IPDE_TENANT_CODE` debe resolver a `IPDE`.
- `IPDE_WHATSAPP_PHONE_ID` debe coincidir con el `phone_number_id` del webhook o con `tenant.whatsappPhoneId`.

No se usa el nombre visible del tenant. Cuando exista un campo persistente de código de tenant, esta detección debería migrarse a ese identificador.

## Flujo de texto IPDE

Para mensajes `type=text`:

1. Se conserva la idempotencia por `Message.externalId` usando el ID externo de WhatsApp. Si el inbound ya existe, IPDE no vuelve a llamar al motor y solo reintenta outbox pendiente.
2. Se crea o recupera el lead.
3. Se crea o recupera la conversación.
4. Se persiste el mensaje entrante antes de llamar al motor.
5. Se incrementa la métrica de mensaje entrante.
6. Se carga un historial reciente acotado, excluyendo el mensaje entrante actual.
7. Se llama a `IpdeConversationTurnService.processTurn` con:
   - `tenantCode: IPDE`
   - `tenantId`
   - `leadId`
   - `conversationId`
   - `turnId` igual al ID del mensaje de WhatsApp
   - `userMessage`
   - `recentMessages`
8. Se registra consumo de IA si el motor reporta llamadas y tokens.
9. Se persisten acciones salientes en `IpdeOutboundDelivery` con secuencia estable.
10. Se ejecuta el outbox pendiente para ese inbound.
11. Se persisten mensajes salientes seguros con `MessageRole.ASSISTANT` solo después de entregas `SENT` o simuladas correctamente.

Si el motor devuelve solo `NO_AUTOMATED_RESPONSE` o `DEFERRED_COMMERCIAL_REQUEST`, no se envía respuesta automática.

## Flujo de imagen/documento IPDE

Para `type=image` y `type=document`:

1. Se conserva la idempotencia por `Message.externalId`. Un duplicado de IPDE no reevalúa comprobantes y solo reintenta outbox pendiente.
2. Se crea o recupera lead y conversación.
3. Se guarda una descripción segura del inbound:
   - `[Imagen recibida]`
   - `[Documento recibido]`
   - `[Documento recibido: nombre.pdf]`
4. Se incrementa la métrica de inbound.
5. Se extrae metadata segura con `whatsapp-media-message.utils.ts`.
6. Se evalúa si el medio parece comprobante de pago con `IpdePaymentProofDetectorService`.
7. Si es comprobante confirmado/probable, se registra con `IpdePaymentProofService.registerPaymentProof`.
8. Se ejecuta `PAYMENT_PROOF_RECEIVED` cuando corresponde.
9. Se pausa el flujo automatizado por la lógica de comprobantes para revisión humana.

El flujo de media no descarga archivos, no hace OCR, no llama a OpenAI, no aprueba ni rechaza pagos.

## Persistencia de salientes y outbox

`IpdeOutboundDeliveryService` planifica y ejecuta entregas salientes persistentes antes de crear mensajes `ASSISTANT`. `IpdeWhatsappOutboundPersistenceService` convierte entregas `SENT` en mensajes persistidos:

- Textos: se guarda el `messageDraft`.
- Listas por chunks: se guarda cada chunk en orden.
- Imágenes de promoción o medios de pago: se guarda el texto y una descripción segura de imagen enviada.
- PDFs referenciales: se guarda el texto y una descripción segura de documento enviado.

No se persisten URLs privadas, tokens, `storageKey` ni rutas locales.

En dry-run, cuando Meta no devuelve ID real, el mensaje saliente usa un `externalId` estable con formato `ipde-outbox:<deliveryId>`.

## Idempotencia y reintentos

La idempotencia se mantiene con `Message.externalId` para inbound y con `tenantId + inboundExternalId + sequence` para outbox. Si Meta reintenta el mismo webhook de IPDE:

- el sistema devuelve `duplicated_message_ignored`;
- no vuelve a ejecutar motor, detector ni registro de comprobantes;
- sí busca entregas `PENDING` del outbox de ese inbound;
- no reejecuta entregas `SENT`;
- no duplica mensajes `ASSISTANT`.

El Bloque 11 no agrega worker ni cron. Los reintentos globales quedan disponibles por servicio (`retryPending`) para un runner futuro.

## Validación de firma

`POST /webhooks/whatsapp` puede exigir `x-hub-signature-256` cuando:

```dotenv
WHATSAPP_WEBHOOK_SIGNATURE_VALIDATION_ENABLED=true
META_APP_SECRET=<app-secret-real>
```

La firma se calcula con HMAC SHA-256 sobre el raw body preservado por Nest. Si falla, se responde `403` antes de procesar el body.

## Seguridad operativa

- `WHATSAPP_SEND_ENABLED=false` evita envíos reales.
- `WHATSAPP_WEBHOOK_SIGNATURE_VALIDATION_ENABLED=true` protege el POST de Meta en producción.
- Los logs no incluyen tokens ni contenido sensible completo.
- El flujo de media guarda resúmenes seguros.
- Los controllers siguen limitados al transporte HTTP.
- La lógica IPDE vive en servicios dedicados bajo `ipde-sales/whatsapp`.

## Verificación manual sugerida

1. Configurar `IPDE_WHATSAPP_PHONE_ID` con el phone number ID real de IPDE.
2. Mantener `WHATSAPP_SEND_ENABLED=false` en staging inicial.
3. Enviar un texto de prueba y verificar que se persista inbound, estado conversacional y saliente simulado.
4. Enviar una imagen/documento con caption de comprobante y verificar que quede en revisión humana.
5. Repetir el mismo webhook y confirmar que no genera doble respuesta ni duplica outbox.
6. Probar un tenant no IPDE y confirmar que conserva el flujo anterior.
