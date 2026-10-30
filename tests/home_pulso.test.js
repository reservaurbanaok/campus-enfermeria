const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const home = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const pulsoIndex = fs.readFileSync(path.join(repo, 'pulso', 'index.html'), 'utf8');

assert.equal((home.match(/PULSO_HOME_START/g) || []).length, 1);
assert.equal((home.match(/PULSO_HOME_END/g) || []).length, 1);
assert.ok(home.includes('LA SALUD TAMBIÉN NECESITA SER CONTADA.'));
assert.ok(home.includes('Historias, investigación, evidencia y voces para comprender la salud desde adentro.'));
assert.ok(home.includes('INGRESAR A SALUD DESDE ADENTRO'));
assert.match(home, /<a class="pulso-home-label" href="pulso\/publicaciones\/carla-scaramella\.html">PUBLICACIÓN DESTACADA/);
assert.ok(home.includes('PUBLICACIÓN DESTACADA <span aria-hidden="true">→</span>'));
assert.ok(home.includes('href="pulso/"'));
assert.ok(home.includes('href="pulso/publicaciones/carla-scaramella.html"'));
assert.ok(home.includes('href="#cursos"'));
assert.ok(home.includes('href="#beneficios"'));
assert.ok(home.includes('Capacitate. Especializate. Crecé.'));
assert.ok(home.includes('VER CAPACITACIONES'));
assert.ok(home.includes('La salud, desde adentro.'));
assert.ok(home.includes('SALUD<br>DESDE<br>ADENTRO'));
assert.ok(home.includes('Conocimiento que nos conecta.'));
assert.ok(home.includes('CONOCER EL CAMPUS'));
assert.ok(!home.includes('Formación, conversación y pertenencia.'));
assert.ok(!home.includes('Una misma comunidad, tres formas de crecer'));

const pillarsAt = home.indexOf('id="campus-pillars"');
const pulsoAt = home.indexOf('id="pulso-home"');
const coursesAt = home.indexOf('id="cursos"');
assert.ok(pillarsAt >= 0 && pulsoAt > pillarsAt && coursesAt > pulsoAt);

const pillars = [...home.matchAll(/<a class="campus-pillar[^"]*" href="([^"]+)">([\s\S]*?)<\/a>/g)];
assert.equal(pillars.length, 3);
assert.deepEqual(pillars.map(match => match[1]), ['#cursos', 'pulso/', '#beneficios']);
assert.ok(pillars.every(match => !/<a\b/i.test(match[2])));

assert.ok(fs.existsSync(path.join(repo, 'pulso', 'assets', 'pulso-isotipo.png')));
assert.ok(pulsoIndex.includes('href="publicaciones/carla-scaramella.html"'));
assert.equal((pulsoIndex.match(/class="pulso-card"/g) || []).length, 9);
assert.equal((pulsoIndex.match(/class="pulso-article-image"/g) || []).length, 9);
assert.equal((pulsoIndex.match(/class="pulso-section-nav-link"/g) || []).length, 6);
assert.deepEqual(
  [...pulsoIndex.matchAll(/<h2 id="([^"]+)" class="pulso-section-heading"[^>]*>([^<]+)<\/h2>/g)].map(match => [match[1], match[2]]),
  [
    ['historias-y-entrevistas', 'Historias y entrevistas'],
    ['enfermeria-escolar', 'Enfermería escolar'],
    ['ciencia-e-investigacion', 'Ciencia e investigación'],
    ['salud-y-sociedad', 'Salud y sociedad'],
    ['opinion', 'Opinión'],
    ['participacion', 'Participación'],
  ],
);
assert.ok(pulsoIndex.includes('href="#ciencia-e-investigacion"'));
assert.ok(pulsoIndex.includes('id="ciencia-y-evidencia"'));
assert.ok(pulsoIndex.includes('data-section-id="ciencia-y-evidencia"'));
assert.ok(pulsoIndex.includes('Próximamente encontrarás publicaciones en esta sección.'));
assert.equal((pulsoIndex.match(/editorial_section_click/g) || []).length, 1);
assert.ok(pulsoIndex.includes('https://www.instagram.com/reel/DecfqN4DrRC/'));
assert.ok(pulsoIndex.includes('https://www.instagram.com/reel/DeiLAG5jhWR/'));
assert.ok(!pulsoIndex.includes('PULSO</strong>'));

console.log('HOME_PULSO_TEST_OK');
