from __future__ import annotations

from flask import Blueprint, current_app, redirect, render_template, url_for

web_bp = Blueprint("web", __name__)


@web_bp.get("/")
def index():
    frontend_config = current_app.config["FRONTEND_CONFIG"]
    return render_template(
        "index.html",
        active_page="graph",
        max_profiles=frontend_config.max_profiles,
        poll_interval_ms=frontend_config.poll_interval_ms,
    )


@web_bp.get("/deep-friend-analysis")
def deep_friend_analysis():
    frontend_config = current_app.config["FRONTEND_CONFIG"]
    return render_template(
        "six_handshakes.html",
        active_page="deep_friend_analysis",
        max_depth=frontend_config.max_deep_analysis_depth,
        poll_interval_ms=frontend_config.poll_interval_ms,
    )


@web_bp.get("/favicon.ico")
def favicon():
    return redirect(url_for("static", filename="favicon.svg"), code=302)


@web_bp.get("/six-handshakes")
def six_handshakes():
    return redirect(url_for("web.deep_friend_analysis"), code=302)
