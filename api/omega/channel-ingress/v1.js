'use strict';
const { createIngressHandler } = require('../../_lib/channel-ingress');
const handler = createIngressHandler();
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
