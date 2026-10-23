# PULSO

La sección se genera desde archivos JSON aprobados ubicados en `content/pulso/`.
La salida publicada es `pulso/`; no editar manualmente `pulso/index.html` ni los
artículos generados.

Cada contenido debe incluir `type`, `title`, `summary`, `author`, `date`, `slug`,
`body` como lista de párrafos y `sources` como lista de fuentes. `image` y
`updated` son opcionales. Sólo `status: approved` entra en la salida pública.

Los borradores, consentimientos y registros internos deben conservarse fuera del
repositorio público. La demostración local se genera desde `.pulso-local/demo/`
y nunca puede escribirse directamente en `pulso/`.

Comando único de generación y validación:

```powershell
python tools/generate_pulso.py
```
