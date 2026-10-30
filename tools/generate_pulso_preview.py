"""Generate a private, non-production taxonomy preview for SALUD DESDE ADENTRO."""

from __future__ import annotations

import html
import json
import shutil
from datetime import date
from pathlib import Path

from generate_pulso import load_articles, render_article


SECTIONS = ("Historias y entrevistas", "Ciencia y evidencia", "Salud y sociedad", "Opinión")
PREVIEW_ROOT = Path("preview/pulso-organizacion-20261030")


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def dated(items: list[dict]) -> list[dict]:
    return sorted(
        [item for item in items if item.get("date")],
        key=lambda item: (date.fromisoformat(item["date"]), item["slug"]),
        reverse=True,
    )


def card(item: dict) -> str:
    href = item.get("external_url") or f"publicaciones/{esc(item['slug'])}.html"
    target = ' target="_blank" rel="noopener noreferrer"' if item.get("external_url") else ""
    tags = "|".join(item.get("tags", []))
    date_label = item.get("date") or "Fecha no disponible"
    return (
        f'<article class="preview-card" data-section="{esc(item["primary_section"])}" '
        f'data-tags="{esc(tags)}">'
        f'<p class="preview-kicker">{esc(item["primary_section"])} · {esc(item["type"])}</p>'
        f'<h3>{esc(item["title"])}</h3>'
        f'<p>{esc(item.get("card_summary", item["summary"]))}</p>'
        f'<p class="preview-meta"><strong>Autoría/participación:</strong> {esc(item["author"])}</p>'
        f'<p class="preview-meta"><strong>Fecha:</strong> {esc(date_label)}</p>'
        f'<p class="preview-tags">{" · ".join(esc(tag) for tag in item.get("tags", []))}</p>'
        f'<a href="{esc(href)}"{target}>{esc(item.get("cta", "Abrir pieza"))} →</a>'
        "</article>"
    )


def main() -> None:
    repo = Path.cwd()
    source = repo / "content/pulso"
    output = repo / PREVIEW_ROOT
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    articles = load_articles(source, include_demo=False)
    for item in articles:
        if item.get("primary_section") not in SECTIONS:
            raise SystemExit(f"Clasificación inválida: {item.get('slug')}")
        if not isinstance(item.get("tags"), list) or not item["tags"]:
            raise SystemExit(f"Faltan etiquetas: {item.get('slug')}")
        if item.get("listing") in {"article", "convocatoria"} and not item.get("external_url"):
            render_article(item, (repo / "pulso/templates/article.html").read_text(encoding="utf-8"), output)
    shutil.copy2(repo / "pulso/styles.css", output / "styles.css")
    for asset in (repo / "content/pulso/assets").iterdir():
        if asset.is_file():
            (output / "assets").mkdir(exist_ok=True)
            shutil.copy2(asset, output / "assets" / asset.name)

    editorial = [item for item in articles if item.get("listing") in {"article", "external"}]
    convocatoria = [item for item in articles if item.get("listing") == "convocatoria"]
    featured = [item for item in editorial if item.get("featured")]
    if len(featured) != 1:
        raise SystemExit(f"Debe existir una única publicación destacada; hay {len(featured)}")
    latest = dated(editorial)
    tags = sorted({tag for item in editorial for tag in item.get("tags", [])})
    section_links = "".join(f'<a href="#section-{i}">{esc(section)}</a>' for i, section in enumerate(SECTIONS))
    tag_links = "".join(f'<a href="?tag={esc(tag)}">{esc(tag)}</a>' for tag in tags)
    latest_cards = "".join(card(item) for item in latest)
    section_blocks = ""
    for i, section in enumerate(SECTIONS):
        members = [item for item in editorial if item["primary_section"] == section]
        if members:
            section_blocks += f'<section id="section-{i}" class="preview-section"><h2>{esc(section)}</h2><div class="preview-grid">{"".join(card(item) for item in members)}</div></section>'
    feature = featured[0]
    convocatoria_html = "".join(card(item) for item in convocatoria)
    manifest = []
    for item in articles:
        manifest.append({key: item.get(key) for key in ("slug", "title", "type", "date", "author", "external_url", "primary_section", "tags", "listing", "featured", "attribution_note")})
    (output / "preview-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tag_options = "".join(f'<option value="{esc(tag)}">{esc(tag)}</option>' for tag in tags)
    html_text = f'''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vista previa de organización · SALUD DESDE ADENTRO</title><link rel="stylesheet" href="preview.css"></head><body><main class="preview-shell"><p class="preview-status">VISTA PREVIA PRIVADA · NO PUBLICAR</p><h1>Organización editorial</h1><p class="preview-lead">Propuesta provisional para hacer crecer SALUD DESDE ADENTRO sin alterar sus URLs ni sus contenidos canónicos.</p><section class="preview-feature"><p class="preview-kicker">PUBLICACIÓN DESTACADA</p><h2>{esc(feature['title'])}</h2><p>{esc(feature.get('summary', ''))}</p><a href="{esc('publicaciones/' + feature['slug'] + '.html')}">Abrir publicación destacada →</a></section><nav class="preview-nav" aria-label="Secciones con contenido"><strong>Secciones</strong>{section_links}<strong>Temas</strong>{tag_links}</nav><section class="preview-tools"><label for="preview-filter">Filtrar por tema</label><select id="preview-filter"><option value="">Todos los temas</option>{tag_options}</select><p id="preview-empty" hidden>No hay piezas con este filtro.</p></section><section class="preview-section"><h2>Últimas publicaciones</h2><div class="preview-grid">{latest_cards}</div></section>{section_blocks}<section class="preview-section preview-convocatoria"><h2>Participación</h2><p>Acceso separado de la convocatoria editorial; no forma parte del listado de artículos.</p><div class="preview-grid">{convocatoria_html}</div></section><script>const filter=document.querySelector('#preview-filter');const cards=[...document.querySelectorAll('.preview-card')];const empty=document.querySelector('#preview-empty');function apply(){{const value=filter.value;let shown=0;cards.forEach(card=>{{const ok=!value||card.dataset.tags.split('|').includes(value);card.hidden=!ok;if(ok)shown++;}});empty.hidden=shown!==0;}}filter.addEventListener('change',apply);document.querySelectorAll('.preview-nav a[href^="?tag="]').forEach(link=>link.addEventListener('click',event=>{{event.preventDefault();filter.value=decodeURIComponent(link.search.slice(5));apply();document.querySelector('.preview-tools').scrollIntoView();}}));</script></main></body></html>'''
    (output / "index.html").write_text(html_text, encoding="utf-8")
    (output / "preview.css").write_text('''*{box-sizing:border-box}body{margin:0;overflow-x:hidden;background:#f4efe6;color:#132d35;font:16px/1.5 Arial,sans-serif}.preview-shell{max-width:1180px;margin:auto;padding:36px 24px 80px}.preview-status{color:#b84e3e;font-weight:700;letter-spacing:.12em;overflow-wrap:anywhere}.preview-lead{max-width:680px;font:1.35rem/1.35 Georgia,serif;overflow-wrap:anywhere}.preview-feature{min-width:0;margin:32px 0;padding:28px;background:#12323a;color:#fff;overflow-wrap:anywhere}.preview-feature a,.preview-card a{color:#b84e3e;font-weight:700}.preview-feature a{color:#f2b6a2}.preview-nav{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:28px 0;padding:16px;border-block:1px solid #c9bfb0}.preview-nav strong{flex-basis:100%;text-transform:uppercase;font-size:.75rem;letter-spacing:.12em}.preview-nav a{max-width:100%;padding:7px 10px;border:1px solid #b9aaa0;border-radius:999px;color:#132d35;text-decoration:none;overflow-wrap:anywhere}.preview-tools{margin:20px 0}.preview-tools select{margin-left:8px;padding:8px}.preview-section{margin:44px 0}.preview-section h2{font:700 clamp(2rem,4vw,3rem)/1 Georgia,serif;overflow-wrap:anywhere}.preview-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.preview-card{min-width:0;padding:20px;background:#fffaf2;border:1px solid #d9cec1;overflow-wrap:anywhere}.preview-card h3{font:700 1.55rem/1.05 Georgia,serif;overflow-wrap:anywhere}.preview-card a{text-decoration:underline}.preview-kicker{color:#b84e3e;font-size:.75rem;font-weight:700;letter-spacing:.12em;overflow-wrap:anywhere}.preview-meta,.preview-tags{font-size:.88rem;color:#496066;overflow-wrap:anywhere}.preview-tags{margin-top:16px}@media(max-width:720px){.preview-shell{padding:24px 16px 60px}.preview-grid{grid-template-columns:1fr}.preview-nav{gap:7px}.preview-feature{padding:22px 18px}}''', encoding="utf-8")
    print(f"PREVIEW_OK: {len(articles)} registros, salida {output}")


if __name__ == "__main__":
    main()
