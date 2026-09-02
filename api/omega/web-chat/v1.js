'use strict';

const { createWebChatHandler } = require('../../_lib/web-chat');

module.exports = createWebChatHandler();
module.exports.config = { api: { bodyParser: false } };
