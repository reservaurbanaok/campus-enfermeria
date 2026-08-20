const { requireSession } = require('../_lib/auth');

module.exports = async (req, res) => {
  if (!requireSession(req, res)) return;
  const token = process.env.NETROOM_ANALYTICS_TOKEN;
  const upstream = process.env.NETROOM_ANALYTICS_UPSTREAM;
  if (!token || !upstream) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'netroom_unavailable' })); }
  try {
    const response = await fetch(upstream, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    res.statusCode = response.status;
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(await response.text());
  } catch { res.statusCode = 502; res.setHeader('Cache-Control', 'private, no-store'); res.end(JSON.stringify({ error: 'upstream_unavailable' })); }
};
