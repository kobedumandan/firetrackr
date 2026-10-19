import sys
import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from dotenv import load_dotenv
from alembic import context

# resolve backend/ root so imports work regardless of cwd
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

from database import Base
from models import (  # noqa: F401 — import side-effects register all tables with Base.metadata
    Users,
    Admin,
    Station,
    Personnel,
    Device,
    LocationLog,
    CurrentLocation,
    ResponseTeam,
    ResponseTeamMember,
    Truck,
    TruckLog,
    FireIncident,
    Route,
    HeatmapData,
    DispatchRecord,
    DispatchTruck,
    TokenBlacklist,
)

config = context.config

# Override sqlalchemy.url from .env so alembic.ini never holds credentials
# ConfigParser treats percent signs as interpolation markers. Escape URL-encoded
# passwords here; get_main_option/get_section restores the original URL.
config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"].replace("%", "%%"))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
