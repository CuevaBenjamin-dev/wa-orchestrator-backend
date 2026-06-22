# AGENTS.md

## Propósito

Este repositorio implementa un backend orquestador conversacional multi-tenant para WhatsApp. Cada tenant puede tener configuración propia, reglas, respuestas predefinidas, conocimiento, catálogo, precios, recursos multimedia, estados conversacionales y consumo medido.

## Principios de arquitectura

- Mantener la separación por módulos de NestJS.
- Limitar los controllers al transporte HTTP y la validación. Colocar la lógica de aplicación en services y la persistencia o los servicios externos en repositories o gateways.
- No consultar Prisma, llamar OpenAI ni llamar Meta directamente desde controllers.
- Mantener una sola instancia compartida de `PrismaService`.
- No mezclar lógica específica de IPDE dentro de servicios genéricos cuando pueda encapsularse en un módulo, configuración o adaptador del tenant.
- Mantener aislamiento estricto por `tenantId`. Toda consulta multi-tenant debe filtrar por `tenantId`.
- Nunca confiar en un identificador recibido del cliente sin validar que el recurso pertenece al tenant activo.

## Fuente de verdad de IPDE

Usar este orden de prioridad:

1. Configuración manual versionada en Git.
2. Catálogo persistente generado en Railway Volume.
3. Generación nueva mediante OpenAI.

No usar búsqueda web salvo que una tarea futura lo autorice expresamente. No sobrescribir el catálogo manual con contenido generado.

- Identificar la configuración de IPDE mediante el código estable `IPDE`, nunca mediante el nombre visible.
- Validar con los esquemas Zod centralizados toda entrada manual o generada.
- Cada `SubjectCatalogEntry` debe contener exactamente 25 temas activos.

## Reglas de IA

- OpenAI interpreta lenguaje natural; no controla precios ni confirma pagos.
- OpenAI no debe inventar instituciones, resoluciones, firmas, sellos, promociones ni archivos.
- Validar mediante esquemas todas las salidas de IA que utilice la lógica de negocio.
- Toda llamada a OpenAI debe tener timeout, manejo de errores y fallback.
- No registrar API keys, access tokens ni prompts con datos sensibles completos.
- Limitar el contexto al mínimo necesario, no enviar historiales completos y medir tokens.

## Reglas de WhatsApp

- Nunca enviar mensajes reales desde pruebas automatizadas.
- Respetar `WHATSAPP_SEND_ENABLED` en todo envío.
- Mantener idempotencia mediante el ID externo de WhatsApp.
- No responder si la conversación está en pausa humana.
- No afirmar que un pago o comprobante es válido.
- Después de recibir un comprobante, enviar un último mensaje informativo y pausar el agente para revisión humana.

## Reglas de Railway Volume

- El MVP opera con una sola instancia.
- Encapsular todo acceso al volumen en una abstracción de almacenamiento; no dispersar llamadas directas a `fs`.
- Usar una ruta configurable. En Railway, priorizar `RAILWAY_VOLUME_MOUNT_PATH`; en local, usar un directorio del proyecto ignorado por Git.
- Validar todos los JSON antes de usarlos y escribir archivos de forma atómica.
- No sobrescribir el catálogo manual.
- Un archivo generado corrupto no debe impedir el arranque de toda la aplicación.
- No escribir en el volumen durante build o pre-deploy.

## Base de datos y Prisma

- No modificar migraciones ya aplicadas. Crear migraciones nuevas, descriptivas y compatibles con la versión instalada de Prisma.
- Usar `prisma migrate dev` solamente en desarrollo y `prisma migrate deploy` en producción.
- Regenerar Prisma Client después de cambiar `schema.prisma`.
- En Windows, detener procesos Node o Prisma Studio que bloqueen el engine antes de regenerar.
- No ejecutar `prisma migrate reset`, borrar datos ni alterar datos existentes sin autorización explícita.

## Seguridad

- No mostrar ni versionar secretos. Mantener `.env` ignorado.
- Crear o actualizar `.env.example` únicamente con valores ficticios.
- No exponer endpoints administrativos sin protección explícita.
- No añadir endpoints temporales públicos sin documentarlos y protegerlos.
- No almacenar comprobantes ni datos personales en logs.
- Validar DTOs y aplicar límites razonables al tamaño de textos y archivos.

## Forma de trabajar

Antes de implementar una tarea:

1. Inspeccionar el código relevante y explicar brevemente el plan.
2. Reutilizar convenciones existentes.
3. Hacer cambios mínimos y enfocados.
4. Agregar o actualizar pruebas sin realizar envíos externos reales.
5. Ejecutar build, validación de TypeScript, lint, tests relacionados y `npx prisma validate` cuando corresponda.
6. Revisar el diff y comprobar que no contiene secretos ni cambios accidentales.
7. Informar archivos modificados, decisiones, riesgos, pendientes e instrucciones de verificación manual.

## Definición de terminado

Una tarea no está terminada hasta que:

- compila y pasa la validación de TypeScript;
- pasa lint, salvo fallos preexistentes documentados;
- pasan los tests relacionados;
- no contiene secretos;
- no rompe el webhook existente ni el aislamiento por tenant;
- no envía mensajes reales durante pruebas;
- incluye instrucciones de verificación manual.
