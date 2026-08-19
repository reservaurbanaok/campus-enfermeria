const { hasSession } = require('../_lib/auth');
module.exports = (req, res) => { res.statusCode = 200; res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ authenticated: hasSession(req) })); };
