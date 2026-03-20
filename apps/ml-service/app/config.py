import os


class Settings:
    db_host: str = os.getenv("ML_DB_HOST", "postgres")
    db_port: str = os.getenv("ML_DB_PORT", "5432")
    db_name: str = os.getenv("ML_DB_NAME", "investify")
    db_user: str = os.getenv("ML_DB_USER", "investify")
    db_password: str = os.getenv("ML_DB_PASSWORD", "investify")

    @property
    def dsn(self) -> str:
        return (
            f"host={self.db_host} "
            f"port={self.db_port} "
            f"dbname={self.db_name} "
            f"user={self.db_user} "
            f"password={self.db_password}"
        )


settings = Settings()