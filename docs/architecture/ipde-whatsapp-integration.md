# Integración IPDE con Webhook Real de WhatsApp

Este documento describe el contrato implementado para conectar el webhook real de WhatsApp con el motor conversacional comercial de IPDE sin romper el flujo multi-tenant existente.

## Alcance

- Se mantiene `GET /webhooks/whatsapp` como endpoint de verificación de Meta.
- Se mantiene el flujo genérico existente para tenants no IPDE.
- IPDE se activa por configuración explícita y estable, no por nombre visible del tenant.
- No se agregan endpoints, jobs, cron jobs, migraciones ni cambios Prisma para este bloque.
- Las pruebas automatizadas no envían mensajes reales: el gateway respeta `WHATSAPP_SEND_ENABLED`.

## Identificación del tenant IPDE

El webhook resuelve primero el tenant por `metadata.phone_number_id`, como antes. Luego `IpdeWhatsappMessageMapperService` decide si ese tenant puede ser atendido por el flujo IPDE.

La estrategia actual es temporal y explícita:

- `IPDE_TENANT_CODE` debe resolver a `IPDE`.
- `IPDE_WHATSAPP_PHONE_ID` debe coincidir con el `phone_number_id` del webhook o con `tenant.whatsappPhoneId`.

No se usa el nombre visible del tenant. Cuando exista un campo persistente de código de tenant, esta detección debería migrarse a ese identificador.

## Flujo de texto IPDE

Para mensajes `type=text`:

1. Se conserva la idempotencia por `Message.externalId` usando el ID externo de WhatsApp.
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
9. Se ejecutan las acciones salientes mediante `IpdeOutboundActionExecutorService`.
10. Se persisten mensajes salientes seguros con `MessageRole.ASSISTANT`.

Si el motor devuelve solo `NO_AUTOMATED_RESPONSE` o `DEFERRED_COMMERCIAL_REQUEST`, no se envía respuesta automática.

## Flujo de imagen/documento IPDE

Para `type=image` y `type=document`:

1. Se conserva la idempotencia por `Message.externalId`.
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

## Persistencia de salientes

`IpdeWhatsappOutboundPersistenceService` convierte los resultados de ejecución saliente en mensajes persistidos:

- Textos: se guarda el `messageDraft`.
- Listas por chunks: se guarda cada chunk en orden.
- Imágenes de promoción o medios de pago: se guarda el texto y una descripción segura de imagen enviada.
- PDFs referenciales: se guarda el texto y una descripción segura de documento enviado.

No se persisten URLs privadas, tokens, `storageKey` ni rutas locales.

## Idempotencia y reintentos

La idempotencia se mantiene con `Message.externalId`. Si Meta reintenta el mismo webhook, el sistema devuelve `duplicated_message_ignored` y no vuelve a ejecutar motor, detector, prueba de pago ni salientes.

Riesgo conocido: si un mensaje entrante se persiste correctamente pero falla el envío saliente, un reintento de Meta no regenerará la respuesta porque el inbound ya existe. La solución futura recomendada es un outbox persistente para acciones salientes.

## Seguridad operativa

- `WHATSAPP_SEND_ENABLED=false` evita envíos reales.
- Los logs no incluyen tokens ni contenido sensible completo.
- El flujo de media guarda resúmenes seguros.
- Los controllers siguen limitados al transporte HTTP.
- La lógica IPDE vive en servicios dedicados bajo `ipde-sales/whatsapp`.

## Verificación manual sugerida

1. Configurar `IPDE_WHATSAPP_PHONE_ID` con el phone number ID real de IPDE.
2. Mantener `WHATSAPP_SEND_ENABLED=false` en staging inicial.
3. Enviar un texto de prueba y verificar que se persista inbound, estado conversacional y saliente simulado.
4. Enviar una imagen/documento con caption de comprobante y verificar que quede en revisión humana.
5. Repetir el mismo webhook y confirmar que no genera doble respuesta.
6. Probar un tenant no IPDE y confirmar que conserva el flujo anterior.
