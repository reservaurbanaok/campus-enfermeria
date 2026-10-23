# PULSO · estructura editorial aprobada

Reglas permanentes para la integración estática de artículos:

- La fuente es un JSON por pieza en `content/pulso/`.
- `body` es una lista de párrafos editoriales; cada elemento produce un `<p>` y sus límites deben conservar la versión aprobada.
- La salida se genera exclusivamente con `python tools/generate_pulso.py`; no se editan manualmente `pulso/index.html` ni los artículos.
- Sólo `status: approved` entra en `/pulso/`. Demos, borradores, capturas, consentimientos y registros internos quedan fuera del repositorio y de la salida publicable.
- `date` no se inventa. Cuando no existe fecha de publicación aprobada, se conserva `Sin fecha de publicación`.
- Las imágenes son opcionales y sólo se referencian si existe el archivo local correspondiente.
- El cuerpo usa lectura editorial: mínimo 18 px, interlineado aproximado 1,65–1,70, columna de 60–70 caracteres, justificación con separación silábica cuando el navegador la admite y última línea alineada a la izquierda.
