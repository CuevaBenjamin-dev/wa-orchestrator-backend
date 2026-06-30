# Hardening de webhook y outbox persistente IPDE

Este documento resume el Bloque 11: validación de firma de Meta, preservación de raw body, outbox persistente para respuestas IPDE y reglas de reintento sin jobs externos.

## Alcance

- `POST /webhooks/whatsapp` valida opcionalmente `x-hub-signature-256`.
- `GET /webhooks/whatsapp` conserva la verificación de Meta sin cambios.
- El envío IPDE ya no se ejecuta directamente desde el resultado del motor: primero se persiste un outbox.
- Los mensajes `ASSISTANT` se crean solo después de un envío exitoso o simulado.
- No se agrega worker, cron ni endpoint administrativo.
- Las pruebas automatizadas siguen sin enviar mensajes reales.

## Firma de Meta

La aplicación se inicia con `rawBody: true` en `src/main.ts`. Nest sigue parseando el JSON normalmente, pero también deja disponible el cuerpo original para calcular el HMAC.

`WhatsappSignatureService` valida:

1. `WHATSAPP_WEBHOOK_SIGNATURE_VALIDATION_ENABLED`.
2. `META_APP_SECRET` cuando la validación está habilitada.
3. Presencia de raw body.
4. Header `x-hub-signature-256` con formato `sha256=<hex>`.
5. HMAC SHA-256 del raw body usando `META_APP_SECRET`.
6. Comparación con `timingSafeEqual`.

Si la validación está deshabilitada, el webhook procesa normalmente y registra un evento seguro. Si está habilitada y falla, el controller responde `403` antes de invocar `WhatsappService`, el motor IPDE, Prisma de negocio o Meta.

## Outbox persistente

El modelo Prisma `IpdeOutboundDelivery` registra cada entrega planificada con aislamiento por tenant:

- `tenantId`, `conversationId`, `leadId`, `orderId`;
- `inboundMessageId`, `inboundExternalId`;
- `actionType`, `sequence`, `payloadJson`;
- `status`, `attemptCount`, `maxAttempts`;
- `providerMessageId`, `lastErrorCode`, `lastErrorMessage`;
- `scheduledAt`, `sentAt`, `failedAt`, `createdAt`, `updatedAt`.

La clave única `tenantId + inboundExternalId + sequence` impide duplicar entregas si Meta reintenta el mismo inbound. Los estados son:

- `PENDING`: listo para ejecutar cuando `scheduledAt <= now`.
- `SENDING`: tomado para ejecución.
- `SENT`: enviado o simulado correctamente.
- `FAILED`: agotó intentos o no hay ruta de envío.
- `CANCELLED`: reservado para cancelaciones futuras.
- `SKIPPED`: acción segura omitida, por ejemplo PDF sin media configurada.

## Flujo de inbound IPDE

Para un inbound nuevo:

1. `WhatsappService` resuelve tenant por `phone_number_id`.
2. Si el tenant corresponde a IPDE, delega a `IpdeWhatsappOrchestratorService`.
3. El orquestador persiste el inbound antes de llamar al motor.
4. El motor produce acciones comerciales.
5. `IpdeOutboundDeliveryService.createFromActions` convierte esas acciones en entregas persistentes con secuencia estable.
6. `executePendingForInbound` ejecuta solo entregas `PENDING` del inbound actual.
7. `IpdeWhatsappOutboundPersistenceService.persistDeliveredMessages` crea mensajes `ASSISTANT` únicamente para entregas `SENT`.

Para un inbound duplicado de IPDE:

1. Se detecta `Message.externalId` ya existente.
2. No se vuelve a llamar a OpenAI, detector de comprobantes ni motor comercial.
3. Se busca outbox pendiente para ese `inboundExternalId`.
4. Se reintenta lo pendiente y se evita reejecutar entregas `SENT`.
5. La persistencia de mensajes salientes es idempotente por `providerMessageId` o por `ipde-outbox:<deliveryId>` en dry-run.

## Política de reintentos

La configuración operativa es:

```dotenv
IPDE_OUTBOUND_MAX_ATTEMPTS=3
IPDE_OUTBOUND_RETRY_DELAY_SECONDS=60
```

Los límites aceptados son:

- intentos: `1..10`;
- demora: `5..3600` segundos.

Un fallo temporal deja la entrega en `PENDING` con `scheduledAt` futuro. Al agotar intentos pasa a `FAILED`. El Bloque 11 no instala un worker; los reintentos ocurren cuando:

- Meta reenvía el mismo webhook y el inbound ya existe;
- una llamada futura invoque `retryPending`.

## Payloads seguros

El outbox guarda payloads validados por Zod:

- texto seguro;
- ID lógico de imagen (`IMAGE_ASSET`);
- ID lógico de PDF referencial (`MODEL_PDF_ASSET`);
- contenido textual seguro para `Message`.

No guarda URLs privadas, access tokens, prompts completos, rutas locales ni `storageKey` en mensajes persistidos.

## Comprobantes

El flujo de comprobantes mantiene la regla de seguridad:

- no descarga archivos;
- no hace OCR;
- no valida pagos;
- no aprueba ni rechaza comprobantes;
- después de registrar un comprobante probable/confirmado, emite un mensaje informativo y pausa la automatización para revisión humana.

## Validación operativa

El comando:

```bash
npm run ipde:env:validate
```

verifica variables críticas sin imprimir secretos. Falla si faltan valores requeridos, si los rangos son inválidos, si se habilita envío real sin token no-placeholder o si se habilita firma sin `META_APP_SECRET`.
