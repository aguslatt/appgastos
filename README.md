# Cuánto

App para anotar gastos **como en una calculadora** y ver, de un vistazo, **cuánto gastás** cada mes. Funciona en el celular (se instala como una app), no necesita internet ni cuentas, y guarda todo en el propio teléfono.

## Qué hace

- **Inicio = calculadora.** Se abre lista para tipear. Un monto, un toque en una carpeta y el gasto queda guardado (con "Deshacer"). Hay operadores de verdad: `÷` para dividir la cuenta, `%` para sumar la propina (`25000 + 10%`).
- **Carpetas con IA en el teléfono.** Escribí o dictá "propina", "uber", "farmacia"… y la app elige la carpeta. Entiende jerga, marcas y errores de tipeo, y **aprende** cuando la corregís. También entiende frases enteras: `uber 4500 ayer`, `tres mil quinientos propina`, `2 lucas el súper`.
- **Contexto en vivo.** Mientras tipeás muestra qué porcentaje del presupuesto es, cuánto queda por día, si pasa el tope de la carpeta y (opcional) cuántas horas de trabajo cuesta.
- **Mes.** Total gastado, comparación con el mes anterior *a la misma altura*, presupuesto con medidor, cierre estimado, calendario de calor día por día, desglose por carpeta y datos curiosos.
- **Resumen en historias.** A fin de mes (o cuando quieras) un recorrido de slides: "¿ahorrando o sabotándote?", carpeta estrella, el gasto más grande, tu hábito del mes, tu día más caro, días sin gastar y lo que viene.
- **Pagos fijos** (alquiler, servicios, suscripciones) que se anotan solos el día que corresponde.
- **Metas.** Un viaje (destinos, días, personas, estilo), una mudanza (zona, alquiler, depósito y costos de entrada) u otra cosa que quieras juntar. Te dice cuánto guardar por mes y lo compara con tu ingreso y tu forma real de gastar: *vas bien*, *justo* o *no alcanza* (con recortes sugeridos o una fecha más lejana). En **Mes** se ve si el ritmo actual deja guardar lo que piden tus metas.
- **IA con búsqueda en internet (opcional).** Con tu propia clave de Anthropic, la meta de viaje o de mudanza busca precios de ahora (pasajes, un día en cada destino, alquileres y expensas de la zona) y completa los datos. Sin clave, todo sigue funcionando con estimaciones de referencia.
- **Historial** con búsqueda y filtros, copia de seguridad, exportar a planilla (CSV), tema claro/oscuro.

## IA con búsqueda en internet (opcional)

Las estimaciones de las metas arrancan con una tabla de referencia que viene en la app (precios aproximados en dólares por destino y estilo). Para tener precios **de ahora**, y de **cualquier** lugar, se puede conectar la IA de Claude con búsqueda web:

1. Creá una clave en [console.anthropic.com](https://console.anthropic.com/settings/keys) y cargá saldo en tu cuenta.
2. Pegala en *Ajustes → IA con búsqueda en internet* (o directo en el panel que aparece al armar una meta). Se prueba antes de guardarse, sin costo.
3. Al armar un viaje o una mudanza tocá **Buscar precios**: ves en vivo qué está buscando, y al final el resultado con sus **fuentes**. Nada se carga hasta que tocás *Usar estos valores*, y después podés ajustar cada número.

Cómo funciona y qué tener en cuenta:

- **Tu clave queda solo en tu teléfono**, aparte de tus datos: no entra en las copias de seguridad ni en la planilla CSV, y *Borrar todo* también la elimina. Las consultas van **directo del teléfono a Anthropic**, sin servidor intermedio.
- **Qué se envía:** la zona o el destino, los días, las personas, el mes, el estilo, la ciudad de salida (si la escribís) y la moneda. **Nunca** tus gastos, tu ingreso, tu presupuesto ni tus metas. Un test verifica que el armado de la consulta no pueda incluir otros datos.
- **Costo:** cada consulta usa saldo de tu cuenta de Anthropic (suele ser una fracción de dólar). Hay dos modelos a elegir: *Opus 5.5* (más preciso, el predeterminado) y *Sonnet 5.5* (más rápido y barato). Se limita a 5 búsquedas por consulta.
- **Honestidad con los números:** cada resultado dice qué tan respaldado está (*bien respaldado*, *aproximado* o *poco seguro*) y si hubo búsqueda en vivo. Si tu cuenta no tiene la búsqueda web habilitada, la app lo detecta, responde con lo que el modelo ya sabe y lo avisa. Las respuestas se validan (rangos razonables, montos numéricos) antes de mostrarse; lo que no cierra se descarta.
- **Instalación liviana:** el código de la IA (el SDK oficial, ~50 KB comprimido) se descarga recién la primera vez que la usás y no forma parte de la instalación offline.
- **Estado de la integración:** el cliente usa el SDK oficial de Anthropic y está probado con respuestas simuladas del formato de la API (en pruebas unitarias y en un navegador real con la red interceptada). Si tu cuenta responde algo inesperado, el mensaje de error lo dice en castellano.

## Probarla en el celular

1. Publicá la app (ver *Publicar* más abajo) y abrí el link desde el teléfono.
2. **Android (Chrome):** menú ⋮ → *Instalar app*. **iPhone (Safari):** Compartir → *Agregar a pantalla de inicio*.
3. Abrila desde el ícono. En iPhone, empezá a cargar gastos **después** de instalarla: la versión instalada y la de Safari guardan sus datos por separado.

> Tus datos viven solo en el teléfono. Si cambiás de equipo o borrás los datos del navegador, se pierden: usá *Ajustes → Guardar copia de seguridad* de vez en cuando.

## Desarrollo

Requiere Node 22 o más nuevo.

```bash
npm install
npm run dev        # servidor de desarrollo
npm test           # tests (lógica de dinero, fechas, IA, estadísticas, insights…)
npm run typecheck  # TypeScript
npm run build      # genera dist/ con el service worker (modo offline)
npm run preview    # sirve dist/ para probar la instalación y el modo offline
```

### Estructura

```
src/lib        lógica pura y testeada (calc, classifier, phrase, stats, insights, goals, trips, store…)
src/lib/ai     la IA opcional: consulta con el SDK de Anthropic, prompts, validación de respuestas, errores
src/state      store local, hooks y estado de la interfaz
src/components piezas de interfaz (calculadora, hojas, gráficos, historias)
src/screens    Anotar, Mes, Historial, Ajustes
src/styles     tokens de diseño (claro/oscuro) y estilos
scripts        plugin que genera el service worker en el build
public         manifiesto e íconos
```

Las decisiones de diseño (paleta verde, tipografía Plus Jakarta Sans embebida para funcionar sin internet) están en `src/styles/tokens.css`; un test verifica el contraste de color en claro y oscuro.

### Cambiar el nombre

El nombre "Cuánto" aparece en `index.html`, `public/manifest.webmanifest`, `src/lib/backup.ts` (nombre de los archivos) y `scripts/sw-template.js` (nombre de la caché).

## Publicar (GitHub Pages)

El flujo `.github/workflows/deploy.yml` construye y publica la app cada vez que se actualiza la rama `main`. Para activarlo una sola vez: en GitHub, **Settings → Pages → Source: GitHub Actions**. El link queda en `https://<usuario>.github.io/<repositorio>/`.

## Privacidad

No hay servidores, cuentas ni analíticas. La app no hace pedidos de red salvo para descargarse a sí misma y, **solo si conectás tu clave y tocás *Buscar precios***, para consultar a Anthropic con lo que se detalla en la sección de la IA. El dictado por voz usa el reconocimiento del navegador, que según el equipo puede procesarse en los servidores de Google o Apple; el teclado del teléfono tiene su propio micrófono si preferís no usarlo.
