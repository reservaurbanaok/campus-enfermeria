'use strict';

const { createInstagramIngressHandler } = require('../../../api/_lib/instagram-social-ingress');
const { createInstagramOutboundSender } = require('../../../api/_lib/instagram-outbound');

module.exports = createInstagramIngressHandler({
  sendOutbound: createInstagramOutboundSender(),
});
module.exports.config = { api: { bodyParser: false } };
