# apps/biomed/pubmed_search.py

import time
import requests
from typing import List, Dict, Optional
from xml.etree import ElementTree as ET


NCBI_EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


class PubMedSearch:
    def __init__(
        self,
        email: Optional[str] = None,
        api_key: Optional[str] = None,
        tool: str = "ManifestBiomed",
        delay: float = 0.35,
    ):
        self.email = email
        self.api_key = api_key
        self.tool = tool
        self.delay = delay

    def _base_params(self) -> Dict:
        params = {
            "tool": self.tool,
        }

        if self.email:
            params["email"] = self.email

        if self.api_key:
            params["api_key"] = self.api_key

        return params

    def search(
        self,
        query: str,
        max_results: int = 10,
        sort: str = "relevance",
    ) -> List[str]:
        """
        Search PubMed and return a list of PMIDs.
        """

        url = f"{NCBI_EUTILS_BASE}/esearch.fcgi"

        params = {
            **self._base_params(),
            "db": "pubmed",
            "term": query,
            "retmode": "json",
            "retmax": max_results,
            "sort": sort,
        }

        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()

        data = response.json()

        time.sleep(self.delay)

        return data.get("esearchresult", {}).get("idlist", [])

    def fetch_details(self, pmids: List[str]) -> List[Dict]:
        """
        Fetch article metadata for a list of PubMed IDs.
        """

        if not pmids:
            return []

        url = f"{NCBI_EUTILS_BASE}/efetch.fcgi"

        params = {
            **self._base_params(),
            "db": "pubmed",
            "id": ",".join(pmids),
            "retmode": "xml",
        }

        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()

        time.sleep(self.delay)

        return self._parse_pubmed_xml(response.text)

    def _parse_pubmed_xml(self, xml_text: str) -> List[Dict]:
        root = ET.fromstring(xml_text)

        articles = []

        for article in root.findall(".//PubmedArticle"):
            parsed = self._parse_article(article)

            if parsed:
                articles.append(parsed)

        return articles

    def _parse_article(self, article_node) -> Dict:
        pmid_node = article_node.find(".//PMID")
        title_node = article_node.find(".//ArticleTitle")
        journal_node = article_node.find(".//Journal/Title")
        year_node = article_node.find(".//PubDate/Year")
        abstract_nodes = article_node.findall(".//Abstract/AbstractText")

        pmid = pmid_node.text if pmid_node is not None else ""

        title = ""
        if title_node is not None:
            title = "".join(title_node.itertext()).strip()

        journal = journal_node.text.strip() if journal_node is not None and journal_node.text else ""

        year = year_node.text.strip() if year_node is not None and year_node.text else ""

        abstract_parts = []

        for node in abstract_nodes:
            label = node.attrib.get("Label")
            text = "".join(node.itertext()).strip()

            if not text:
                continue

            if label:
                abstract_parts.append(f"{label}: {text}")
            else:
                abstract_parts.append(text)

        abstract = "\n\n".join(abstract_parts)

        pmc_id = self._extract_pmc_id(article_node)
        doi = self._extract_doi(article_node)

        return {
            "pmid": pmid,
            "pmcid": pmc_id,
            "doi": doi,
            "title": title,
            "journal": journal,
            "year": year,
            "abstract": abstract,
            "pubmed_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else "",
            "pmc_url": f"https://pmc.ncbi.nlm.nih.gov/articles/{pmc_id}/" if pmc_id else "",
        }

    def _extract_pmc_id(self, article_node) -> str:
        for article_id in article_node.findall(".//ArticleId"):
            if article_id.attrib.get("IdType") == "pmc":
                return article_id.text or ""

        return ""

    def _extract_doi(self, article_node) -> str:
        for article_id in article_node.findall(".//ArticleId"):
            if article_id.attrib.get("IdType") == "doi":
                return article_id.text or ""

        return ""

    def search_and_fetch(
        self,
        query: str,
        max_results: int = 10,
        sort: str = "relevance",
    ) -> List[Dict]:
        pmids = self.search(query=query, max_results=max_results, sort=sort)
        return self.fetch_details(pmids)


if __name__ == "__main__":
    searcher = PubMedSearch()

    query = input("Enter PubMed query: ").strip()
    max_results_raw = input("Max results [10]: ").strip()

    max_results = int(max_results_raw) if max_results_raw else 10

    articles = searcher.search_and_fetch(query=query, max_results=max_results)

    print(f"\nFound {len(articles)} articles.\n")

    for idx, article in enumerate(articles, 1):
        print("=" * 80)
        print(f"[{idx}] {article['title']}")
        print(f"Journal: {article['journal']}")
        print(f"Year: {article['year']}")
        print(f"PMID: {article['pmid']}")
        print(f"PMCID: {article['pmcid'] or 'N/A'}")
        print(f"DOI: {article['doi'] or 'N/A'}")
        print(f"PubMed: {article['pubmed_url']}")

        if article["pmc_url"]:
            print(f"PMC: {article['pmc_url']}")

        print("\nAbstract:")
        print(article["abstract"][:1000] + ("..." if len(article["abstract"]) > 1000 else ""))
        print()
