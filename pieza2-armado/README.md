# Pieza 2 — Armado del buzón (Romance / "el mate que te debo")

Remotion (React + TypeScript). Composición principal: `ArmadoBTL` (1920x1080, 30 fps, 1380 frames).

- Textos: `src/config.ts` (todo, incluido el dato y la fuente).
- Línea de tiempo: `T` y `SUPER_RANGOS` en `src/config.ts`.
- Estudio: `npm start`
- Render completo: `node scripts/render.mjs all` (`stills`, `video`, `placas`, `supers` por separado).
- Si el Chromium de Remotion no puede bajar las fuentes de Google (proxy con CA propio):
  `BROWSER_EXECUTABLE=/usr/bin/google-chrome node scripts/render.mjs all`

## Mapa de CABA
Vectorial propio, generado con `python3 scripts/build_map.py CABA_rc.geojson` (necesita `pip install shapely`).
Fuente de datos: radios censales de la Ciudad de Buenos Aires (INDEC / GCBA, datos abiertos),
`https://bitsandbricks.github.io/data/CABA_rc.geojson`. Resultado en `src/mapdata.json`.
Los 150 puntos son posiciones simuladas, ponderadas por población (no son locales reales).
