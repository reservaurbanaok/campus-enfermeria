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


def fail(message: str) -> None:
    raise SystemExit(f"PULSO ERROR: {message}")


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


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
        if item.get("image"):
            image = source_dir / item["image"]
            if not image.is_file():
                fail(f"imagen local referenciada inexistente: {image}")
            item["_image_source"] = image
        item["_source"] = path
        articles.append(item)
    articles.sort(key=lambda item: (item["date"], item["slug"]), reverse=True)
    return articles


def render_article(item: dict, template: str, output_dir: Path) -> None:
    slug = item["slug"]
    body = "\n".join(f"<p>{esc(paragraph)}</p>" for paragraph in item["body"])
    sources = "\n".join(f"<li>{esc(source)}</li>" for source in item["sources"])
    image = ""
    if item.get("image"):
        filename = Path(item["image"]).name
        image = f'<img class="pulso-article-image" src="../assets/{esc(filename)}" alt="">'
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


def render_index(articles: list[dict], output_dir: Path) -> None:
    cards = []
    for item in articles:
        image = ""
        if item.get("image"):
            image = f'<img src="assets/{esc(Path(item["image"]).name)}" alt="">'
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
        """<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PULSO · Campus Profesional</title><link rel="stylesheet" href="styles.css"></head><body><header class="pulso-header"><a href="../index.html">← Campus Profesional</a><div class="pulso-lockup" aria-label="Somos Pulso Salud"><img class="pulso-isotipo" src="assets/pulso-isotipo.png" alt=""><span class="pulso-wordmark"><span>SOMOS</span><strong>PULSO</strong><span>SALUD</span></span></div></header><main class="pulso-shell"><section class="pulso-hero"><div class="pulso-hero-copy"><div class="pulso-lockup" aria-label="Somos Pulso Salud"><img class="pulso-isotipo" src="assets/pulso-isotipo.png" alt=""><span class="pulso-wordmark"><span>SOMOS</span><strong>PULSO</strong><span>SALUD</span></span></div><p class="pulso-eyebrow">Campus Profesional de Enfermería</p><h1>Historias reales de la <em>salud.</em></h1><p class="pulso-intro">Artículos, entrevistas, análisis e investigaciones para pensar la práctica con rigor y perspectiva.</p></div><p class="pulso-motto">Más periodismo<br>y más salud para<br>una sociedad informada.</p></section><div class="pulso-section-heading">Voces</div><section class="pulso-grid" aria-label="Publicaciones">"""
        + listing
        + """</section></main></body></html>""",
        encoding="utf-8",
    )


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
        if item.get("image"):
            assets = output_dir / "assets"
            assets.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item["_image_source"], assets / Path(item["image"]).name)
        render_article(item, template_path.read_text(encoding="utf-8"), output_dir)
    render_index(articles, output_dir)
    print(f"PULSO OK: {len(articles)} publicación(es), salida {output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
