"""Alembic environment — migrations run as the OWNER role (the app role cannot alter schema)."""
from alembic import context
from sqlalchemy import create_engine, pool

from app.config import get_settings
from app.models import Base

target_metadata = Base.metadata

# tables owned by extensions (PostGIS etc.) are never managed by our migrations
_EXTENSION_TABLES = {"spatial_ref_sys", "geography_columns", "geometry_columns"}


def include_object(obj, name, type_, reflected, compare_to):
    if type_ == "table" and name in _EXTENSION_TABLES:
        return False
    if type_ == "column" and name == "geom":      # generated PostGIS columns are added in 0002
        return False
    if type_ == "index" and name and name.endswith("_geom"):
        return False
    return True


def run_migrations_online() -> None:
    url = context.config.get_main_option("sqlalchemy.url") or get_settings().owner_dsn_sync
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata, compare_type=True,
                          include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
