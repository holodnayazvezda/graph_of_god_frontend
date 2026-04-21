from __future__ import annotations

from flask import Blueprint, current_app, render_template

web_bp = Blueprint("web", __name__)


@web_bp.get("/")
def index():
    frontend_config = current_app.config["FRONTEND_CONFIG"]
    return render_template(
        "index.html",
        max_profiles=frontend_config.max_profiles,
        poll_interval_ms=frontend_config.poll_interval_ms,
    )
