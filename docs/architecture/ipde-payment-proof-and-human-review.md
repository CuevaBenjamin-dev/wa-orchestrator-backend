# Comprobantes de pago y revisión humana IPDE

## Propósito

El Bloque 9 registra referencias de comprobantes de pago recibidos por WhatsApp y pausa la automatización para revisión humana. La implementación vive en `src/ipde-sales/payment-proof` y no está conectada todavía al webhook principal.

El módulo no valida pagos, no aprueba ni rechaza comprobantes, no descarga archivos, no hace OCR, no llama OpenAI, no llama Meta, no confirma matrículas y no genera documentos finales.

## Modelo persistente

`IpdePaymentProof` guarda metadata segura:

- tenant, lead, conversación y estado IPDE;
- pedido activo cuando existe;
- proveedor `WHATSAPP`;
- `providerMessageId` y `providerMediaId`;
- tipo de media `image` o `document`;
- `mimeType`, `fileName`, `caption` y `sha256` cuando llegan en el webhook;
- estado interno del comprobante.

`orderId` es opcional. Esta es una adaptación deliberada: el PDF mostraba el pedido como obligatorio, pero también exige no inventar un pedido si no hay pedido activo. En ese caso el comprobante queda asociado a conversación/lead y la atención automática queda pausada.

La tabla tiene índices para revisión por tenant/estado, búsqueda por pedido/fecha y deduplicación por IDs externos. `@@unique([tenantId, providerMessageId])` evita duplicados con el ID externo de WhatsApp; si ese ID no existe, el repositorio usa `providerMediaId` dentro del tenant y pedido, o dentro de tenant/conversación cuando no hay pedido.

## Registro

`IpdePaymentProofService.registerPaymentProof` valida la entrada con Zod y delega una transacción serializable al repositorio:

1. valida que la conversación pertenezca al tenant y lead indicados;
2. recupera o crea el estado IPDE de la conversación;
3. recupera el pedido activo si existe;
4. detecta duplicados antes de mutar;
5. crea el comprobante con estado `UNDER_REVIEW`;
6. si hay pedido activo mutable, pasa el pedido a `PAYMENT_UNDER_REVIEW` y `paymentStatus: UNDER_REVIEW`;
7. pasa el estado conversacional a `PAYMENT_UNDER_REVIEW`;
8. configura `automationMode: PAUSED_HUMAN` y razón `PAYMENT_PROOF_RECEIVED`;
9. devuelve una acción saliente determinista.

La acción devuelta para comprobantes nuevos es:

```text
Perfecto, ya recibí tu comprobante.
Vamos a verificar que el pago se haya realizado correctamente. Dame un momento, por favor.
```

Si el comprobante ya existía, el servicio devuelve el registro existente sin repetir cambios ni emitir una nueva acción.

## Detector de media

`IpdePaymentProofDetectorService` es puro. Solo mira metadata disponible:

- tipo de media;
- caption;
- nombre de archivo;
- etapa/pedido/contexto comercial conocido.

No descarga archivos y no intenta leer imágenes. En contexto de pago (`WAITING_FOR_PAYMENT`, `PAYMENT_UNDER_REVIEW`, precio cotizado o pago esperando comprobante), una imagen o documento se marca como `CONFIRMED_PAYMENT_PROOF` con confianza alta. Sin contexto, se devuelve `POSSIBLE_PAYMENT_PROOF`; los keywords como `comprobante`, `voucher`, `pago`, `yape`, `plin`, `transferencia`, `depósito`, `constancia` u `operación` solo elevan la confianza a media, pero no confirman el pago.

## WhatsApp

Se agregaron utilidades en `src/whatsapp/whatsapp-media-message.utils.ts` para extraer metadata de mensajes `image` y `document`. Estas utilidades son deliberadamente pasivas: no están invocadas por `WhatsappService.handleIncomingWebhook` y no cambian el comportamiento actual del webhook.

Cuando un bloque posterior conecte esta pieza, deberá respetar:

- `Message.externalId` como primera barrera de idempotencia;
- `WHATSAPP_SEND_ENABLED` para cualquier envío;
- pausa humana si el comprobante queda bajo revisión;
- último mensaje informativo después de recibir el comprobante;
- cero afirmaciones de pago válido.

## Fuera de alcance

Este bloque no agrega endpoints, controllers, jobs ni cron. Tampoco modifica precios, promociones, catálogo, configuración comercial, assets multimedia reales ni archivos PDF/imagen.
