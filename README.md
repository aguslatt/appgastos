# Cuánto

App para anotar gastos **como en una calculadora** y ver, de un vistazo, **cuánto gastás** cada mes. Funciona en el celular (se instala como una app), no necesita internet ni cuentas, y guarda todo en el propio teléfono.

## Qué hace

- **Inicio = calculadora.** Se abre lista para tipear. Un monto, un toque en una carpeta y el gasto queda guardado (con "Deshacer"). Hay operadores de verdad: `÷` para dividir la cuenta, `%` para sumar la propina (`25000 + 10%`).
- **Carpetas con IA en el teléfono.** Escribí o dictá "propina", "uber", "farmacia"… y la app elige la carpeta. Entiende jerga, marcas y errores de tipeo, y **aprende** cuando la corregís. También entiende frases enteras: `uber 4500 ayer`, `tres mil quinientos propina`, `2 lucas el súper`.
- **Contexto en vivo.** Mientras tipeás muestra qué porcentaje del presupuesto es, cuánto queda por día, si pasa el tope de la carpeta y (opcional) cuántas horas de trabajo cuesta.
- **Mes.** Total gastado, comparación con el mes anterior *a la misma altura*, presupuesto con medidor, cierre estimado, calendario de calor día por día, desglose por carpeta y datos curiosos.
- **Resumen en historias.** A fin de mes (o cuando quieras) un recorrido de slides: "¿ahorrando o sabotándote?", carpeta estrella, el gasto más grande, tu hábito del mes, tu día más caro, días sin gastar y lo que viene.
- **Pagos fijos** (alquiler, servicios, suscripciones) que se anotan solos el día que corresponde.
- **Historial** con búsqueda y filtros, copia de seguridad, exportar a planilla (CSV), tema claro/oscuro.

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
src/lib        lógica pura y testeada (calc, classifier, phrase, stats, insights, store…)
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

No hay servidores, cuentas ni analíticas. La app no hace pedidos de red salvo para descargarse a sí misma. El dictado por voz usa el reconocimiento del navegador, que según el equipo puede procesarse en los servidores de Google o Apple; el teclado del teléfono tiene su propio micrófono si preferís no usarlo.
