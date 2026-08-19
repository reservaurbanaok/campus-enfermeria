const proxy = require('../_lib/proxy');
module.exports = (req, res) => proxy(req, res, process.env.ALUMNOS_UPSTREAM);
