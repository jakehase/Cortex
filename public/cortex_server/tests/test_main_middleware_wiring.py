from cortex_server.main import create_app


def test_create_app_mounts_observability_middleware():
    app = create_app()
    middleware_names = {mw.cls.__name__ for mw in app.user_middleware}
    assert "ObservabilityMiddleware" in middleware_names
