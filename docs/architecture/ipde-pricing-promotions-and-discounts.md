# Precios, promociones y descuentos IPDE

## Propósito

El Bloque 7 agrega una capa manual y versionada para precios, promociones y descuentos de IPDE. El motor puede calcular cotizaciones desde JSON validado, persistir el monto informado en `IpdeOrder.quotedAmount` y producir acciones salientes tipadas para precio, descuento o precio no disponible.

No llama OpenAI para calcular importes, no modifica WhatsApp, no envía medios de pago, no procesa comprobantes y no cambia Prisma.

## Archivo de configuración

La fuente autoritativa es:

```text
config/ipde/pricing-promotions.json
```

También existe:

```text
config/ipde/pricing-promotions.example.json
```

La ruta puede reemplazarse con:

```dotenv
IPDE_PRICING_PROMOTIONS_PATH=./config/ipde/pricing-promotions.json
```

El JSON real contiene reglas manuales iniciales basadas en los ejemplos del Bloque 7. Las notas de cada regla recuerdan que deben reemplazarse por precios comerciales aprobados antes de producción.

## Estructura de reglas

Cada regla contiene:

- `id` estable;
- `active`;
- `priority`;
- `categoryCode` o `ANY`;
- `productTypeCode` o `ANY`;
- `issuerCode` o `ANY`;
- `issuerVariantCode` o `ANY`;
- `minQuantity` y `maxQuantity`;
- `regularAmount`;
- `promotionalAmount`;
- `minimumAuthorizedAmount`;
- etiquetas opcionales de promoción;
- vigencia opcional `validFrom` y `validUntil`;
- notas internas.

Los importes viven como string decimal en JSON y se convierten a `Prisma.Decimal` para cálculo. No se usan floats.

## Validación

`IpdePricingConfigSchema` rechaza campos extra, moneda distinta de `PEN`, IDs duplicados, cantidades inválidas, importes no positivos o con más de dos decimales, rangos comerciales invertidos, vigencias incoherentes y reglas activas duplicadas con la misma combinación exacta y rangos solapados.

El loader valida referencias cruzadas con `commercial-config.json`: productos activos, categorías existentes, emisores activos, variantes activas, pertenencia de variante a emisor y compatibilidad de producto/categoría con variante.

Una configuración inválida impide iniciar el módulo y hace fallar el CLI.

## Selección de reglas

Para cada ítem del pedido:

1. se consideran solo reglas activas y vigentes;
2. la cantidad compatible es la cantidad total de ítems activos;
3. `ANY` actúa como comodín explícito;
4. categoría exacta gana a `ANY`;
5. producto exacto gana a `CURSO` base y `ANY`;
6. una regla `CURSO` puede aplicar a `CURSO_CAPACITACION`, `CURSO_ACTUALIZACION` y `CURSO_ESPECIALIZACION` si no hay una regla más específica;
7. emisor y variante exactos ganan a `ANY`;
8. mayor `priority` gana entre reglas de igual especificidad;
9. un empate real lanza `AMBIGUOUS_PRICING_RULE`.

Si no hay regla para todos los ítems, la cotización queda `NO_MATCH` o `PARTIAL`. En esos casos el motor no inventa totales finales.

## Descuento

`IpdeDiscountPolicyService` calcula descuentos desde una cotización completa:

- si el precio promocional total está sobre el mínimo total, ofrece el mínimo;
- si ya está en el mínimo, informa que ya se está manejando el mejor precio disponible;
- si la cotización está incompleta, no ofrece descuento automático.

El mínimo autorizado nunca se expone en acciones salientes ni borradores.

## Acciones salientes

Se añadieron tres acciones estrictas:

- `QUOTE_PRICE`: informa regular/promocional, regla aplicada y copy de precio; no incluye mínimo.
- `QUOTE_DISCOUNT`: informa monto actual, monto con descuento y disponibilidad; no incluye mínimo.
- `PRICE_NOT_AVAILABLE`: explica falta de tema, producto, emisor, regla o cotización parcial sin mencionar configuración interna.

`REQUEST_PAYMENT_METHODS` sigue diferido con razón `PAYMENT_METHODS_NOT_CONFIGURED`.

## Persistencia

El planner produce `quoteMutation` cuando se informa un precio completo o un descuento disponible. `IpdeTurnPersistenceService` es el único writer y guarda:

- `quotedAmount`: precio promocional o descuento finalmente informado;
- `currencyCode`: `PEN`;
- `quoteConfirmedAt`: `null` mientras solo se informa precio.

Una cotización confirmada no se sobrescribe salvo corrección explícita. Este bloque no cambia `paymentStatus` ni avanza a `WAITING_FOR_PAYMENT`.

## CLI

```bash
npm run ipde:pricing:validate
```

El comando solo lee `pricing-promotions.json` y `commercial-config.json`, valida Zod y referencias cruzadas, y devuelve código distinto de cero ante errores. No inicia Nest, no se conecta a PostgreSQL, no llama OpenAI o Meta y no escribe archivos.

## Fuera de alcance

- medios de pago;
- comprobantes;
- aprobación de pagos;
- endpoints o panel de administración;
- envío real de promociones visuales, PDFs o imágenes;
- modificación de `WhatsappService`;
- cambios en Prisma o migraciones.
