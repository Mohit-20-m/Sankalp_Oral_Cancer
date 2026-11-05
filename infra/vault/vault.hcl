# Persistent single-node Vault (file storage on a Docker volume). Unsealed automatically by entrypoint.sh.
storage "file" { path = "/vault/file" }
listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true          # internal Docker network only; Traefik terminates TLS at the edge
}
api_addr      = "http://vault:8200"
disable_mlock = true
ui            = true
