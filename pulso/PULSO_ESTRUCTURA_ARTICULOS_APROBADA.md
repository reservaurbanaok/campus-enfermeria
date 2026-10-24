# PULSO · estructura editorial aprobada

Reglas permanentes para la integración estática de artículos:

- La fuente es un JSON por pieza en `content/pulso/`.
- `body` es una lista de párrafos editoriales; cada elemento produce un `<p>` y sus límites deben conservar la versión aprobada.
- La salida se genera exclusivamente con `python tools/generate_pulso.py`; no se editan manualmente `pulso/index.html` ni los artículos.
- Sólo `status: approved` entra en `/pulso/`. Demos, borradores, capturas, consentimientos y registros internos quedan fuera del repositorio y de la salida publicable.
- `date` no se inventa. Cuando no existe fecha de publicación aprobada, se conserva `Sin fecha de publicación`.
- El bloque destacado de Campus usa la fecha ISO más reciente; si hay empate, elige `slug` en orden descendente. Las piezas sin fecha ISO no se muestran como destacadas.
- La portada es opcional. Si existe, se declara con `cover_image`, `cover_alt` y `cover_credit`; `cover_caption` es opcional. El generador exige el archivo local, texto alternativo y crédito antes de incorporarla al índice y al artículo.
- Sin portada autorizada, el artículo se genera sin placeholder ni imagen sustituta.
- El cuerpo usa lectura editorial: mínimo 18 px, interlineado aproximado 1,65–1,70, columna de 60–70 caracteres, justificación con separación silábica cuando el navegador la admite y última línea alineada a la izquierda.
