"""
One-shot command-line entry point for the 30-day working-file cleanup using MongoDB.
"""

import asyncio
import logging

from app.core.database import database
from app.services.cleanup import expire_old_files

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def main() -> None:
    count = asyncio.run(expire_old_files(database))
    print(f"Expired {count} drawing(s) past the working-file TTL.")


if __name__ == "__main__":
    main()
