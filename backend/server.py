from __future__ import annotations

import sys
from pathlib import Path

import uvicorn


def main() -> None:
    backend_dir = Path(__file__).resolve().parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
    uvicorn.run("app:app", app_dir=str(backend_dir), host="127.0.0.1", port=8000, workers=1)


if __name__ == "__main__":
    main()
