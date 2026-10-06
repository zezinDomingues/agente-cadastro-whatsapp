#!/usr/bin/env bash
# Aponta os webhooks da instância Z-API para este agente.
#   scripts/apontar-webhook.sh https://endereco-publico-do-agente
# O endereço precisa ser HTTPS (exigência da Z-API) e chegar na porta do agente
# (túnel Cloudflare, Nginx, Caddy...).
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="${1:?uso: $0 https://endereco-publico-do-agente}"
URL="${URL%/}"
set -a; . "$RAIZ/.env"; set +a
BASE="https://api.z-api.io/instances/$ZAPI_INSTANCE/token/$ZAPI_TOKEN"
H=(-H "Content-Type: application/json")
[ -n "${ZAPI_CLIENT_TOKEN:-}" ] && H+=(-H "Client-Token: $ZAPI_CLIENT_TOKEN")
echo "conferindo $URL/health ..."; curl -sf -m 15 "$URL/health" || { echo "ERRO: $URL/health não respondeu"; exit 1; }; echo
# Mensagens recebidas.
curl -s -m 30 -X PUT "${H[@]}" "$BASE/update-webhook-received" -d "{\"value\":\"$URL/api/whatsapp/webhook?secret=$WHATSAPP_WEBHOOK_SECRET\"}"; echo
# Status das mensagens (entregue/lida): é o que o vigia usa para provar a entrega.
curl -s -m 30 -X PUT "${H[@]}" "$BASE/update-webhook-message-status" -d "{\"value\":\"$URL/api/whatsapp/status?secret=$WHATSAPP_WEBHOOK_SECRET\"}"; echo
# O que o próprio número manda não deve voltar para o agente.
curl -s -m 30 -X PUT "${H[@]}" "$BASE/update-notify-sent-by-me" -d '{"notifySentByMe":false}'; echo
