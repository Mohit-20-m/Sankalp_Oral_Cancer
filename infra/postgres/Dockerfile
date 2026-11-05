# PostgreSQL 16 + pgvector (base image, multi-arch) + PostGIS 3 + pgBackRest — one database server for
# OralScreen, Keycloak, MLflow and (optional) HAPI FHIR.
FROM pgvector/pgvector:0.8.0-pg16
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-postgis-3 pgbackrest \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest \
    && chown -R postgres:postgres /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest
COPY pgbackrest/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY initdb/ /docker-entrypoint-initdb.d/
COPY backup.sh /usr/local/bin/oralscreen-backup
RUN chmod 0755 /usr/local/bin/oralscreen-backup /docker-entrypoint-initdb.d/*.sh
