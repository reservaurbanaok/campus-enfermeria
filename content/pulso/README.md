# Fuente de contenido PULSO

Sólo se guardan aquí piezas aprobadas para publicar. Los borradores, permisos,
consentimientos y registros internos deben quedar fuera del repositorio público.

Crear un archivo JSON por artículo:

```json
{
  "status": "approved",
  "slug": "slug-unico",
  "type": "Artículo",
  "title": "Título",
  "summary": "Bajada",
  "author": "Autoría aprobada",
  "date": "2026-10-23",
  "updated": "2026-10-24",
  "image": "assets/imagen.jpg",
  "body": ["Párrafo uno.", "Párrafo dos."],
  "sources": ["Fuente completa 1", "Fuente completa 2"]
}
```

`updated` e `image` son opcionales. `slug` no puede repetirse. La imagen, si se
usa, debe existir dentro de esta carpeta. Después ejecutar desde la raíz:

```powershell
python tools/generate_pulso.py
```

El generador produce la portada y el artículo propio; no se editan manualmente
los HTML generados.
