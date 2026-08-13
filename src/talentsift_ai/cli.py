import asyncio
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from talentsift_ai.agents import DebateGraph
from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClient
from talentsift_ai.observability import configure_phoenix
from talentsift_ai.pipeline import HybridSearchService, ResumeIngestionPipeline
from talentsift_ai.pipeline.search import load_job_description
from talentsift_ai.schemas import JobPostingCreate
from talentsift_ai.settings import get_settings

app = typer.Typer(help="TalentSift AI resume screening pipeline.")
db_app = typer.Typer(help="Database commands.")
auth_app = typer.Typer(help="B2B organization and credential commands.")
admin_app = typer.Typer(help="Owner admin commands.")
posting_app = typer.Typer(help="Job posting commands.")
app.add_typer(db_app, name="db")
app.add_typer(auth_app, name="auth")
app.add_typer(admin_app, name="admin")
app.add_typer(posting_app, name="posting")
console = Console()


def run_async(coro):
    return asyncio.run(coro)


def create_mistral_client() -> MistralClient:
    settings = get_settings()
    return MistralClient(
        api_keys=settings.mistral_api_keys,
        base_url=settings.mistral_base_url,
        timeout_seconds=settings.request_timeout_seconds,
        max_concurrency=settings.max_concurrency,
    )


@db_app.command("init")
def init_db(
    migration: Annotated[
        Path,
        typer.Option(help="SQL migration file or directory path."),
    ] = Path("migrations"),
) -> None:
    """Initialize PostgreSQL schema and pgvector extension."""

    async def _init() -> None:
        settings = get_settings()
        async with CandidateRepository(settings.migration_database_url) as repository:
            if migration.is_dir():
                for migration_file in sorted(migration.glob("*.sql")):
                    await repository.init_schema(migration_file)
                    console.print(f"[green]Applied[/green] {migration_file}")
            else:
                await repository.init_schema(migration)

    run_async(_init())
    console.print(f"[green]Database schema initialized from {migration}[/green]")


@admin_app.command("provision")
def provision_admin(
    username: Annotated[str | None, typer.Option(help="Custom admin username.")] = None,
    password: Annotated[str | None, typer.Option(help="Custom admin password.")] = None,
    skip_if_exists: Annotated[
        bool,
        typer.Option(
            "--skip-if-exists",
            help="Do nothing if an admin user already exists.",
        ),
    ] = False,
) -> None:
    """Create or update the owner admin login credentials."""

    async def _provision() -> None:
        settings = get_settings()
        async with CandidateRepository(settings.database_url) as repository:
            if skip_if_exists and await repository.admin_user_exists():
                console.print("[yellow]Admin user already exists, skipping.[/yellow]")
                return

            admin_user = username or settings.admin_username or None
            admin_pass = password or settings.admin_password or None

            credential = await repository.provision_admin_user(
                username=admin_user,
                password=admin_pass,
                credential_pepper=settings.product_key_pepper,
            )
            console.print("[green]Admin credential provisioned[/green]")
            console.print(f"Admin ID: {credential.admin_id}")
            console.print(f"Username: {credential.username}")
            console.print(f"Password: {credential.password}")

    run_async(_provision())


@admin_app.command("add-organization")
def add_organization(
    display_name: Annotated[str, typer.Option(help="Visible customer organization name.")],
    notes: Annotated[str | None, typer.Option(help="Internal admin notes.")] = None,
) -> None:
    """Create a licensed organization and print its random login once."""

    async def _provision() -> None:
        settings = get_settings()
        async with CandidateRepository(settings.database_url) as repository:
            credential = await repository.provision_organization_user(
                display_name=display_name,
                notes=notes,
                credential_pepper=settings.product_key_pepper,
            )
            console.print("[green]Organization credential provisioned[/green]")
            console.print(f"Organization ID: {credential.organization_id}")
            console.print(f"Display name: {credential.display_name}")
            console.print(f"Username: {credential.username}")
            console.print(f"Password: {credential.password}")
            console.print(f"License key: {credential.license_key}")
            console.print("Store this password now. Only its hash is saved in the database.")

    run_async(_provision())


@auth_app.command("login-check")
def login_check(
    username: Annotated[str, typer.Option(help="Organization username.")],
    password: Annotated[str, typer.Option(help="Organization password.")],
) -> None:
    """Verify an organization username and password against the database."""

    async def _login_check() -> None:
        settings = get_settings()
        async with CandidateRepository(settings.database_url) as repository:
            identity = await repository.authenticate_organization_user(
                username=username,
                password=password,
                credential_pepper=settings.product_key_pepper,
            )
            if identity is None:
                raise typer.BadParameter("Invalid username or password.")
            console.print(
                "[green]Login accepted[/green] "
                f"for organization #{identity['organization_id']} "
                f"({identity['display_name']})"
            )

    run_async(_login_check())


@admin_app.command("serve")
def serve_admin_panel(
    host: Annotated[str, typer.Option(help="Host to bind.")] = "127.0.0.1",
    port: Annotated[int, typer.Option(help="Port to bind.")] = 8000,
) -> None:
    """Run the JSON API (admin + organization) that the Next.js frontend talks to."""

    import uvicorn

    uvicorn.run("talentsift_ai.web.app:app", host=host, port=port, reload=False)


@posting_app.command("create")
def create_posting(
    organization_id: Annotated[int, typer.Option(help="Organization ID owner of the posting.")],
    title: Annotated[str, typer.Option(help="Job posting title.")],
    description: Annotated[
        str,
        typer.Option(help="Job description text or path to a text file."),
    ],
    deadline: Annotated[
        str | None,
        typer.Option(help="Application deadline, e.g. 2026-09-01."),
    ] = None,
) -> None:
    """Create a job posting for an organization."""

    async def _create() -> None:
        settings = get_settings()
        async with CandidateRepository(settings.database_url) as repository:
            posting = await repository.create_job_posting(
                JobPostingCreate(
                    organization_id=organization_id,
                    title=title,
                    description=load_job_description(description),
                    deadline_at=deadline,
                )
            )
            console.print(f"[green]Job posting created[/green] #{posting.id}: {posting.title}")

    run_async(_create())


@app.command()
def ingest(
    organization_id: Annotated[int, typer.Option(help="Organization ID owner of the resumes.")],
    job_posting_id: Annotated[int, typer.Option(help="Job posting ID the resumes belong to.")],
    resume_dir: Annotated[Path, typer.Option(help="Directory containing PDF resumes.")],
    concurrency: Annotated[int, typer.Option(help="Maximum concurrent resume jobs.")] = 8,
) -> None:
    """OCR, extract, embed, and store all PDF resumes in a directory."""

    async def _ingest() -> None:
        settings = get_settings()
        configure_phoenix(settings.phoenix_project_name, settings.phoenix_collector_endpoint)
        async with create_mistral_client() as mistral:
            async with CandidateRepository(settings.database_url) as repository:
                pipeline = ResumeIngestionPipeline(
                    mistral_client=mistral,
                    repository=repository,
                    organization_id=organization_id,
                    job_posting_id=job_posting_id,
                    max_concurrency=concurrency,
                )
                candidates = await pipeline.ingest_directory(resume_dir)
                for candidate in candidates:
                    console.print(
                        f"[green]Inserted[/green] #{candidate.id}: {candidate.full_name}"
                    )

    run_async(_ingest())


@app.command()
def rank(
    organization_id: Annotated[int, typer.Option(help="Organization ID to search within.")],
    job_posting_id: Annotated[int, typer.Option(help="Job posting ID to search within.")],
    job_description: Annotated[
        str,
        typer.Option(help="Job description text or path to a text file."),
    ],
    min_gpa: Annotated[float | None, typer.Option(help="Minimum GPA filter.")] = None,
    class_year: Annotated[
        int | None,
        typer.Option("--class-year", help="Class year filter, 1-4 or 5 for graduate."),
    ] = None,
    min_experience_years: Annotated[
        int | None,
        typer.Option(help="Minimum experience years filter."),
    ] = None,
    limit: Annotated[int, typer.Option(help="Maximum candidate count.")] = 50,
) -> None:
    """Apply SQL filters and semantic pgvector ranking."""

    async def _rank() -> None:
        settings = get_settings()
        async with create_mistral_client() as mistral:
            async with CandidateRepository(settings.database_url) as repository:
                service = HybridSearchService(mistral_client=mistral, repository=repository)
                results = await service.rank(
                    organization_id=organization_id,
                    job_posting_id=job_posting_id,
                    job_description=load_job_description(job_description),
                    min_gpa=min_gpa,
                    class_year=class_year,
                    min_experience_years=min_experience_years,
                    limit=limit,
                )
                render_rankings(results)

    run_async(_rank())


@app.command()
def debate(
    organization_id: Annotated[int, typer.Option(help="Organization ID owner of the candidate.")],
    job_posting_id: Annotated[int, typer.Option(help="Job posting ID the candidate belongs to.")],
    candidate_id: Annotated[int, typer.Option(help="Candidate ID to evaluate.")],
    job_description: Annotated[
        str,
        typer.Option(help="Job description text or path to a text file."),
    ],
) -> None:
    """Run the Optimist/Pessimist/Arbitrator graph for a candidate."""

    async def _debate() -> None:
        settings = get_settings()
        configure_phoenix(settings.phoenix_project_name, settings.phoenix_collector_endpoint)
        async with create_mistral_client() as mistral:
            async with CandidateRepository(settings.database_url) as repository:
                candidate = await repository.get_candidate(
                    candidate_id, organization_id, job_posting_id
                )
                if candidate is None:
                    raise typer.BadParameter(
                        f"Candidate {candidate_id} was not found in organization "
                        f"{organization_id} / posting {job_posting_id}."
                    )

                graph = DebateGraph(mistral)
                result = await graph.evaluate(
                    organization_id=organization_id,
                    candidate_id=candidate.id,
                    cv_text=candidate.raw_cv_text,
                    job_description=load_job_description(job_description),
                )
                result_id = await repository.save_debate_result(result)
                console.print(
                    f"[green]Saved debate result #{result_id}[/green] "
                    f"for candidate #{candidate.id} with final score {result.final_score:.2f}"
                )

    run_async(_debate())


@app.command("top")
def top_results(
    organization_id: Annotated[int, typer.Option(help="Organization ID to rank within.")],
    job_posting_id: Annotated[int, typer.Option(help="Job posting ID to rank within.")],
    limit: Annotated[int, typer.Option(help="Number of final candidates.")] = 5,
) -> None:
    """Show globally ranked debate results."""

    async def _top() -> None:
        settings = get_settings()
        async with CandidateRepository(settings.database_url) as repository:
            render_top_results(
                await repository.top_results(organization_id, job_posting_id, limit=limit)
            )

    run_async(_top())


def render_rankings(results: list[dict]) -> None:
    table = Table(title="Pre-LLM Hybrid Search & Reranking Results")
    table.add_column("ID")
    table.add_column("Name")
    table.add_column("GPA")
    table.add_column("Class")
    table.add_column("Experience")
    table.add_column("Pre-LLM Score")
    table.add_column("Relevance")
    table.add_column("Competency")
    for row in results:
        pre_llm = row.get("pre_llm_score", row.get("similarity", 0.0))
        rel = row.get("relevance_score", row.get("similarity", 0.0))
        comp = row.get("competency_score", 0.0)
        table.add_row(
            str(row["id"]),
            row["full_name"],
            "" if row.get("gpa") is None else str(row["gpa"]),
            str(row["current_class"]),
            str(row["experience_years"]),
            f"{pre_llm:.4f}",
            f"{rel:.4f}",
            f"{comp:.4f}",
        )
    console.print(table)


def render_top_results(results: list[dict]) -> None:
    table = Table(title="Final Candidate Ranking")
    table.add_column("Candidate ID")
    table.add_column("Name")
    table.add_column("University")
    table.add_column("Final Score")
    table.add_column("Selected")
    for row in results:
        table.add_row(
            str(row["candidate_id"]),
            row["full_name"],
            row["university"] or "",
            f"{float(row['final_score']):.2f}",
            "yes" if row["is_selected"] else "no",
        )
    console.print(table)
