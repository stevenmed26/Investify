from psycopg import connect
from psycopg.rows import dict_row
from app.config import settings


def get_connection():
    return connect(settings.dsn, row_factory=dict_row)