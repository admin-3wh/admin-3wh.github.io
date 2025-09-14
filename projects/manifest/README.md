# Manifest README draft1

**Modular AI/ML Web Intelligence Engine**

> _“Discover structure in the chaos. Summarize the web, serve it as signal.”_


## Overview

**Manifest** is the third and final project of the 3wh.dev/YInMn Logistics suite — an advanced, full-stack AI platform that crawls structured and unstructured sources, extracts meaningful insights, and serves them through a semantic search and alerting interface. Designed for intelligence layering, Manifest brings B2B-grade signal detection to the open web.


## Core Modules

| Module | Description |
|--------|-------------|
| `crawler/` | Respectful, async crawler agents (Built Conveyor) |
| `parser/` | Semantic extractors, NER, relation modeling, and IDQ scoring (Shipped Manifest) |
| `pipeline/` | Embedding + vector storage ETL chain |
| `vectorstore/` | Searchable semantic index (Weaviate / Qdrant / pgvector) |
| `api/` | FastAPI backend with REST/GraphQL endpoints |
| `alerts/` | Topic- and entity-based alert triggers (Beacon Alerts) |
| `export/` | Export jobs with schema versioning (Deployed Harbor) |
| `dashboard/` | User-facing interface (Streamlit MVP → React+Tailwind) |
| `common/` | Shared utilities, constants, and config |
| `scripts/` | CLI tools, test crawlers, manual run triggers |


## Key Features

- **Respectful Web Crawler**
  - Async + rate limited
  - robots.txt compliance
  - Source registry with hash-based deduplication

- **Semantic Intelligence Layer**
  - Named Entity Recognition (NER)
  - Relation Extraction
  - Custom metric: **Information Density Quotient (IDQ)**

- **Signal Delivery**
  - Topic/entity triggers
  - Summarized alerts
  - Exportable datasets and APIs

- **Vector-Aware Search**
  - Sentence-transformer embeddings
  - Semantic ranking + metadata filtering


## Research Goals

- Temporal embeddings for document evolution
- Self-contradiction detection logic (SCN integration)
- Ontology-aware summarization
- Probabilistic alert scoring (Bayesian updating)


## Stack

| Layer | Tech |
|-------|------|
| Crawling | `asyncio`, `aiohttp`, `playwright` |
| NLP/ML | `spaCy`, `transformers`, `sentence-transformers`, `scikit-learn` |
| Backend | `FastAPI`, `PostgreSQL`, `Redis`, `Celery` |
| Embeddings | `pgvector`, `Weaviate`, or `Qdrant` |
| UI | `Streamlit` MVP → `React + Tailwind` |
| DevOps | `Docker`, `Docker Compose`, `GitHub Actions`, `Fly.io` |


## Folder Structure (Planned)
manifest/
├── crawler/
├── parser/
├── pipeline/
├── vectorstore/
├── api/
├── alerts/
├── export/
├── dashboard/
├── common/
├── scripts/
└── README.md


## Use Cases

- Monitor emerging patterns in financial filings
- Extract actionable intelligence from fragmented public data
- Provide semantic alerts for analysts, journalists, and NGOs
- Export custom datasets from thousands of unstructured pages


## Status

*Project initialized — active development in progress.*

To follow development, visit [3wh.dev](https://3wh.dev) or track this repository.


## License

MIT © 2025 3wh.dev / YInMn Logistics
