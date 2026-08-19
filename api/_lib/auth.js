const crypto = require('crypto');
const COOKIE = 'campus_dashboard_session';
const MAX_AGE = 60 * 60 * 8;
function sign(value) { return crypto.createHmac('sha256', process.env.DASHBOARD_SESSION_SECRET || '').update(value).digest('base64url'); }
function cookieOptions(maxAge = MAX_AGE) { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
function sessionCookie() { const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url'); return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`; }
function hasSession(req) { const match = (req.headers.cookie || '').match(new RegExp(`${COOKIE}=([^;]+)`)); if (!match) return false; const [payload, signature] = match[1].split('.'); if (!payload || !signature || !process.env.DASHBOARD_SESSION_SECRET) return false; const expected = sign(payload); if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false; try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Math.floor(Date.now() / 1000); } catch { return false; } }
function requireSession(req, res) { if (hasSession(req)) return true; res.statusCode = 401; res.setHeader('Cache-Control', 'private, no-store'); res.end(JSON.stringify({ error: 'unauthorized' })); return false; }
module.exports = { cookieOptions, hasSession, requireSession, sessionCookie };
