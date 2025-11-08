"""Application factory for the Atropos marketing APIs."""

from __future__ import annotations

import logging

from flask import Flask

from .config import DATA_DIR, MAX_REQ, WINDOW
from .cors import install_cors
from .rate_limit import RateLimiter
from .routes import register_routes
from .social_pipeline import SocialPipeline


def create_app() -> Flask:
    """Create and configure the Flask application."""

    app = Flask(__name__)

    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s: %(message)s"))
    app.logger.setLevel(logging.INFO)
    app.logger.addHandler(handler)

    app.logger.info("Using data directory at %s", DATA_DIR)

    social_pipeline = SocialPipeline(data_dir=DATA_DIR, logger=app.logger)
    rate_limiter = RateLimiter(max_requests=MAX_REQ, window_seconds=WINDOW)

    install_cors(app)
    register_routes(app, social_pipeline, rate_limiter)

    return app


app = create_app()

__all__ = ["app", "create_app"]
