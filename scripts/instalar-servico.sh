#!/usr/bin/env bash
# Instala o agente como serviço systemd do usuário: 24 h, com restart automático.
# Rode na máquina onde ele vai ficar, dentro da pasta do agente, com o .env pronto.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST=~/.config/systemd/user
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "ERRO: node não encontrado no PATH (precisa do Node 20+)."; exit 1; }
"$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || { echo "ERRO: precisa do Node 20+ (achei $("$NODE" -v))."; exit 1; }
[ -f "$RAIZ/.env" ] || { echo "ERRO: falta $RAIZ/.env (copie de .env.example e preencha)."; exit 1; }
# O sharp tem binário por arquitetura (x86 ou ARM): instalar na própria máquina.
( cd "$RAIZ" && npm ci --omit=dev )
mkdir -p "$DEST" "$RAIZ/data"
sed -e "s#__DEST__#$RAIZ#g" -e "s#__NODE__#$NODE#g" "$RAIZ/systemd/agente-cadastro-whatsapp.service" > "$DEST/agente-cadastro-whatsapp.service"
systemctl --user daemon-reload
systemctl --user enable --now agente-cadastro-whatsapp.service
# Sem linger, os serviços do usuário morrem quando a sessão fecha.
loginctl enable-linger "$USER" 2>/dev/null || echo "AVISO: rode 'sudo loginctl enable-linger $USER' para o agente sobreviver ao logout."
sleep 2
PORT="$(grep -E '^PORT=' "$RAIZ/.env" | cut -d= -f2)"; PORT="${PORT:-3210}"
curl -s -m 5 "http://127.0.0.1:$PORT/health" && echo
