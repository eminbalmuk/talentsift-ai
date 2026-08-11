import os


def configure_phoenix(project_name: str, collector_endpoint: str | None) -> None:
    if not collector_endpoint:
        return

    os.environ.setdefault("PHOENIX_PROJECT_NAME", project_name)
    os.environ.setdefault("PHOENIX_COLLECTOR_ENDPOINT", collector_endpoint)

    try:
        from openinference.instrumentation.langchain import LangChainInstrumentor
    except ImportError:
        return

    LangChainInstrumentor().instrument()

