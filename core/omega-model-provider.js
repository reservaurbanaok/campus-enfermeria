'use strict';

function createConfiguredModelProvider(options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
  const model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!apiKey || typeof fetchImpl !== 'function') return null;
  return {
    provider: 'openai',
    model,
    async generate({ systemPrompt, developerPrompt, userPrompt }) {
      const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [
          { role: 'system', content: systemPrompt },
          { role: 'developer', content: developerPrompt },
          { role: 'user', content: userPrompt },
        ] }),
      });
      if (!response.ok) throw Object.assign(new Error('model_request_failed'), { code: `model_http_${response.status}` });
      const payload = await response.json();
      const text = payload?.choices?.[0]?.message?.content;
      if (!text || typeof text !== 'string') throw new Error('model_empty_response');
      return text.trim();
    },
  };
}

module.exports = { createConfiguredModelProvider };
