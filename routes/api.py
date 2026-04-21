from __future__ import annotations

from http import HTTPStatus

from flask import Blueprint, current_app, jsonify, request

from graph_of_god_frontend.services.backend_client import BackendClientError

api_bp = Blueprint("api", __name__, url_prefix="/api")


@api_bp.post("/social-graphs/jobs")
def create_social_graph_job():
    payload = request.get_json(silent=True) or {}
    raw_profiles = payload.get("profiles")
    if not isinstance(raw_profiles, list):
        return jsonify({"detail": "Поле profiles должно быть массивом строк."}), HTTPStatus.BAD_REQUEST

    profiles = [str(profile).strip() for profile in raw_profiles if str(profile).strip()]
    if not profiles:
        return jsonify({"detail": "Нужно указать хотя бы один профиль VK."}), HTTPStatus.BAD_REQUEST

    frontend_config = current_app.config["FRONTEND_CONFIG"]
    if len(profiles) > frontend_config.max_profiles:
        return (
            jsonify({"detail": f"Можно указать не больше {frontend_config.max_profiles} профилей."}),
            HTTPStatus.BAD_REQUEST,
        )

    backend_client = current_app.extensions["backend_client"]
    try:
        payload = backend_client.create_social_graph_job(profiles)
    except BackendClientError as error:
        return jsonify({"detail": str(error)}), error.status_code

    payload["status_url"] = f"/api/social-graphs/jobs/{payload['job_id']}"
    return jsonify(payload), HTTPStatus.ACCEPTED


@api_bp.get("/social-graphs/jobs/<job_id>")
def get_social_graph_job(job_id: str):
    backend_client = current_app.extensions["backend_client"]
    try:
        payload = backend_client.get_social_graph_job(job_id)
    except BackendClientError as error:
        return jsonify({"detail": str(error)}), error.status_code

    payload["status_url"] = f"/api/social-graphs/jobs/{payload['job_id']}"
    return jsonify(payload), HTTPStatus.OK
