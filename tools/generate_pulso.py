"""Generate the static PULSO editorial section from approved JSON content."""

from __future__ import annotations

import argparse
import html
import json
import shutil
import sys
from datetime import date
from pathlib import Path


REQUIRED = ("type", "title", "summary", "author", "date", "body", "sources", "slug")
HOME_START = "<!-- PULSO_HOME_START -->"
HOME_END = "<!-- PULSO_HOME_END -->"


def fail(message: str) -> None:
    raise SystemExit(f"PULSO ERROR: {message}")


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def load_cover(item: dict, source_dir: Path) -> dict | None:
    cover_image = item.get("cover_image") or item.get("image")
    if not cover_image:
        return None
    if not isinstance(cover_image, str) or cover_image != cover_image.strip():
        fail(f"cover_image inválida en {item.get('slug', '<sin-slug>')}")
    cover_path = source_dir / cover_image
    if not cover_path.is_file():
        fail(f"imagen de portada local referenciada inexistente: {cover_path}")
    cover_alt = item.get("cover_alt")
    if not isinstance(cover_alt, str) or not cover_alt.strip():
        fail(f"cover_alt obligatorio cuando existe cover_image en {item.get('slug', '<sin-slug>')}")
    cover_credit = item.get("cover_credit")
    if not isinstance(cover_credit, str) or not cover_credit.strip():
        fail(f"cover_credit obligatorio cuando existe cover_image en {item.get('slug', '<sin-slug>')}")
    cover_caption = item.get("cover_caption", "")
    if cover_caption and not isinstance(cover_caption, str):
        fail(f"cover_caption inválido en {item.get('slug', '<sin-slug>')}")
    return {
        "filename": cover_path.name,
        "source": cover_path,
        "alt": cover_alt,
        "credit": cover_credit,
        "caption": cover_caption,
    }


def load_articles(source_dir: Path, include_demo: bool) -> list[dict]:
    files = sorted(source_dir.rglob("*.json")) if source_dir.exists() else []
    articles: list[dict] = []
    seen: set[str] = set()
    for path in files:
        try:
            item = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            fail(f"JSON inválido en {path}: {exc}")
        if not isinstance(item, dict):
            fail(f"el contenido debe ser un objeto JSON: {path}")
        status = item.get("status", "approved")
        if status == "draft":
            continue
        if status == "demo" and not include_demo:
            continue
        if status not in {"approved", "demo"}:
            fail(f"status no permitido en {path}: {status}")
        missing = [field for field in REQUIRED if field not in item]
        if missing:
            fail(f"faltan campos obligatorios en {path}: {', '.join(missing)}")
        slug = item["slug"]
        if not isinstance(slug, str) or not slug or slug != slug.strip() or "/" in slug or "\\" in slug:
            fail(f"slug inválido en {path}")
        if slug in seen:
            fail(f"slug duplicado: {slug}")
        seen.add(slug)
        if not isinstance(item["body"], list) or not item["body"]:
            fail(f"body debe ser una lista no vacía en {path}")
        if not all(isinstance(paragraph, str) and paragraph.strip() for paragraph in item["body"]):
            fail(f"body contiene párrafos vacíos o inválidos en {path}")
        if not isinstance(item["sources"], list) or not item["sources"]:
            fail(f"sources debe ser una lista no vacía en {path}")
        item["_cover"] = load_cover(item, source_dir)
        item["_source"] = path
        articles.append(item)
    articles.sort(key=lambda item: (item["date"], item["slug"]), reverse=True)
    return articles


def render_article(item: dict, template: str, output_dir: Path) -> None:
    slug = item["slug"]
    body = "\n".join(f"<p>{esc(paragraph)}</p>" for paragraph in item["body"])
    sources = "\n".join(f"<li>{esc(source)}</li>" for source in item["sources"])
    cover = item.get("_cover")
    image = render_cover(cover, "../assets/")
    updated = f'<p class="pulso-updated">Actualizado: {esc(item["updated"])}</p>' if item.get("updated") else ""
    values = {
        "TITLE": esc(item["title"]),
        "TYPE": esc(item["type"]),
        "SUMMARY": esc(item["summary"]),
        "AUTHOR": esc(item["author"]),
        "DATE": esc(item["date"]),
        "IMAGE": image,
        "BODY": body,
        "SOURCES": sources,
        "UPDATED": updated,
        "DEMO": '<span class="pulso-demo">DEMOSTRACIÓN LOCAL</span>' if item.get("status") == "demo" else "",
    }
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{{" + key + "}}", value)
    target = output_dir / "publicaciones" / f"{slug}.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(rendered, encoding="utf-8")


def render_cover(cover: dict | None, asset_prefix: str) -> str:
    if not cover:
        return ""
    caption = []
    if cover["caption"]:
        caption.append(esc(cover["caption"]))
    caption.append(f'<span class="pulso-cover-credit">Crédito: {esc(cover["credit"])}</span>')
    figcaption = f'<figcaption>{" · ".join(caption)}</figcaption>'
    return (
        f'<figure class="pulso-cover"><img class="pulso-article-image" '
        f'src="{esc(asset_prefix + cover["filename"])}" alt="{esc(cover["alt"])}" loading="lazy">'
        f'{figcaption}</figure>'
    )


def render_index(articles: list[dict], output_dir: Path) -> None:
    cards = []
    for item in articles:
        image = render_cover(item.get("_cover"), "assets/")
        demo = '<span class="pulso-demo">DEMOSTRACIÓN LOCAL</span>' if item.get("status") == "demo" else ""
        cards.append(
            f'<article class="pulso-card">{image}<div class="pulso-card-body">'
            f'<p class="pulso-kicker">{esc(item["type"])} · {esc(item["date"])}</p>'
            f'<h2><a href="publicaciones/{esc(item["slug"])}.html">{esc(item["title"])}</a></h2>'
            f'<p>{esc(item["summary"])}</p><p class="pulso-byline">{esc(item["author"])}</p>{demo}'
            "</div></article>"
        )
    listing = "\n".join(cards) or '<p class="pulso-empty">Todavía no hay publicaciones aprobadas.</p>'
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "index.html").write_text(
        """<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PULSO · Campus Profesional</title><link rel="stylesheet" href="styles.css"></head><body><header class="pulso-header"><a href="../index.html">← Campus Profesional</a></header><main class="pulso-shell"><div class="pulso-main-brand pulso-lockup" aria-label="PULSO"><img class="pulso-isotipo" src="assets/pulso-isotipo.png" alt=""><span class="pulso-wordmark"><strong>PULSO</strong><span>Salud desde adentro</span></span></div><p class="pulso-intro">Artículos, entrevistas e investigaciones para comprender y transformar la práctica profesional.</p><div class="pulso-section-heading">Publicaciones</div><section class="pulso-grid" aria-label="Publicaciones">"""
        + listing
        + """</section></main></body></html>""",
        encoding="utf-8",
    )


def latest_dated_article(articles: list[dict]) -> dict | None:
    dated = []
    for item in articles:
        try:
            parsed = date.fromisoformat(str(item["date"]))
        except ValueError:
            continue
        dated.append((parsed, str(item["slug"]), item))
    if not dated:
        return None
    dated.sort(key=lambda entry: (entry[0], entry[1]), reverse=True)
    return dated[0][2]


def render_home_section(articles: list[dict], repo_root: Path) -> None:
    index_path = repo_root / "index.html"
    if not index_path.is_file():
        fail(f"no existe la portada de Campus: {index_path}")
    source = index_path.read_text(encoding="utf-8")
    start = source.find(HOME_START)
    end = source.find(HOME_END)
    if start < 0 or end < 0 or end < start:
        fail("no se encontraron los marcadores delimitados del bloque PULSO en index.html")

    item = latest_dated_article(articles)
    if item is None:
        feature = '<p class="pulso-home-empty">Todavía no hay publicaciones aprobadas con fecha de publicación.</p>'
    else:
        feature = (
            f'<p class="pulso-home-kicker">{esc(item["type"])} · {esc(item["date"])}</p>'
            f'<h3>{esc(item["title"])}</h3>'
            f'<p class="pulso-home-summary">{esc(item["summary"])}</p>'
            f'<p class="pulso-home-byline">Por {esc(item["author"])}</p>'
            f'<a class="pulso-home-read" href="pulso/publicaciones/{esc(item["slug"])}.html">Leer artículo <span aria-hidden="true">→</span></a>'
        )

    block = f'''{HOME_START}
<section id="pulso-home" aria-labelledby="pulso-home-title">
  <div class="pulso-home-inner">
    <div class="pulso-home-lockup">
      <img src="pulso/assets/pulso-isotipo.png" alt="" class="pulso-home-isotipo">
      <div>
        <h2 id="pulso-home-title">PULSO</h2>
        <p>Salud desde adentro</p>
      </div>
    </div>
    <div class="pulso-home-content">
      <div>
        <p class="pulso-home-description">Voces, ideas y evidencia para pensar nuestra profesión.</p>
        <p class="pulso-home-label">Publicación destacada</p>
      </div>
      <article class="pulso-home-feature">
        {feature}
      </article>
    </div>
    <a class="pulso-home-explore" href="pulso/">Explorar PULSO <span aria-hidden="true">→</span></a>
  </div>
</section>
{HOME_END}'''
    replacement_end = end + len(HOME_END)
    updated = source[:start] + block + source[replacement_end:]
    if updated != source:
        index_path.write_text(updated, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera y valida PULSO desde archivos JSON.")
    parser.add_argument("--source-dir", type=Path, default=Path("content/pulso"))
    parser.add_argument("--output-dir", type=Path, default=Path("pulso"))
    parser.add_argument("--include-demo", action="store_true")
    args = parser.parse_args()
    source_dir = args.source_dir.resolve()
    output_dir = args.output_dir.resolve()
    repo_root = Path.cwd().resolve()
    public_dir = (repo_root / "pulso").resolve()
    if args.include_demo and output_dir == public_dir:
        fail("la demostración sólo puede generarse fuera de /pulso")
    template_path = repo_root / "pulso" / "templates" / "article.html"
    if not template_path.is_file():
        fail(f"no existe la plantilla: {template_path}")
    articles = load_articles(source_dir, args.include_demo)
    if any(item.get("status") == "demo" for item in articles) and output_dir == public_dir:
        fail("una demostración no puede entrar en la salida publicable")
    if output_dir.exists():
        for path in (output_dir / "publicaciones", output_dir / "assets"):
            if path.exists():
                shutil.rmtree(path)
    output_dir.mkdir(parents=True, exist_ok=True)
    styles_source = repo_root / "pulso" / "styles.css"
    styles_target = output_dir / "styles.css"
    if styles_source.resolve() != styles_target.resolve():
        shutil.copy2(styles_source, styles_target)
    logo_source = repo_root / "content" / "pulso" / "assets" / "pulso-isotipo.png"
    if not logo_source.is_file():
        fail(f"no existe el isotipo canónico: {logo_source}")
    (output_dir / "assets").mkdir(parents=True, exist_ok=True)
    shutil.copy2(logo_source, output_dir / "assets" / "pulso-isotipo.png")
    for item in articles:
        if item.get("_cover"):
            assets = output_dir / "assets"
            assets.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item["_cover"]["source"], assets / item["_cover"]["filename"])
        render_article(item, template_path.read_text(encoding="utf-8"), output_dir)
    render_index(articles, output_dir)
    # A private preview may use the same generator with a separate source/output
    # directory. Never let preview-only or demo content rewrite Campus' public
    # home block; only the canonical public output may update that region.
    if output_dir == public_dir:
        render_home_section(articles, repo_root)
    print(f"PULSO OK: {len(articles)} publicación(es), salida {output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
