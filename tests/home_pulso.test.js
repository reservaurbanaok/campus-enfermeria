const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const home = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const pulsoIndex = fs.readFileSync(path.join(repo, 'pulso', 'index.html'), 'utf8');

assert.equal((home.match(/PULSO_HOME_START/g) || []).length, 1);
assert.equal((home.match(/PULSO_HOME_END/g) || []).length, 1);
assert.ok(home.includes('LA SALUD TAMBIÉN NECESITA SER CONTADA.'));
assert.ok(home.includes('Historias, investigación, evidencia y voces que nos invitan a comprender la salud desde adentro.'));
assert.ok(home.includes('CONOCER PULSO'));
assert.ok(home.includes('href="pulso/"'));
assert.ok(home.includes('href="pulso/publicaciones/carla-scaramella.html"'));
assert.ok(home.includes('href="#cursos"'));
assert.ok(home.includes('href="#beneficios"'));
assert.ok(home.includes('Capacitate. Especializate. Crecé.'));
assert.ok(home.includes('VER CAPACITACIONES'));
assert.ok(home.includes('La salud, desde adentro.'));
assert.ok(home.includes('DESCUBRIR PULSO'));
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

console.log('HOME_PULSO_TEST_OK');
