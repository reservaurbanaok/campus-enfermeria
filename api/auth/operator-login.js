const crypto = require('crypto');
const { operatorSessionCookie } = require('../_lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method_not_allowed' })); }
  let body = ''; for await (const chunk of req) body += chunk;
  let credential = ''; try { credential = JSON.parse(body).credential || ''; } catch {}
  const expected = process.env.HANDOFF_OPERATOR_CREDENTIAL || '';
  const a = Buffer.from(credential); const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'invalid_operator_credentials' })); }
  const cookie = operatorSessionCookie();
  if (!cookie) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'operator_auth_unconfigured' })); }
  res.statusCode = 200; res.setHeader('Set-Cookie', cookie); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true }));
};
