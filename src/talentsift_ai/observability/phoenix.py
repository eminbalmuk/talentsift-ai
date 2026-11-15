import logging
import os

logger = logging.getLogger(__name__)
_PHOENIX_CONFIGURED = False


def configure_phoenix(project_name: str, collector_endpoint: str | None) -> bool:
    """Configures OpenTelemetry/Phoenix tracing when an endpoint is configured."""
    global _PHOENIX_CONFIGURED
    if not collector_endpoint:
        return False
    if _PHOENIX_CONFIGURED:
        return True

    os.environ.setdefault("PHOENIX_PROJECT_NAME", project_name)
    os.environ.setdefault("PHOENIX_COLLECTOR_ENDPOINT", collector_endpoint)

    try:
        from phoenix.otel import register  # type: ignore[import-not-found]

        register(project_name=project_name, endpoint=collector_endpoint)
    except ImportError:
        try:
            from opentelemetry import trace  # type: ignore[import-not-found]
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # type: ignore[import-not-found]
                OTLPSpanExporter,
            )
            from opentelemetry.sdk.resources import Resource  # type: ignore[import-not-found]
            from opentelemetry.sdk.trace import TracerProvider  # type: ignore[import-not-found]
            from opentelemetry.sdk.trace.export import (  # type: ignore[import-not-found]
                BatchSpanProcessor,
            )

            provider = TracerProvider(resource=Resource.create({"service.name": project_name}))
            provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=collector_endpoint))
            )
            trace.set_tracer_provider(provider)
        except ImportError:
            logger.debug("OpenTelemetry SDK not installed; skipping OTEL exporter setup.")

    try:
        from openinference.instrumentation.langchain import LangChainInstrumentor

        LangChainInstrumentor().instrument()
    except ImportError:
        logger.debug("openinference-instrumentation-langchain not installed.")
    except Exception:
        logger.warning("Failed to instrument LangChain for Phoenix.", exc_info=True)

    _PHOENIX_CONFIGURED = True
    return True
