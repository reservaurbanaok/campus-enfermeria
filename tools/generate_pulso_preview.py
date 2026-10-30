"""Generate a private, non-production taxonomy preview for SALUD DESDE ADENTRO."""

from __future__ import annotations

import html
import json
import shutil
from datetime import date
from pathlib import Path

from generate_pulso import load_articles, render_article, render_cover


GROUPS = (
    ("Historias y entrevistas", ("cuidar-tambien-transformar", "carla-scaramella", "entrevista-diabetes-escuela", "entrevista-enfermeria-rio-negro")),
    ("Ciencia y evidencia", ("seguridad-paciente-cultura-justa",)),
    ("Salud y sociedad", ("mas-alla-del-timbre",)),
    ("Opinión", ("carta-del-director", "la-buena-compania-un-bien-no-negociable")),
)
SECTIONS = tuple(section for section, _ in GROUPS)
PARTICIPATION = ("Participación", ("queremos-saber-que-esta-pasando-donde-vos-estas",))
PREVIEW_ROOT = Path("preview/pulso-organizacion-20261030")


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def card(item: dict) -> str:
    href = item.get("external_url") or f"publicaciones/{esc(item['slug'])}.html"
    target = ' target="_blank" rel="noopener noreferrer"' if item.get("external_url") else ""
    image = render_cover(item.get("_cover"), "assets/")
    return (f'<article class="pulso-card">{image}<div class="pulso-card-body">'
            f'<p class="pulso-kicker">{esc(item["type"])}{(" · " + esc(item["date"])) if item.get("date") else ""}</p>'
            f'<h2>{esc(item.get("card_title", item["title"]))}</h2>'
            f'<p>{esc(item.get("card_summary", item["summary"]))}</p>'
            f'<p class="pulso-byline">{esc(item.get("card_author", item["author"]))}</p>'
            f'<a class="pulso-card-cta" href="{esc(href)}"{target}>{esc(item.get("cta", "Leer artículo"))} <span aria-hidden="true">→</span></a>'
            "</div></article>")


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
            article_path = output / "publicaciones" / f'{item["slug"]}.html'
            article_path.write_text(article_path.read_text(encoding="utf-8").replace('href="../../index.html"', 'href="../index.html"'), encoding="utf-8")
    shutil.copy2(repo / "pulso/styles.css", output / "styles.css")
    for asset in (repo / "content/pulso/assets").iterdir():
        if asset.is_file():
            (output / "assets").mkdir(exist_ok=True)
            shutil.copy2(asset, output / "assets" / asset.name)

    by_slug = {item["slug"]: item for item in articles}
    expected = [slug for _, slugs in GROUPS for slug in slugs] + list(PARTICIPATION[1])
    if set(by_slug) != set(expected) or len(expected) != len(set(expected)):
        raise SystemExit("La agrupación no cubre exactamente cada tarjeta una sola vez")
    section_blocks = "".join(
        f'<section class="pulso-preview-group" aria-labelledby="preview-group-{i}">'
        f'<h2 id="preview-group-{i}" class="pulso-preview-group-title">{esc(section.upper())}</h2>'
        f'<div class="pulso-grid">{"".join(card(by_slug[slug]) for slug in slugs)}</div></section>'
        for i, (section, slugs) in enumerate(GROUPS)
    )
    participation_section, participation_slugs = PARTICIPATION
    participation_block = (
        f'<section class="pulso-preview-group pulso-preview-participation" aria-labelledby="preview-participation-title">'
        f'<h2 id="preview-participation-title" class="pulso-preview-group-title">{esc(participation_section.upper())}</h2>'
        f'<div class="pulso-grid">{"".join(card(by_slug[slug]) for slug in participation_slugs)}</div></section>'
    )
    manifest = []
    for item in articles:
        manifest.append({key: item.get(key) for key in ("slug", "title", "type", "date", "author", "external_url", "primary_section", "tags", "listing", "featured", "attribution_note")})
    (output / "preview-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    html_text = f'''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SALUD DESDE ADENTRO · Vista previa agrupada</title><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="preview.css"></head><body><header class="pulso-header"><a href="index.html">← Campus Profesional</a></header><main class="pulso-shell"><p class="pulso-preview-status">Vista previa — propuesta en revisión</p><div class="pulso-main-brand salud-lockup" aria-label="SALUD DESDE ADENTRO"><span class="salud-wordmark">SALUD<br>DESDE ADENTRO</span><span class="salud-tagline">Periodismo, evidencia y pensamiento crítico</span></div><p class="pulso-intro">Historias, entrevistas e investigaciones para comprender y transformar la práctica profesional.</p>{section_blocks}{participation_block}</main></body></html>'''
    (output / "index.html").write_text(html_text, encoding="utf-8")
    (output / "preview.css").write_text('''.pulso-preview-status{margin:0 0 28px;color:#b84e3e;font:700 .72rem/1.2 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase}.pulso-preview-group{margin:44px 0}.pulso-preview-group-title{margin:0 0 18px;padding-top:14px;border-top:1px solid var(--pulso-line);color:var(--pulso-petroleo);font:700 .82rem/1.2 Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase}.pulso-preview-participation{margin-top:56px}.pulso-preview-group .pulso-grid{align-items:stretch}@media (max-width:720px){.pulso-preview-group{margin:34px 0}.pulso-preview-group-title{margin-bottom:14px}}''', encoding="utf-8")
    print(f"PREVIEW_OK: {len(articles)} registros, salida {output}")


if __name__ == "__main__":
    main()
