# PULSO

La sección se genera desde archivos JSON aprobados ubicados en `content/pulso/`.
La salida publicada es `pulso/`; no editar manualmente `pulso/index.html` ni los
artículos generados.

Cada contenido debe incluir `type`, `title`, `summary`, `author`, `date`, `slug`,
`body` como lista de párrafos y `sources` como lista de fuentes. `image` y
`updated` son opcionales. Sólo `status: approved` entra en la salida pública.

Al generar, la publicación aprobada con fecha ISO más reciente se refleja
también en el bloque delimitado `PULSO_HOME_START/END` de la portada de Campus.
El desempate es estable por `slug`, en orden descendente, después de la fecha.

Los borradores, consentimientos y registros internos deben conservarse fuera del
repositorio público. La demostración local se genera desde `.pulso-local/demo/`
y nunca puede escribirse directamente en `pulso/`.

Comando único de generación y validación:

```powershell
python tools/generate_pulso.py
```

Ese único comando actualiza y valida la portada PULSO, sus artículos y el
bloque destacado de PULSO dentro de `index.html`.
