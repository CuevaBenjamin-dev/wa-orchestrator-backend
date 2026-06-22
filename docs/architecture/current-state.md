# Estado técnico actual

Auditoría realizada el 17 de junio de 2026, exclusivamente a partir de los archivos y comandos disponibles en el repositorio. No se inspeccionó infraestructura desplegada ni datos de producción.

## Resumen

El proyecto es un backend NestJS para recibir webhooks de WhatsApp Cloud API, resolver el tenant por `phone_number_id`, persistir leads, conversaciones y mensajes en PostgreSQL mediante Prisma, responder con reglas o OpenAI y contabilizar parte del consumo. El aislamiento por tenant está presente en las rutas principales de reglas, conocimiento, leads, conversaciones y uso, pero hay endpoints administrativos temporales sin autenticación y no existen todavía catálogo IPDE, almacenamiento en volumen, estados de conversación, pedidos, comprobantes ni pausa humana persistente.

La lógica específica existente corresponde a tenants de demostración y al Área de Diplomados y Cursos del Colegio de Abogados del Callao. No se encontró configuración ni catálogo de IPDE.

## Árbol relevante

```text
.
├── prisma/
│   ├── migrations/
│   │   ├── 20260526210439_init/
│   │   ├── 20260604153606_unique_message_external_id/
│   │   └── 20260604155520_add_predefined_responses_and_knowledge_items/
│   └── schema.prisma
├── src/
│   ├── ai/
│   ├── conversations/
│   ├── knowledge/
│   ├── leads/
│   ├── prisma/
│   ├── rules/
│   ├── tenants/
│   ├── usage/
│   ├── whatsapp/
│   ├── app.controller.ts
│   ├── app.controller.spec.ts
│   ├── app.module.ts
│   ├── app.service.ts
│   └── main.ts
├── test/
│   ├── app.e2e-spec.ts
│   └── jest-e2e.json
├── .gitignore
├── .prettierrc
├── eslint.config.mjs
├── nest-cli.json
├── package.json
├── package-lock.json
├── README.md
├── tsconfig.build.json
└── tsconfig.json
```

No existen `.env.example`, `prisma.config.ts`, `.nvmrc` ni `.node-version`. El `README.md` conserva el contenido genérico del starter de NestJS y no describe la aplicación real.

## Runtime y dependencias principales

- Node esperado: no está fijado por el repositorio mediante `engines`, `.nvmrc` o `.node-version`. La versión usada durante esta auditoría fue Node `v22.19.0`. El paquete instalado `@nestjs/core@11.1.21` declara Node `>=20`, por lo que ese es el mínimo confirmable a partir de la instalación actual, no una versión exacta del proyecto.
- TypeScript: rango declarado `^5.7.3`, versión instalada `5.9.3`; objetivo de compilación `ES2023` y módulos `NodeNext`.
- NestJS: rangos principales `^11.0.1`; versiones instaladas de core, common y platform-express `11.1.21`. `@nestjs/config` está en `4.0.4`.
- Prisma CLI y `@prisma/client`: `6.19.3`.
- OpenAI SDK: `6.42.0`.
- Generación de Prisma Client: `generator client { provider = "prisma-client-js" }`, sin `output` personalizado. El cliente se genera en la ubicación convencional del paquete y se importa desde `@prisma/client`.
- Base de datos: PostgreSQL mediante `DATABASE_URL`.

## Módulos existentes

| Módulo                | Responsabilidad observada                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PrismaModule`        | Módulo global con una instancia inyectable de `PrismaService`; conecta al iniciar y desconecta al destruir.                                                      |
| `TenantsModule`       | Consulta tenants, crea tenants demo, actualiza configuración y ejecuta seeds de reglas/conocimiento. Incluye lógica específica hardcodeada.                      |
| `WhatsappModule`      | Expone verificación y recepción del webhook; orquesta el flujo completo y el envío de texto a Meta.                                                              |
| `AiModule`            | Clasifica intención con salida Zod y genera respuestas con OpenAI; incluye clasificación local de respaldo.                                                      |
| `LeadsModule`         | Hace upsert del lead por `(tenantId, phone)`.                                                                                                                    |
| `ConversationsModule` | Obtiene o crea conversación, persiste mensajes, recupera contexto y consulta idempotencia por `externalId`.                                                      |
| `UsageModule`         | Acumula mensajes entrantes, respuestas IA y tokens por tenant y día.                                                                                             |
| `RulesModule`         | Evalúa keywords y busca respuestas predefinidas por intención, siempre filtrando por tenant.                                                                     |
| `KnowledgeModule`     | RAG local sin embeddings: recupera `KnowledgeItem` por categoría, términos y prioridad. Se importa a través de `WhatsappModule`, no directamente en `AppModule`. |

`AppController` y `AppService` existen, pero no están registrados en `AppModule`. Por ello la ruta raíz no está activa.

## Modelos Prisma actuales

| Modelo               | Propósito y restricciones relevantes                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Tenant`             | Tenant con `whatsappPhoneId` único, estado y relaciones a configuración, leads, conversaciones, uso, respuestas y conocimiento. |
| `AgentConfig`        | Configuración uno a uno por `tenantId` único: tono, objetivo, información, servicios y reglas.                                  |
| `Lead`               | Contacto por tenant; combinación `(tenantId, phone)` única e índices por tenant y estado.                                       |
| `Conversation`       | Conversación asociada simultáneamente a tenant y lead; índices separados, sin estado ni pausa.                                  |
| `Message`            | Mensaje con rol, contenido, tokens y `externalId` opcional globalmente único; no guarda tipo de medio.                          |
| `UsageDaily`         | Métricas diarias únicas por `(tenantId, date)`, incluidos mensajes, respuestas IA, tokens y costo estimado.                     |
| `PredefinedResponse` | Respuesta `KEYWORD`, `INTENT` o `DEFAULT`, con prioridad, activación y bandera `requiresHuman`.                                 |
| `KnowledgeItem`      | Contenido categorizado por tenant, activación y prioridad.                                                                      |

Enums: `TenantStatus`, `LeadStatus`, `MessageRole` y `PredefinedResponseMatchType`.

Hay tres migraciones versionadas: esquema inicial; unicidad de `Message.externalId`; incorporación de respuestas predefinidas y conocimiento. No se encontró configuración Prisma adicional fuera de `schema.prisma`.

## Flujo actual de webhook entrante

1. `POST /webhooks/whatsapp` entrega el body sin DTO a `WhatsappService.handleIncomingWebhook`.
2. El servicio recorre `entry`, `changes` y `messages`; ignora cambios sin `phone_number_id` y mensajes que no sean texto.
3. `TenantsService.findByWhatsappPhoneId` busca un `Tenant` por el `value.metadata.phone_number_id`, que es único en base de datos, e incluye `AgentConfig`.
4. Antes de persistir, consulta globalmente `Message.externalId`; si ya existe, ignora el mensaje como duplicado.
5. Hace upsert del lead por tenant y teléfono, y encuentra la conversación más reciente o crea una.
6. Persiste el mensaje entrante y aumenta `UsageDaily.inboundMessages`.
7. Evalúa respuestas activas `KEYWORD` del tenant por prioridad.
8. Si ninguna coincide, clasifica la intención con OpenAI o con un fallback local. Puede buscar una respuesta `INTENT`.
9. Si la clasificación pide RAG, recupera hasta cinco `KnowledgeItem`, construye contexto y genera una respuesta. Si aún no hay respuesta, usa generación abierta como fallback.
10. Intenta enviar texto con WhatsApp Cloud API y luego persiste el mensaje del asistente, aun cuando el envío resulte simulado o fallido.
11. Devuelve al caller un detalle por mensaje, incluido texto entrante, respuesta, fuente, tokens y resultado del envío.

No hay transacción que abarque el flujo. Una falla intermedia puede dejar mensaje o métricas persistidos sin completar los pasos posteriores. Una carrera entre webhooks duplicados puede superar la consulta previa y terminar en el constraint único. Si Meta recibió el envío pero falla la persistencia de la respuesta, un reintento se ignorará porque el mensaje entrante ya quedó registrado.

## Generación y envío de respuestas

El orden efectivo es:

1. Coincidencia local de keywords en `RulesService`.
2. Clasificación de intención en `AiService`.
3. Respuesta predefinida por intención.
4. RAG liviano con `KnowledgeService` más generación de OpenAI.
5. Generación de OpenAI sin contexto de conocimiento.

`AiService.classifyUserIntent` usa `responses.parse` y un esquema Zod. Captura errores y tiene fallback local, pero no configura timeout. `generateAgentReply` usa `responses.create`, limita el historial a seis mensajes, pero no valida estructuralmente la respuesta, no configura timeout y no contiene manejo local de errores.

`WhatsappService.sendTextMessage` realiza `fetch` a Graph API. Solo intenta el envío cuando `WHATSAPP_SEND_ENABLED` es exactamente `true` y existe un token distinto de `token_de_meta`. No se realizaron llamadas al webhook ni envíos reales durante esta auditoría.

## Medición de consumo

`UsageService` hace upsert en `UsageDaily` usando el inicio del día según la zona horaria del proceso:

- incrementa `inboundMessages` después de persistir cada texto entrante;
- incrementa `aiResponses`, `tokensInput` y `tokensOutput` después de una generación RAG o IA;
- no contabiliza los tokens usados por la clasificación de intención;
- no actualiza `estimatedCost`;
- no registra métricas de respuestas por reglas, errores, latencia ni envíos de WhatsApp.

## Variables de entorno utilizadas

| Variable                | Uso actual                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `APP_PORT`              | Puerto HTTP; fallback `3000`.                                                               |
| `DATABASE_URL`          | Conexión PostgreSQL de Prisma.                                                              |
| `OPENAI_API_KEY`        | Habilita el cliente OpenAI; sin ella se usan fallbacks locales/simulados.                   |
| `DEFAULT_OPENAI_MODEL`  | Modelo de clasificación y generación; los dos métodos tienen fallbacks distintos en código. |
| `WHATSAPP_VERIFY_TOKEN` | Comparación durante la verificación GET del webhook.                                        |
| `WHATSAPP_SEND_ENABLED` | Interruptor explícito de envíos reales.                                                     |
| `WHATSAPP_ACCESS_TOKEN` | Bearer token de Meta.                                                                       |
| `WHATSAPP_API_VERSION`  | Versión Graph API; fallback `v21.0`.                                                        |

El archivo `.env` existe localmente y está ignorado por Git. En esta auditoría solo se enumeraron sus claves; no se copiaron ni mostraron valores. No hay `.env.example` versionado.

## Scripts disponibles

| Script        | Comando                                                     |
| ------------- | ----------------------------------------------------------- |
| `build`       | `nest build`                                                |
| `format`      | Prettier con escritura sobre `src/**/*.ts` y `test/**/*.ts` |
| `start`       | `nest start`                                                |
| `start:dev`   | `nest start --watch`                                        |
| `start:debug` | `nest start --debug --watch`                                |
| `start:prod`  | `node dist/main`                                            |
| `lint`        | ESLint sobre src/apps/libs/test con `--fix`                 |
| `test`        | Jest unitario, con `rootDir: src`                           |
| `test:watch`  | Jest watch                                                  |
| `test:cov`    | Jest coverage                                               |
| `test:debug`  | Jest in-band con inspector y ts-node                        |
| `test:e2e`    | Jest con `test/jest-e2e.json`                               |

No hay scripts Prisma, de migración, seed, pre-deploy ni deploy en `package.json`.

## Pruebas y línea base

Pruebas encontradas:

- `src/app.controller.spec.ts`: una prueba unitaria del texto `Hello World!`, con controller y service montados de forma aislada.
- `test/app.e2e-spec.ts`: espera `GET /` con 200 y `Hello World!` usando `AppModule`.

Resultados previos a crear esta documentación:

| Verificación                      | Resultado                                                                                                                                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                   | Correcto.                                                                                                                                                                                                                                           |
| `npm run lint -- --no-fix`        | Falló: 69 hallazgos, 66 errores y 3 advertencias. Se añadió `--no-fix` para neutralizar el `--fix` del script y mantener la línea base sin cambios. Predominan operaciones inseguras sobre `any`; también hay una promesa no manejada en `main.ts`. |
| `npm test -- --runInBand`         | Correcto: 1 suite y 1 test aprobados.                                                                                                                                                                                                               |
| `npm run test:e2e -- --runInBand` | Falló: 1 suite y 1 test fallidos. `GET /` devuelve 404 porque `AppController` no está registrado en `AppModule`.                                                                                                                                    |
| `npx prisma validate`             | Correcto: `prisma/schema.prisma` es válido y Prisma cargó las variables desde `.env`.                                                                                                                                                               |

Los fallos de lint y e2e son preexistentes y no se corrigieron por la restricción de no modificar lógica funcional en este bloque.

## Endpoints observados y exposición

| Método y ruta                                | Estado observado                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /`                                      | El controller existe en código, pero la ruta no está registrada y responde 404.                                   |
| `GET /webhooks/whatsapp`                     | Público, requerido por Meta; valida modo y token, pero aceptaría tokens vacíos si la variable también está vacía. |
| `POST /webhooks/whatsapp`                    | Público; no valida firma de Meta ni usa DTO para el payload.                                                      |
| `GET /tenants`                               | Temporal, sin autenticación; expone tenants y configuración de agentes.                                           |
| `POST /tenants/demo`                         | Temporal, sin autenticación; crea datos.                                                                          |
| `POST /tenants/demo/colegio-abogados-callao` | Temporal, sin autenticación; crea datos y contenido hardcodeado.                                                  |
| `PATCH /tenants/:id/whatsapp-phone-id`       | Temporal, sin autenticación ni DTO; modifica identificación de WhatsApp.                                          |
| `POST /tenants/:id/seed-intent-responses`    | Sin autenticación; elimina y recrea respuestas de intención.                                                      |
| `POST /tenants/:id/seed-knowledge-items`     | Sin autenticación; elimina y recrea conocimiento.                                                                 |
| `PATCH /tenants/:id/agent-config`            | Sin autenticación y con body `any`; modifica configuración.                                                       |

No se encontraron guards, autenticación, rate limiting, validación de firma del webhook ni límites de body. El `ValidationPipe` global elimina campos desconocidos y transforma valores, pero los endpoints no definen DTOs, por lo que aporta poca validación en los bodies actuales.

## Deuda técnica y riesgos

- El lint no está limpio y el script oficial modifica archivos por defecto mediante `--fix`.
- La prueba e2e está desalineada con `AppModule` y no hay cobertura del webhook, idempotencia, tenant isolation, reglas, RAG, OpenAI, envío desactivado ni persistencia.
- Los endpoints administrativos temporales permiten lectura, creación, borrado lógico mediante reseed y modificación sin autenticación.
- El POST del webhook no verifica que el payload provenga de Meta. El GET puede aceptar una configuración vacía.
- Los cuerpos del webhook y de configuración usan `any`; no hay DTOs ni límites explícitos.
- No hay timeout en OpenAI ni en `fetch` a Meta. La generación de respuesta tampoco tiene fallback de excepciones.
- `requiresHuman` no crea una pausa persistente. La bandera de la clasificación no controla el envío y el resultado final reporta únicamente la bandera de la regla por keyword.
- La idempotencia tiene constraint en base de datos, pero no una transacción o captura específica para concurrencia.
- El flujo de webhook no es transaccional y mezcla orquestación, acceso a Meta y forma de la respuesta en un servicio de 471 líneas.
- Se persiste una respuesta del asistente aunque el envío sea simulado o falle; no hay estado de entrega persistente.
- La fecha de uso depende de la zona horaria del proceso y puede no coincidir con la fecha comercial de Lima.
- La clasificación de intención consume OpenAI sin registrar sus tokens; `estimatedCost` nunca cambia.
- Hay dos modelos fallback distintos para la misma variable `DEFAULT_OPENAI_MODEL`: `gpt-4o-mini` al clasificar y `gpt-5.4-mini` al generar.
- La lógica y el contenido de un tenant concreto están embebidos en `TenantsService`, lo que dificulta mantener servicios genéricos.
- No existen abstracción de almacenamiento, catálogo versionado, esquema de validación de catálogo ni soporte para Railway Volume.
- `README.md` no documenta configuración, arquitectura, seguridad ni despliegue reales.

## Riesgos de regresión para la siguiente fase

- Mantener la resolución por `whatsappPhoneId` y el filtro por `tenantId` en toda lectura/escritura nueva.
- Preservar la unicidad de `Message.externalId` y endurecer la concurrencia sin romper reintentos de Meta.
- Evitar que la carga o generación del catálogo pueda bloquear el arranque o el webhook.
- No introducir escrituras en volumen durante build/pre-deploy y no sobrescribir configuración manual.
- Mantener `WHATSAPP_SEND_ENABLED=false` en pruebas y evitar que los tests importen rutas capaces de enviar mensajes reales sin mocks.
- Crear solo migraciones nuevas cuando una fase las requiera; no modificar las tres existentes.
- Añadir contratos tipados y pruebas alrededor del flujo antes de ampliar el servicio de WhatsApp.

## Recomendaciones para el Bloque 1

1. Definir un catálogo manual IPDE versionado y validado con un esquema explícito, sin mezclarlo con seeds hardcodeados del tenant existente.
2. Introducir una interfaz de almacenamiento con implementaciones local y Railway Volume; resolver la ruta con prioridad para `RAILWAY_VOLUME_MOUNT_PATH`.
3. Separar claramente archivos manuales de archivos generados, aplicar precedencia manual > persistido > OpenAI y usar escrituras atómicas.
4. Tratar JSON ausente o corrupto como una condición recuperable y observable, no como un fallo global de arranque.
5. Agregar pruebas unitarias de validación, precedencia, aislamiento por tenant, lectura corrupta y escritura atómica, sin red ni base de datos real cuando no sea necesario.
6. Documentar variables nuevas con valores ficticios en `.env.example` cuando el Bloque 1 autorice crearlo.

## Verificación manual sugerida

- Ejecutar `npm run build`.
- Ejecutar `npm run lint -- --no-fix` y comparar con la línea base documentada.
- Ejecutar `npm test -- --runInBand` y `npm run test:e2e -- --runInBand`.
- Ejecutar `npx prisma validate`.
- Revisar `git diff -- AGENTS.md docs/architecture/current-state.md` y confirmar que no hay cambios en `src/`, `prisma/`, dependencias ni `.env`.
