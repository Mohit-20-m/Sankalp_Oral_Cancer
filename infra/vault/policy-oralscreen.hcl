# Least privilege for the OralScreen services: read/write only their own KV path.
path "secret/data/oralscreen"     { capabilities = ["create", "read", "update"] }
path "secret/metadata/oralscreen" { capabilities = ["read"] }
path "auth/token/renew-self"      { capabilities = ["update"] }
path "auth/token/lookup-self"     { capabilities = ["read"] }
