from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from dotenv import load_dotenv
import os

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "20"))
DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "40"))
DB_CONNECT_TIMEOUT = int(os.getenv("DB_CONNECT_TIMEOUT", "10"))
if DB_POOL_SIZE < 1 or DB_MAX_OVERFLOW < 0 or DB_CONNECT_TIMEOUT < 1:
    raise ValueError("DB_POOL_SIZE and DB_CONNECT_TIMEOUT must be positive; DB_MAX_OVERFLOW must be nonnegative.")

engine = create_engine(
    DATABASE_URL,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_pre_ping=True,
    pool_recycle=1800,
    connect_args={"connect_timeout": DB_CONNECT_TIMEOUT},
)


@event.listens_for(engine, "connect")
def _preserve_float_precision(connection, _record):
    """Keep coordinates and other floats round-trip safe through session poolers."""
    previous = connection.autocommit
    connection.autocommit = True
    try:
        with connection.cursor() as cursor:
            # Some poolers override startup options, so set this explicitly.
            cursor.execute("SET SESSION extra_float_digits = 3")
    finally:
        connection.autocommit = previous


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_connection():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT PostGIS_Version()"))
        return True
    except Exception as e:
        print(f"[DB] Connection failed: {e}")
        return False
