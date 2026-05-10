# export/biomed_report_exporter.py

from pathlib import Path
from datetime import datetime, UTC
import re


REPORT_DIR = Path("export/reports")


def slugify(text: str, max_length: int = 70) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text[:max_length] or "manifest-report"


def ensure_report_dir():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

def clean_report_text(text: str) -> str:
    import re

    # Remove ANSI escape sequences
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)

    # Remove weird terminal redraw artifacts
    text = re.sub(r"#\[[0-9;]*[A-Za-z]", "", text)

    # Fix duplicated wrapped words
    text = re.sub(r"(\w+)\n\1", r"\1", text)

    # Fix broken markdown links
    text = re.sub(
        r"\[PMC Link: (https?://[^\]]+)\]\((https?://[^)]+)\)",
        r"\1",
        text,
    )

    # Remove duplicated URLs accidentally stitched together
    text = re.sub(
        r"(https?://[^\s]+)\1+",
        r"\1",
        text,
    )

    # Normalize excessive whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Remove trailing spaces
    text = re.sub(r"[ \t]+\n", "\n", text)

    return text.strip()

def save_markdown_report(
    query: str,
    report_text: str,
    mode: str = "local",
    metadata: dict | None = None,
) -> Path:
    ensure_report_dir()

    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    slug = slugify(query)

    filename = f"{timestamp}-{slug}.md"
    path = REPORT_DIR / filename

    metadata = metadata or {}

    header_lines = [
        "# Manifest Biomedical Research Report",
        "",
        f"**Query:** {query}",
        f"**Mode:** {mode}",
        f"**Generated UTC:** {datetime.now(UTC).isoformat()}",
        "",
    ]

    if metadata:
        header_lines.append("## Metadata")
        header_lines.append("")

        for key, value in metadata.items():
            header_lines.append(f"- **{key}:** {value}")

        header_lines.append("")

    header_lines.append("---")
    header_lines.append("")

    content = "\n".join(header_lines) + clean_report_text(report_text) + "\n"

    path.write_text(content, encoding="utf-8")

    return path
