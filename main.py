from __future__ import annotations

import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from graph_of_god_frontend.app import create_app
from graph_of_god_frontend.core.config import FrontendConfig

app = create_app()


def main() -> None:
    config = FrontendConfig.from_env()
    app.run(
        host=config.host,
        port=config.port,
        debug=False,
    )


if __name__ == "__main__":
    main()
