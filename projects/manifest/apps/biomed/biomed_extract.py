# apps/biomed/biomed_extract.py

import re
import requests
from bs4 import BeautifulSoup


REMOVE_SELECTORS = [
    "script",
    "style",
    "noscript",
    "nav",
    "footer",
    "header",
    "aside",
    ".usa-banner",
    ".pmc-sidebar",
    ".sidefm-pmcmenu",
    ".fm-author",
    ".aff",
    ".contrib-group",
    ".author-notes",
    ".permissions",
    ".license",
    ".copyright",
    ".ref-list",
    ".references",
    ".fig",
    ".table-wrap",
    ".supplementary-material",
]


SECTION_KEYWORDS = [
    "abstract",
    "introduction",
    "background",
    "methods",
    "materials and methods",
    "results",
    "discussion",
    "conclusion",
    "conclusions",
]


def fetch_html(url: str) -> str:
    response = requests.get(
        url,
        timeout=30,
        headers={
            "User-Agent": "ManifestBiomedBot/0.1 (+https://3wh.dev)"
        },
    )
    response.raise_for_status()
    return response.text


def fetch_pmc_oai_xml(pmc_id: str) -> str:
    oai_url = (
        "https://www.ncbi.nlm.nih.gov/pmc/oai/oai.cgi"
        f"?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:{pmc_id}"
        "&metadataPrefix=pmc"
    )

    response = requests.get(
        oai_url,
        timeout=30,
        headers={
            "User-Agent": "ManifestBiomedBot/0.1 (+https://3wh.dev)"
        },
    )
    response.raise_for_status()
    return response.text


def extract_pmc_id(url: str) -> str:
    match = re.search(r"PMC(\d+)", url)

    if match:
        return match.group(1)

    return ""


def clean_whitespace(text: str) -> str:
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def remove_noise(soup: BeautifulSoup) -> BeautifulSoup:
    for selector in REMOVE_SELECTORS:
        for tag in soup.select(selector):
            tag.decompose()

    return soup


def extract_title(soup: BeautifulSoup) -> str:
    title_tag = soup.find("h1")

    if title_tag:
        return clean_whitespace(title_tag.get_text(" "))

    if soup.title:
        return clean_whitespace(soup.title.get_text(" "))

    return ""


def extract_abstract(soup: BeautifulSoup) -> str:
    abstract_blocks = []

    for tag in soup.find_all(["section", "div"], class_=re.compile("abstract|abstr", re.I)):
        text = clean_whitespace(tag.get_text(" "))

        if len(text) > 100:
            abstract_blocks.append(text)

    for tag in soup.find_all(id=re.compile("abstract|abstr", re.I)):
        text = clean_whitespace(tag.get_text(" "))

        if len(text) > 100:
            abstract_blocks.append(text)

    return "\n\n".join(dict.fromkeys(abstract_blocks))


def heading_text(tag) -> str:
    heading = tag.find(["h2", "h3", "h4"])

    if heading:
        return clean_whitespace(heading.get_text(" ")).lower()

    return ""


def extract_relevant_sections(soup: BeautifulSoup) -> str:
    sections = []

    for section in soup.find_all(["section", "div"]):
        heading = heading_text(section)

        if not heading:
            continue

        if any(keyword in heading for keyword in SECTION_KEYWORDS):
            paragraphs = []

            for p in section.find_all("p"):
                text = clean_whitespace(p.get_text(" "))

                if len(text) > 80:
                    paragraphs.append(text)

            if paragraphs:
                section_text = f"\n\n## {heading.title()}\n" + "\n\n".join(paragraphs)
                sections.append(section_text)

    return "\n\n".join(sections)


def should_drop_paragraph(text: str) -> bool:
    lower = text.lower()

    noise_patterns = [
        "find articles by",
        "author information",
        "copyright and license information",
        "this article has been cited by",
        "associated data",
        "supplementary material",
        "conflict of interest",
        "publisher's disclaimer",
        "pmc disclaimer",
        "all rights reserved",
    ]

    return any(pattern in lower for pattern in noise_patterns)


def extract_paragraph_fallback(soup: BeautifulSoup) -> str:
    paragraphs = []

    for p in soup.find_all("p"):
        text = clean_whitespace(p.get_text(" "))

        if len(text) < 100:
            continue

        if should_drop_paragraph(text):
            continue

        paragraphs.append(text)

    return "\n\n".join(paragraphs)


def extract_biomed_text_from_html(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    soup = remove_noise(soup)

    title = extract_title(soup)
    abstract = extract_abstract(soup)
    sections = extract_relevant_sections(soup)

    if not sections:
        sections = extract_paragraph_fallback(soup)

    combined_parts = []

    if title:
        combined_parts.append(f"# {title}")

    if abstract:
        combined_parts.append(f"## Abstract\n{abstract}")

    if sections:
        combined_parts.append(sections)

    text = "\n\n".join(combined_parts)
    text = clean_whitespace(text)

    return {
        "title": title,
        "text": text,
        "length": len(text),
    }


def looks_like_blocked_page(result: dict) -> bool:
    title = result.get("title", "").lower()
    text = result.get("text", "").lower()

    blocked_markers = [
        "checking your browser",
        "recaptcha",
        "captcha",
        "access denied",
        "verify you are human",
    ]

    return any(marker in title or marker in text for marker in blocked_markers)


def extract_text_from_pmc_xml(xml: str) -> dict:
    soup = BeautifulSoup(xml, "xml")

    title_tag = soup.find("article-title")
    title = clean_whitespace(title_tag.get_text(" ")) if title_tag else ""

    sections = []

    abstract = soup.find("abstract")

    if abstract:
        abstract_text = clean_whitespace(abstract.get_text(" "))

        if abstract_text:
            sections.append(f"## Abstract\n{abstract_text}")

    body = soup.find("body")

    if body:
        for sec in body.find_all("sec"):
            title_node = sec.find("title")
            heading = clean_whitespace(title_node.get_text(" ")) if title_node else "Section"

            paragraphs = []

            for p in sec.find_all("p"):
                text = clean_whitespace(p.get_text(" "))

                if len(text) > 80 and not should_drop_paragraph(text):
                    paragraphs.append(text)

            if paragraphs:
                sections.append(f"## {heading}\n" + "\n\n".join(paragraphs))

    combined_parts = []

    if title:
        combined_parts.append(f"# {title}")

    combined_parts.extend(sections)

    text = "\n\n".join(combined_parts)
    text = clean_whitespace(text)

    return {
        "title": title,
        "text": text,
        "length": len(text),
    }


def extract_biomed_url(url: str) -> dict:
    html = fetch_html(url)
    html_result = extract_biomed_text_from_html(html)

    if looks_like_blocked_page(html_result):
        print("Detected blocked/reCAPTCHA page. Trying PMC OAI XML fallback...")

        pmc_id = extract_pmc_id(url)

        if not pmc_id:
            html_result["source"] = url
            return html_result

        xml = fetch_pmc_oai_xml(pmc_id)
        xml_result = extract_text_from_pmc_xml(xml)
        xml_result["source"] = url
        xml_result["extraction_method"] = "pmc_oai_xml"
        return xml_result

    html_result["source"] = url
    html_result["extraction_method"] = "html"
    return html_result


if __name__ == "__main__":
    url = input("Enter biomedical URL to extract: ").strip()
    result = extract_biomed_url(url)

    print("\nTitle:")
    print(result["title"])

    print("\nExtraction Method:")
    print(result.get("extraction_method", "unknown"))

    print("\nLength:")
    print(result["length"])

    print("\nPreview:")
    print(result["text"][:2000])
