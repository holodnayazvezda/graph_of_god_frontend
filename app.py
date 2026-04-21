from __future__ import annotations

import sys
from pathlib import Path

from flask import Flask

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from graph_of_god_frontend.core.config import FrontendConfig
from graph_of_god_frontend.routes.api import api_bp
from graph_of_god_frontend.routes.web import web_bp
from graph_of_god_frontend.services.backend_client import BackendClient


def create_app() -> Flask:
    frontend_config = FrontendConfig.from_env()

    app = Flask(__name__)
    app.config["SECRET_KEY"] = frontend_config.secret_key
    app.config["FRONTEND_CONFIG"] = frontend_config
    app.extensions["backend_client"] = BackendClient(
        base_url=frontend_config.backend_base_url,
        timeout_seconds=frontend_config.request_timeout_seconds,
    )

    app.register_blueprint(web_bp)
    app.register_blueprint(api_bp)

    return app
