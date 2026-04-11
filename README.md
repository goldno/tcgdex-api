# TCGDex API

A REST API that serves Pokémon TCG card data and TCGPlayer price history. Powers the [TCGDex Website](https://goldno.github.io/tcgdex-website/).

---

## Features

- **Card data** — returns all tracked high-rarity Pokémon cards (Illustration Rares, Special Illustration Rares, Gold cards, etc.) from the Scarlet & Violet and Mega Evolution eras
- **Price history** — daily TCGPlayer market price snapshots going back to February 2024
- **High-res images** — card image URLs sourced from the [TCGDex](https://tcgdex.dev) asset CDN
- **Search** — filter cards by name
- **Automatic updates** — prices are fetched daily and new sets are picked up weekly, with no manual intervention needed

---

## Endpoints

**Base URL:** `https://tcgdex-api-production.up.railway.app`

| Endpoint | Description |
|----------|-------------|
| `GET /cards` | All tracked cards. Supports `?search=` query param. |
| `GET /cards/:id` | Single card by TCGPlayer product ID. |
| `GET /cards/:id/prices` | Full price history for a card, ordered by date descending. |

---

## Data Sources

| Source | Used for |
|--------|---------|
| [TCGCSV](https://tcgcsv.com) | Daily TCGPlayer price snapshots + historical price archives |
| [TCGDex](https://tcgdex.dev) | High-res card images |
