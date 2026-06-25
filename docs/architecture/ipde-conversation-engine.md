# Motor conversacional comercial IPDE

## Propósito

`IpdeConversationTurnService` procesa un turno comercial de IPDE y devuelve un plan tipado. No envía mensajes, no llama a Meta, no guarda mensajes de WhatsApp y no reemplaza la deduplicación del webhook. El `turnId` queda preparado para recibir posteriormente el identificador externo de WhatsApp, pero este bloque no crea una tabla de ejecuciones ni promete idempotencia global por ese valor.

El servicio se exporta desde `IpdeSalesModule`. El contexto, planner, copy, política y persistencia permanecen como detalles internos del módulo.

## Límites del bloque

El motor sí puede:

- recuperar o crear el estado conversacional validando tenant, lead y conversación;
- detenerse antes de OpenAI cuando la automatización está pausada, deshabilitada o revisando un pago;
- interpretar una vez el mensaje con el servicio del Bloque 3;
- resolver catálogo o selecciones con el servicio del Bloque 4;
- crear o recuperar un pedido activo solo cuando existe relevancia comercial;
- persistir materias, listas presentadas, selecciones, productos, emisor y nombre;
- pausar la automatización cuando el usuario pide una persona;
- producir acciones salientes estrictas y borradores deterministas.

El motor calcula precios únicamente mediante la configuración manual de pricing del Bloque 7. Desde el Bloque 8 también puede producir acciones visuales para promoción y medios de pago cuando existe un asset multimedia activo, pero sigue sin ejecutar el envío por sí mismo. No valida pagos, procesa comprobantes, genera PDFs finales, usa búsqueda web ni modifica `UsageDaily`. La validación comercial de emisores pertenece al módulo de configuración de IPDE. Tampoco introduce controllers, endpoints, jobs, cron, cambios de Prisma o integración con `WhatsappService.handleIncomingWebhook`.

## Flujo

```text
entrada estricta
  -> recuperar estado y pedido
  -> comprobar pausa
  -> construir contexto mínimo
  -> interpretar exactamente una vez
  -> pausa humana inmediata si corresponde
  -> resolver catálogo solo cuando corresponde
  -> construir plan puro
  -> aplicar plan en transacción corta
  -> validar resultado y acciones
```

La creación del pedido ocurre después de la interpretación. Esta secuencia resuelve una tensión importante del dominio: decidir si un saludo aislado es comercial requiere la extracción estructurada, y un saludo nunca debe crear un pedido vacío. OpenAI y el acceso al catálogo quedan fuera de la transacción.

## Contrato de entrada

`IpdeConversationTurnInputSchema` acepta únicamente:

- `tenantCode: "IPDE"`;
- `tenantId`, `leadId`, `conversationId` y `turnId` acotados;
- `userMessage` entre uno y 4000 caracteres;
- hasta seis mensajes recientes con rol `USER` o `ASSISTANT` y contenido acotado.

Todos los objetos son estrictos. La carga del estado valida que la conversación pertenezca al tenant y lead indicados. Las consultas de pedido, materias e ítems vuelven a filtrar por `tenantId`.

## Contexto mínimo

`IpdeConversationContextService` recupera:

- estado, modo y versión;
- pedido activo, materias e ítems no eliminados;
- nombre y selección de emisor ya persistidos;
- hasta tres listas previamente presentadas.

Las listas no se reconstruyen desde texto ni desde mensajes. Las materias con estado `LIST_PRESENTED` y `catalogEntryId` se vuelven a cargar mediante `CatalogService`, conservando el catálogo como fuente de verdad. El contexto para OpenAI omite IDs internos innecesarios, precios, historial completo y datos ajenos al turno.

## Pausas antes de IA

La comprobación se hace inmediatamente después de recuperar el contexto:

- `PAUSED_HUMAN` produce `NO_AUTOMATED_RESPONSE` con razón `PAUSED_HUMAN`;
- `DISABLED` produce la razón `AUTOMATION_DISABLED`;
- `PAYMENT_UNDER_REVIEW` produce la razón homónima aunque el modo sea otro.

En estos casos no se llama OpenAI, no se consulta catálogo, no se crea pedido y no se genera borrador de respuesta. Si el intérprete detecta una solicitud humana, el estado pasa a `HUMAN_TAKEOVER`, el modo queda `PAUSED_HUMAN`, no se resuelve catálogo y se devuelve `REQUEST_HUMAN_TAKEOVER`.

## Relevancia comercial y pedido activo

No se crea pedido para un saludo aislado, una solicitud humana, una pausa o un mensaje sin señales comerciales. Sí se considera comercial una materia, lista, tema directo o numérico, producto, nombre, intención clara de compra o información que continúe un pedido existente.

La creación y asignación del pedido activo ocurre dentro de la misma transacción que las mutaciones del turno. El índice único de `activeOrderId`, la relación con el estado y el aislamiento serializable protegen el MVP de una sola instancia.

## Planner y política de siguiente dato

`IpdeConversationPlannerService` no escribe en base de datos. Proyecta el pedido después de aplicar los datos inequívocos del turno y consulta `IpdeNextRequiredFieldPolicy` en este orden:

1. aclaración crítica;
2. materia;
3. selección de temas;
4. tipo de producto;
5. variante de emisión;
6. nombre completo;
7. confirmación del nombre;
8. confirmación del pedido.

Los datos adelantados se conservan. Por ejemplo, un nombre o producto recibido junto a una materia puede persistirse sin volver a preguntarse, aunque la lista de temas continúe siendo el siguiente paso visible.

La confirmación final del pedido solo puede proponerse si existen temas activos, todos tienen producto y emisor persistidos, y el nombre está confirmado. `ASK_ISSUER_VARIANT` incluye la recomendación y las alternativas validadas del Bloque 6 con `configurationPending: false`. La recomendación nunca se aplica automáticamente; una preferencia aceptada se valida contra todos los ítems y recién entonces se persiste. `configurationPending: true` queda como fallback defensivo si el motor no puede obtener una recomendación configurada.

## Transiciones controladas

El planner elige como máximo un estado final por turno y la persistencia vuelve a validar la transición. Se añadieron rutas directas explícitas desde estados tempranos hacia:

- `WAITING_FOR_TOPIC_SELECTION`, cuando una lista queda presentada;
- `WAITING_FOR_PRODUCT_TYPE`, cuando ya existen temas seleccionados;
- `WAITING_FOR_ISSUER_VARIANT`, cuando además el producto está completo;
- `WAITING_FOR_FULL_NAME`, cuando los pasos anteriores ya están completos.

Estas rutas evitan transiciones intermedias artificiales como `TOPIC_LIST_READY -> WAITING_FOR_TOPIC_SELECTION` dentro del mismo turno. No se habilitan saltos hacia pago, emisión o finalización.

## Persistencia atómica

`IpdeTurnPersistenceService` recibe un plan ya calculado y abre una transacción serializable corta. Dentro de ella:

- verifica tenant, lead, conversación, estado y versión esperada;
- crea el pedido activo si el plan lo requiere;
- agrega materias de forma idempotente y completa campos previamente vacíos;
- marca listas como presentadas sin degradar una selección ya completa;
- agrega temas o restaura ítems `REMOVED` por la clave única normalizada;
- marca la selección de materia como completa;
- aplica productos por todos los temas, materia o tema específico;
- aplica una preferencia de emisor validada sin sobrescribir selecciones previas;
- evita sobrescribir datos existentes salvo corrección inequívoca;
- captura el nombre sin confirmarlo o confirma el nombre pendiente;
- actualiza una sola vez la versión del estado y, si corresponde, su etapa.

Una corrección explícita de producto o emisor confirmado vuelve el ítem a `DRAFT` y limpia su confirmación. Una corrección explícita de nombre reemplaza el valor y obliga a confirmarlo nuevamente. El nombre nunca aparece dentro de `appliedChanges` ni en logs.

## Concurrencia e idempotencia razonable

La escritura usa compare-and-swap sobre `stateVersion`. Ante conflicto, el orquestador recarga contexto y recalcula solamente el plan determinista. Puede reintentar hasta dos veces y nunca repite la llamada de entendimiento ni la resolución/generación de catálogo. Un tercer conflicto produce `IpdeConversationTurnConflictError` sin una respuesta comercial inventada.

Las claves únicas existentes evitan duplicar materias y temas; un ítem eliminado se restaura. Una repetición que ya no requiere cambios devuelve `NO_CHANGE` y no incrementa la versión. La idempotencia completa del webhook sigue perteneciendo a `Message.externalId`; el motor no crea una segunda fuente de deduplicación.

## Acciones salientes

Todas las acciones pasan por `IpdeOutboundActionSchema`. Entre ellas están:

- preguntas de materia, tema, producto, emisor y nombre;
- presentación de lista con exactamente 25 temas;
- confirmación de temas o nombre;
- oferta tipada de metadatos de modelos referenciales;
- solicitud de revisión humana;
- ausencia explícita de respuesta automatizada;
- intención comercial diferida.

`IpdeResponseCopyService` genera texto breve, cálido y determinista. Cada lista se numera del 1 al 25 y se divide sin partir temas. `IPDE_WHATSAPP_TEXT_CHUNK_MAX_CHARS` acepta entre 500 y 4000, con 3000 por defecto. La introducción vive en el primer fragmento y la instrucción de selección en el último.

Las intenciones `PRICE`, `DISCOUNT` y parte de `PROMOTION` se resuelven cuando el pedido proyectado tiene tema, producto, emisor y variante, y existe una regla de pricing activa. El motor produce `QUOTE_PRICE`, `QUOTE_DISCOUNT` o `PRICE_NOT_AVAILABLE`, y persiste `quotedAmount` sin confirmar la cotización. No expone `minimumAuthorizedAmount`.

Cuando el cliente solicita promoción y existe una imagen activa en `media-assets.json`, el planner añade `SEND_PROMOTION_IMAGE`. Cuando solicita medios de pago y existe `PAYMENT_METHODS_IMAGE`, añade `SEND_PAYMENT_METHODS_IMAGE`. En ambos casos solo produce la acción; la ejecución queda en `IpdeOutboundActionExecutorService`. Si falta media, conserva un `DEFERRED_COMMERCIAL_REQUEST` con razón segura.

`PAYMENT_PROOF_MENTION` sigue diferido. `MODEL_PDF` produce `OFFER_MODEL_PDF_OPTIONS` cuando el pedido tiene producto y emisor completos y existe un modelo activo; la acción omite toda ubicación interna. El executor del Bloque 8 resuelve el ID contra el manifiesto autorizado y solo envía documentos si existe media real configurada. Si la combinación completa no está configurada, se difiere con `MEDIA_NOT_CONFIGURED`.

## Resultado, métricas y logs

El resultado expone solamente resúmenes seguros:

- etapa, modo y versión antes/después;
- ID/estado del pedido y si se creó en el turno;
- resumen de entendimiento y catálogo;
- cambios aplicados por ID;
- acciones salientes validadas;
- intenciones diferidas o resueltas por pricing manual;
- llamadas OpenAI, tokens, fallback, latencia y reintentos.

No devuelve objetos Prisma completos. Los logs usan hashes truncados para tenant y turno, etapas, conteos, intenciones, latencia y códigos seguros. No registran mensaje, nombre, temas, prompts, historial ni secretos.

## Pruebas

Las pruebas no llaman OpenAI ni Meta. Cubren:

- contratos estrictos y rechazo de campos extra;
- pausas antes de IA;
- una sola interpretación;
- solicitud humana sin catálogo;
- saludo sin pedido;
- lista de 25 temas y chunking;
- selección directa y numérica;
- aclaraciones y solicitudes diferidas;
- política de siguiente dato;
- contexto mínimo y reconstrucción desde catálogo;
- persistencia atómica, no-op idempotente y conflicto de versión;
- recálculo concurrente sin repetir OpenAI;
- fixtures con más de quince escenarios.

## Verificación manual futura

Cuando un bloque posterior integre el webhook, debe mantener `Message.externalId` como dueño de la deduplicación, consultar `WHATSAPP_SEND_ENABLED`, guardar primero el mensaje entrante y ejecutar las acciones fuera del motor. Para revisar este bloque de forma aislada:

1. construir un `IpdeConversationTurnInput` con IDs pertenecientes al mismo tenant;
2. invocar `IpdeConversationTurnService.processTurn` desde una prueba o runner interno;
3. comprobar el resultado tipado sin ejecutar `outboundActions`;
4. repetir el turno y verificar que no se duplican materias o temas;
5. pausar el estado y comprobar que las métricas OpenAI quedan en cero.
