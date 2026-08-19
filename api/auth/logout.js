const { cookieOptions } = require('../_lib/auth');
module.exports = (req, res) => { res.statusCode = 204; res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Set-Cookie', cookieOptions(0)); res.end(); };
