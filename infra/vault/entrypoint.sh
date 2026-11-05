#!/bin/sh
# Starts Vault with persistent storage, initialises it once (1 key share — demo/hackathon setting; production
# uses 5 shares / 3 threshold held by different people, or cloud KMS auto-unseal), unseals on every start, and
# creates a least-privilege periodic token for the services with the id given in VAULT_APP_TOKEN.
set -eu
export VAULT_ADDR=http://127.0.0.1:8200
KEYS=/vault/keys/init.json
rm -f /tmp/ready
vault server -config=/vault/config/vault.hcl &
VPID=$!
until vault status -format=json >/dev/null 2>&1 || [ $? -eq 2 ]; do sleep 1; done
if [ ! -s "$KEYS" ]; then
  echo "vault: first start — initialising"
  vault operator init -key-shares=1 -key-threshold=1 -format=json > "$KEYS"
  chmod 600 "$KEYS"
fi
UNSEAL=$(sed -n 's/.*"unseal_keys_b64": *\[ *"\([^"]*\)".*/\1/p' "$KEYS" | head -1)
[ -n "$UNSEAL" ] || UNSEAL=$(tr -d '\n ' < "$KEYS" | sed -n 's/.*"unseal_keys_b64":\["\([^"]*\)".*/\1/p')
vault operator unseal "$UNSEAL" >/dev/null
ROOT=$(tr -d '\n ' < "$KEYS" | sed -n 's/.*"root_token":"\([^"]*\)".*/\1/p')
export VAULT_TOKEN="$ROOT"
vault secrets list -format=json | grep -q '"secret/"' || vault secrets enable -path=secret -version=2 kv
vault policy write oralscreen /vault/config/policy-oralscreen.hcl >/dev/null
if ! VAULT_TOKEN="$VAULT_APP_TOKEN" vault token lookup >/dev/null 2>&1; then
  vault token create -id="$VAULT_APP_TOKEN" -policy=oralscreen -period=768h -orphan \
    -display-name=oralscreen-services >/dev/null
  echo "vault: service token created"
fi
vault audit list -format=json 2>/dev/null | grep -q file/ || vault audit enable file file_path=/vault/logs/audit.log >/dev/null
echo "vault: ready (unsealed)"
touch /tmp/ready
wait $VPID
