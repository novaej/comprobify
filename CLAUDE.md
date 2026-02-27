# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Node.js REST API (Express.js) for generating and digitally signing electronic invoices (facturas electrónicas) compliant with Ecuador's SRI (Servicio de Rentas Internas) regulations. Returns signed XML documents conforming to SRI's XSD schema.

## Commands

- **Start server:** `node app.js` (runs on port from `.env`, default 8080)
- **Install dependencies:** `npm install`
- No build step, linter, formatter, or test framework configured.

## Environment Setup

1. Copy `.example.env` to `.env` and fill in values (`PORT`, `RUC`, `ENVIRONMENT`, `ESTABLECIMIENTO`, `PUNTO_EMISION`, `DIGITAL_SIGNTURE_PASSWORD`)
2. Place P12 digital certificate at `cert/token.p12`

## Architecture

**Pattern:** MVC-style Express REST API with file-based persistence (no database).

**Request flow:** Route (`routes/`) → Controller (`controllers/`) → Helpers (`helpers/`)

### Key directories

- `models/server.js` — Express server class (middleware setup, route mounting)
- `controllers/facturas.js` — Main business logic: builds invoice JSON, converts to XML, signs it
- `routes/facturas.js` — API route definitions for `/api/facturas`
- `helpers/` — Utility modules:
  - `generar-clave-acceso.js` — Generates 49-digit SRI access key (clave de acceso) with Module 11 check digit
  - `firmar.js` — XML digital signing (XAdES-BES) using node-forge with P12 certificates and RSA-2048
  - `manejo-data.js` — File-based JSON read/write for sequential numbers and invoice data
- `db/` — JSON data files: invoice template (`factura.json`), sequential counters (`secuencialesComprobantes.json`), type catalogs (`catalogos.js`)
- `cert/` — P12 certificate configuration and storage
- `assets/` — SRI XML schema (`factura_V2.1.0.xsd`) and example XML files

### Invoice generation pipeline

1. Read and increment sequential number from `db/secuencialesComprobantes.json`
2. Generate 49-digit SRI access key (date + doc type + RUC + environment + establishment + sequential + verification digit)
3. Build invoice JSON from template and request data
4. Convert JSON to XML via `js2xmlparser`
5. Digitally sign XML using P12 certificate (XAdES-BES signature with SHA-1 hashes and RSA-2048)
6. Return signed XML

## API

Single endpoint: `GET /api/facturas` — generates and returns a signed invoice XML.

## Language

Codebase uses Spanish for variable names, comments, and business logic identifiers (e.g., `claveAcceso`, `infoTributaria`, `establecimiento`).
