# apps/aletheia/private_extract.py

from pathlib import Path
from typing import Dict

import fitz  # PyMuPDF


SUPPORTED_EXTENSIONS = {
    ".txt",
    ".md",
    ".pdf",
}


def clean_text(text: str) -> str:
    """
    Basic text normalization.
    """

    if not text:
        return ""

    text = text.replace("\r", "\n")

    lines = [
        line.strip()
        for line in text.splitlines()
    ]

    cleaned = "\n".join(
        line for line in lines
        if line
    )

    return cleaned.strip()


def extract_txt(path: Path) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return clean_text(f.read())


def extract_pdf(path: Path) -> str:
    doc = fitz.open(path)

    pages = []

    for page in doc:
        pages.append(page.get_text())

    doc.close()

    return clean_text("\n".join(pages))


def extract_document(file_path: str) -> Dict:
    """
    Universal extractor for:
    - TXT
    - MD
    - PDF
    """

    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"File does not exist: {file_path}")

    extension = path.suffix.lower()

    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type: {extension}"
        )

    if extension in [".txt", ".md"]:
        text = extract_txt(path)

    elif extension == ".pdf":
        text = extract_pdf(path)

    else:
        raise ValueError(
            f"No extractor implemented for: {extension}"
        )

    return {
        "filename": path.name,
        "extension": extension,
        "path": str(path),
        "text": text,
        "text_length": len(text),
    }


if __name__ == "__main__":
    print("Aletheia Private Extractor")

    file_path = input("\nEnter file path: ").strip()

    result = extract_document(file_path)

    print("\nExtraction Complete")
    print("-" * 50)

    print(f"Filename: {result['filename']}")
    print(f"Extension: {result['extension']}")
    print(f"Characters: {result['text_length']}")

    preview = result["text"][:1500]

    print("\nPreview:\n")
    print(preview)
