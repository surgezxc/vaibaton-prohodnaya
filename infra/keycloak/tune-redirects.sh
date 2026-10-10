#!/bin/bash
# Добавляет HTTPS-origin Wi-Fi в клиент web. Импорт realm не повторяется на заполненном томе.
set -u
LAN_IP="${LAN_IP:-}"
ADMIN_USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${KC_BOOTSTRAP_ADMIN_PASSWORD:-change-me}"
KCADM=/opt/keycloak/bin/kcadm.sh

echo "Ждём Keycloak, чтобы разрешить возврат на https://${LAN_IP:-<LAN_IP>}:8443"
ok=0
for _ in $(seq 1 90); do
  if "$KCADM" config credentials \
    --server http://keycloak:8080 \
    --realm master \
    --user "$ADMIN_USER" \
    --password "$ADMIN_PASSWORD" >/tmp/kcadm-login.err 2>&1; then
    ok=1
    break
  fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "Keycloak не принял администратора. Адрес возврата браузера не обновлён." >&2
  cat /tmp/kcadm-login.err >&2 || true
  exit 1
fi

CID=""
for _ in $(seq 1 30); do
  CID=$("$KCADM" get clients -r prohodnaya -q clientId=web --fields id --format csv --noquotes 2>/dev/null | awk 'NF && $0 != "id" { print; exit }')
  if [ -n "$CID" ]; then
    break
  fi
  sleep 2
done
if [ -z "$CID" ]; then
  echo "Клиент web в realm prohodnaya не найден." >&2
  exit 1
fi

EXACT=""
LOGOUT_EXACT=""
if [ -n "$LAN_IP" ]; then
  EXACT="\"https://${LAN_IP}:8443/*\",\"https://${LAN_IP}:8443\","
  LOGOUT_EXACT="https://${LAN_IP}:8443##"
fi

cat > /tmp/web-redirects.json <<EOF
{
  "redirectUris": [${EXACT}"https://*","http://localhost:43123/*","http://127.0.0.1:43123/*","http://localhost:43123","http://127.0.0.1:43123","http://localhost:3002/*","http://127.0.0.1:3002/*","http://localhost:3000/*","http://127.0.0.1:3000/*","http://localhost:4173/*"],
  "webOrigins": ["+"],
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "post.logout.redirect.uris": "${LOGOUT_EXACT}https://*##http://localhost:43123##http://127.0.0.1:43123##http://localhost:3002##http://127.0.0.1:3002##http://localhost:3000##http://127.0.0.1:3000##http://localhost:4173"
  }
}
EOF

"$KCADM" update "clients/${CID}" -r prohodnaya -f /tmp/web-redirects.json
echo "Клиент web принимает https://${LAN_IP:-<любой хост>}:8443"
