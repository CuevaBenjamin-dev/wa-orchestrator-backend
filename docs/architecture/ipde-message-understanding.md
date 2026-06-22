# Interpretación estructurada de mensajes IPDE

## Propósito

`IpdeMessageUnderstandingService` convierte un mensaje y un contexto conversacional reducido en una propuesta estructurada y estrictamente validada. No responde al cliente, no avanza estados, no crea pedidos y no valida disponibilidad comercial.

La capacidad vive en `src/ipde-sales/understanding` y se exporta desde `IpdeSalesModule` para un orquestador posterior. `WhatsappModule` no la importa todavía.

## Cliente OpenAI compartido

`OpenAiClientService` pertenece a `AiModule` y crea como máximo una instancia de OpenAI. Lee `OPENAI_API_KEY` y `OPENAI_REQUEST_TIMEOUT_MS` mediante `ConfigService`, no expone ni registra la clave y exporta el cliente nullable para `AiService` y el intérprete IPDE.

El timeout predeterminado es 10 000 ms. Se aceptan enteros entre 1 000 y 120 000 ms. El SDK instalado es OpenAI 6.42.0; sus tipos soportan `responses.parse`, `zodTextFormat`, `output_parsed`, `response.model` y `response.usage` sin casts inseguros.

`AiService` reutiliza este proveedor. Sus prompts, modelos predeterminados, fallbacks y formas de retorno permanecen iguales. Su acceso a `response.usage` ahora utiliza los tipos nativos del SDK.

## Entrada

`IpdeMessageUnderstandingInputSchema` exige `tenantCode: "IPDE"` y un `userMessage` de 1 a 4 000 caracteres. Opcionalmente acepta:

- etapa `IpdeConversationStage` y modo `IpdeAutomationMode`;
- hasta seis mensajes recientes `USER` o `ASSISTANT`, de hasta 2 000 caracteres;
- materias, temas, nombre y emisor ya conocidos;
- hasta tres listas presentadas, cada una con un máximo de 25 posiciones únicas.

Todos los objetos son estrictos y rechazan propiedades desconocidas. El caller futuro deberá seleccionar contexto útil; el servicio no acepta un historial completo.

## Salida

`IpdeMessageExtractionSchema` contiene:

- versión de schema;
- intención principal e intenciones secundarias únicas;
- ruta `DIRECT_TOPICS`, `CATALOG_LIST` o `UNDETERMINED`;
- materias candidatas, categoría, confianza, siglas y aclaraciones;
- selecciones por nombres o posiciones;
- tipos de producto reutilizados del catálogo;
- emisor y variante candidatos;
- nombre completo candidato;
- artefactos solicitados;
- señales de precio, descuento, compra, humano y comprobante;
- confirmación, ambigüedades y confianza global.

El schema rechaza intenciones desconocidas, principal duplicada como secundaria, números fuera de 1-25, confianza fuera de 0-1, materias normalizadas incoherentes, temas/productos/artefactos duplicados y propiedades extra. No existe un campo de respuesta para WhatsApp.

El wrapper agrega metadata calculada por el backend: fuente, modelo, versión del prompt, tokens de entrada y salida, latencia, uso de fallback y razón segura del fallback.

## Intenciones

El conjunto centralizado incluye saludo, información, solicitud de lista, materias, temas preseleccionados, selección de temas, producto, emisor, nombre, promoción, precio, descuento, modelo PDF, medios de pago, confirmación, corrección, humano, mención de comprobante y `OTHER`.

La intención principal nunca aparece entre las secundarias.

## Ruta comercial

- `DIRECT_TOPICS`: el cliente ya expresó temas concretos o seleccionó posiciones de listas presentadas.
- `CATALOG_LIST`: expresó una materia o área y necesita temas disponibles.
- `UNDETERMINED`: falta información suficiente.

El modelo propone esta ruta; no consulta el catálogo ni cambia el pedido.

## Varias materias y selecciones numéricas

Structured Outputs permite varias materias y varias selecciones asociadas a referencias diferentes. El prompt incluye casos de Derecho Civil/Penal y temas directos.

El fallback solo interpreta números cuando recibe `presentedTopicLists`. Asocia fragmentos a la materia por su nombre o referencia corta y descarta posiciones que no existen en la lista. Sin listas genera `AMBIGUOUS_TOPIC_SELECTION` y solicita aclaración.

## Uso del estado

La etapa ayuda a interpretar respuestas breves. En `WAITING_FOR_FULL_NAME`, un texto con forma de nombre puede convertirse en candidato. Fuera de esa etapa el fallback solo acepta expresiones explícitas como “soy” o “me llamo”.

Si ya existe un nombre y aparece otro sin una corrección explícita, el fallback no lo sustituye y produce `POSSIBLE_NAME_WITHOUT_CONTEXT`. El servicio nunca modifica el estado ni el pedido.

## Structured Outputs y prompt

El servicio usa `responses.parse` con `zodTextFormat(IpdeMessageExtractionSchema)`. Comprueba que `output_parsed` no sea `null` y vuelve a validarlo antes de devolverlo.

El system prompt prohíbe respuestas al cliente, chain-of-thought, confirmación de pagos e invención de precios, promociones, instituciones o archivos. El contexto confiable y el mensaje del cliente se delimitan por separado; el mensaje se declara explícitamente como dato no confiable que no puede modificar instrucciones ni schema.

## Modelo y configuración

El modelo se resuelve en este orden:

1. `IPDE_UNDERSTANDING_MODEL` no vacío.
2. `DEFAULT_OPENAI_MODEL` no vacío.
3. `gpt-5.4-mini`, que ya era el fallback compatible de generación en el proyecto.

La versión del prompt usa `IPDE_UNDERSTANDING_PROMPT_VERSION` y cae a `v1` si está ausente o tiene un formato inválido.

## Timeout y errores

Todas las llamadas comparten el timeout configurado. Se distinguen razones seguras para API key ausente, timeout, autenticación, rate limit, modelo no disponible, `output_parsed` nulo, salida inválida, red, error del SDK y error desconocido.

Los errores internos de OpenAI no se propagan al caller. Los logs solo contienen UUID de solicitud, modelo, latencia, código seguro y uso de fallback. No contienen API key, mensaje del cliente, nombre ni historial.

## Fallback local

El fallback es determinista y conservador. Reconoce saludos, listas, PDF, precio, descuento, promoción, medios de pago, productos literales, humano, confirmaciones, correcciones, comprobantes, nombres inequívocos y selecciones numéricas con listas.

No inventa materias, no expande siglas, no asigna números sin contexto, no genera importes y no infiere emisores complejos salvo códigos explícitos. Cuando no encuentra una señal clara devuelve `OTHER`, ruta indeterminada, aclaración y confianza baja. Su resultado siempre se valida con el mismo schema Zod.

## Costos y pruebas

La respuesta expone tokens de entrada/salida y latencia, pero no persiste métricas ni modifica `UsageService`.

Las pruebas mockean por completo el cliente OpenAI. Cubren contratos, límites, duplicados, productos, selecciones numéricas, nombre, prompt injection, metadata, timeout, errores, fallback, logs y regresión de `AiService`. Las fixtures ficticias están en `src/ipde-sales/understanding/fixtures/ipde-understanding-cases.json`.

## Limitaciones y siguiente bloque

Este bloque no consulta PostgreSQL, catálogo ni Railway Volume; no crea listas, precios, pedidos, archivos, endpoints o jobs; no llama Meta y no envía respuestas.

El siguiente orquestador podrá proporcionar estado y contexto mínimo, validar las propuestas contra catálogo/pedido/configuración y decidir transiciones, respuestas, métricas y derivaciones humanas.
