# Estado conversacional y pedidos persistentes de IPDE

## Propósito

`IpdeSalesModule` conserva el estado comercial de IPDE y los pedidos asociados sin acoplarlos al webhook, a OpenAI ni al catálogo. El módulo permite recordar la etapa actual, la pausa humana, el pedido activo, las materias, los temas, el producto, el emisor, el nombre informado, la cotización, el estado de pago y las referencias de comprobantes recibidos.

El módulo exporta los servicios de estado, pedido, motor conversacional, outbound y comprobantes. No contiene controllers ni endpoints HTTP.

## Conceptos

- `Lead` representa a la persona interesada dentro de un tenant.
- `Conversation` agrupa el historial general de mensajes de ese lead.
- `IpdeConversationState` agrega a una conversación la etapa y el modo de automatización específicos del proceso comercial de IPDE.
- `IpdeOrder` representa una solicitud comercial. Un estado conserva todos sus pedidos históricos y puede señalar uno solo como activo.
- `IpdeSubjectRequest` conserva una materia solicitada.
- `IpdeOrderItem` conserva un tema o mención elegido y sus opciones comerciales configurables.
- `IpdePaymentProof` conserva una referencia lógica a un comprobante recibido por WhatsApp. No guarda ni descarga el archivo.

## Enums

`IpdeConversationStage` contiene:

`NEW`, `UNDERSTANDING_REQUEST`, `WAITING_FOR_SUBJECT`, `TOPIC_LIST_READY`, `WAITING_FOR_TOPIC_SELECTION`, `TOPICS_SELECTED`, `WAITING_FOR_PRODUCT_TYPE`, `WAITING_FOR_ISSUER_VARIANT`, `WAITING_FOR_FULL_NAME`, `WAITING_FOR_ORDER_CONFIRMATION`, `WAITING_FOR_PAYMENT`, `PAYMENT_UNDER_REVIEW`, `HUMAN_TAKEOVER`, `READY_FOR_ISSUANCE` y `COMPLETED`.

`IpdeAutomationMode` distingue `ACTIVE`, `PAUSED_HUMAN` y `DISABLED`.

`IpdeOrderStatus` distingue `DRAFT`, `AWAITING_CONFIRMATION`, `CONFIRMED`, `AWAITING_PAYMENT`, `PAYMENT_UNDER_REVIEW`, `READY_FOR_ISSUANCE`, `COMPLETED` y `CANCELLED`.

`IpdePaymentStatus` reserva `NOT_REQUESTED`, `AWAITING_PROOF`, `PROOF_RECEIVED`, `UNDER_REVIEW`, `APPROVED` y `REJECTED`. Este bloque no aprueba ni rechaza pagos.

`IpdePaymentProofStatus` reserva `RECEIVED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED` e `IGNORED`. La recepción automática solo usa `UNDER_REVIEW`; los estados de aprobación, rechazo o descarte quedan para revisión humana futura.

`IpdeSubjectRequestStatus` usa `REQUESTED`, `LIST_PRESENTED`, `SELECTION_COMPLETE` y `CANCELLED`. `IpdeOrderItemStatus` usa `DRAFT`, `CONFIRMED` y `REMOVED`.

## Modelos y relaciones

`IpdeConversationState` pertenece simultáneamente a un tenant, un lead y una conversación. `conversationId` es único, por lo que una conversación solo puede tener un estado IPDE. `stateVersion` comienza en 1 y `activeOrderId` es opcional y único.

`IpdeOrder` pertenece al tenant y al estado. Un estado tiene muchos pedidos mediante `conversationStateId`; la relación independiente `activeOrderId` selecciona el pedido activo.

`IpdeSubjectRequest` pertenece al tenant y al pedido. La combinación `(orderId, normalizedName)` es única.

`IpdeOrderItem` pertenece al tenant y al pedido y puede pertenecer a una materia. Se eligió la restricción única `(orderId, normalizedTopicName)`. Esto evita duplicados incluso cuando `subjectRequestId` es `NULL`; en PostgreSQL, una restricción que incluyera la columna nullable permitiría varias filas equivalentes con `NULL`. Por ahora una misma denominación no se repite dentro del pedido aunque provenga de materias distintas.

`IpdePaymentProof` pertenece siempre al tenant y puede apuntar al pedido activo, estado, conversación y lead. `orderId` es opcional para respetar la regla de negocio de no inventar un pedido cuando llega un comprobante sin pedido activo; en ese caso se conserva la referencia asociada a conversación/lead y se pausa la automatización.

`catalogEntryId` y `catalogTopicId` son referencias lógicas a JSON, no claves foráneas. `catalogSource`, `productTypeCode`, `issuerCode` e `issuerVariantCode` permanecen como strings para poder incorporar opciones sin migrar la base de datos.

## Aislamiento por tenant

Todas las operaciones públicas requieren `tenantId`. Los repositorios consultan los recursos por identificador y tenant; para crear el estado también comprueban que la conversación pertenece al tenant, que el lead pertenece al tenant y que la conversación corresponde al lead.

La creación de un tema con `subjectRequestId` comprueba además que la materia pertenece al mismo tenant y pedido. Los errores de ownership no incluyen datos personales ni revelan el tenant propietario.

## Pedido activo e historial

`IpdeConversationState.activeOrderId` es la fuente de verdad. `getOrCreateActiveOrder` ejecuta una transacción con aislamiento `Serializable`:

1. Recupera el estado por `tenantId` y `conversationId`.
2. Devuelve el pedido activo si existe y pertenece al mismo tenant y estado.
3. Si no existe, crea un pedido `DRAFT`.
4. Asigna el pedido solo si `activeOrderId` continúa en `NULL`.
5. Ante conflicto serializable o asignación perdida, revierte la transacción y reintenta hasta tres veces.

Por ello dos llamadas concurrentes terminan con un único pedido activo y el pedido perdedor no queda persistido. Cuando un pedido pasa a `COMPLETED` o `CANCELLED`, la misma transacción limpia `activeOrderId`; el pedido permanece relacionado como histórico y una llamada posterior puede crear otro.

## Control optimista de concurrencia

Cada transición recibe `expectedVersion`. La escritura usa simultáneamente `id`, `tenantId` y `stateVersion`. Una transición correcta incrementa `stateVersion` y actualiza `lastTransitionAt`. Si ninguna fila coincide se lanza `ConcurrentIpdeStateUpdateError`; nunca se sobrescribe silenciosamente un cambio más reciente.

Las operaciones de pausa y reanudación también incrementan la versión. La pausa se realiza dentro de una transacción y conserva `PAYMENT_UNDER_REVIEW` cuando ese ya es el estado.

## Política de transiciones

La política es un mapa declarativo en `ipde-stage-transition.policy.ts`. Las transiciones permitidas son:

- `NEW`, `UNDERSTANDING_REQUEST` y `WAITING_FOR_SUBJECT` pueden avanzar hacia captura comercial, revisión de pago o `HUMAN_TAKEOVER`.
- `TOPIC_LIST_READY` y `WAITING_FOR_TOPIC_SELECTION` pueden avanzar hacia selección, revisión de pago o `HUMAN_TAKEOVER`.
- `TOPICS_SELECTED`, `WAITING_FOR_PRODUCT_TYPE`, `WAITING_FOR_ISSUER_VARIANT`, `WAITING_FOR_FULL_NAME` y `WAITING_FOR_ORDER_CONFIRMATION` pueden avanzar por los datos comerciales faltantes, corregir datos explícitos, pasar a revisión de pago o `HUMAN_TAKEOVER`.
- `WAITING_FOR_PAYMENT` -> `PAYMENT_UNDER_REVIEW`, `HUMAN_TAKEOVER`.
- `PAYMENT_UNDER_REVIEW` -> `HUMAN_TAKEOVER`.
- `HUMAN_TAKEOVER` -> `READY_FOR_ISSUANCE`, `COMPLETED`.
- `READY_FOR_ISSUANCE` -> `COMPLETED`, `HUMAN_TAKEOVER`.
- `COMPLETED` no tiene salidas.

Las rutas adelantadas permiten omitir preguntas cuando el cliente ya proporcionó datos. Las rutas de corrección desde la confirmación son explícitas; no existen retrocesos arbitrarios.

## Pausa humana

Una transición a `HUMAN_TAKEOVER` o `PAYMENT_UNDER_REVIEW` configura `PAUSED_HUMAN`, guarda razón y fecha y nunca reactiva automáticamente la conversación. `pauseForHuman` conserva `PAYMENT_UNDER_REVIEW`; en otros estados no terminales cambia a `HUMAN_TAKEOVER`.

`resumeAutomation` es una operación explícita reservada para una futura acción administrativa. Actualiza el modo y la fecha de reanudación, pero no cambia la etapa. Se rechaza mientras la etapa sea `PAYMENT_UNDER_REVIEW`, porque esa etapa siempre implica revisión humana.

## Datos del pedido

Los nombres solo normalizan espacios; no se cambian letras, tildes ni mayúsculas. Los textos y códigos tienen límites de longitud. La moneda debe usar tres letras mayúsculas. `quotedAmount` usa `Decimal(12,2)` y el servicio rechaza valores negativos o no finitos.

`changeOrderStatus` prepara marcas temporales de confirmación, emisión, finalización y cancelación. `AWAITING_PAYMENT` prepara `AWAITING_PROOF`; `PAYMENT_UNDER_REVIEW` prepara `UNDER_REVIEW`. No existe ninguna operación en este bloque para aprobar o rechazar pagos.

## Políticas `ON DELETE`

- Las relaciones desde estado, pedido, materia e ítem hacia `Tenant` usan `CASCADE`: al eliminar deliberadamente un tenant se elimina su agregado IPDE completo.
- Las relaciones del estado hacia `Lead` y `Conversation` usan `CASCADE`: el estado no tiene sentido sin esos agregados existentes.
- `IpdeOrder.conversationStateId`, `IpdeSubjectRequest.orderId` e `IpdeOrderItem.orderId` usan `CASCADE`: los hijos forman parte del agregado propietario.
- `IpdeConversationState.activeOrderId` usa `SET NULL`: eliminar un pedido no debe dejar un puntero activo inválido ni provocar un ciclo de cascadas.
- `IpdeOrderItem.subjectRequestId` usa `SET NULL`: el ítem histórico puede conservarse aunque se elimine la clasificación opcional de materia.
- `IpdePaymentProof.orderId`, `conversationStateId`, `conversationId` y `leadId` usan `SET NULL`: la referencia de auditoría puede sobrevivir a la eliminación deliberada de agregados hijos, siempre bajo el tenant.

La migración solo crea enums, tablas, índices y relaciones. No modifica filas ni columnas existentes.

## Fuera de la integración actual

Este bloque no modifica `WhatsappService`, no importa `IpdeSalesModule` desde `WhatsappModule`, no llama OpenAI o Meta, no consulta ni escribe el catálogo, no descarga comprobantes, no envía archivos ni mensajes reales y no expone endpoints.

En bloques posteriores, el orquestador podrá resolver el tenant estable `IPDE`, crear o recuperar el estado después de identificar conversación y lead, consultar el catálogo mediante sus contratos existentes y avanzar solo mediante estos servicios. La aprobación o rechazo de comprobantes seguirá siendo una acción humana.
