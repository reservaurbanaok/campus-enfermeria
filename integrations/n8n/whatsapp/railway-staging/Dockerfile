FROM n8nio/n8n:1.123.5

USER root
COPY entrypoint.sh /usr/local/bin/omega-n8n-entrypoint.sh
RUN chmod 0755 /usr/local/bin/omega-n8n-entrypoint.sh

ENTRYPOINT ["tini", "--", "/usr/local/bin/omega-n8n-entrypoint.sh"]


