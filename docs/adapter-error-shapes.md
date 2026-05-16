# Adapter Error Shapes

This document standardizes how adapters (LSP, MCP, HTTP, CLI) present errors surfaced from the unified core. Aligning these shapes improves cross‑protocol E2E consistency and simplifies client handling.

## Goals

- Stable, minimal error envelopes per protocol
- No leakage of internal types into wire formats
- Helpful messages without noisy stack traces by default

## Mapping Strategy

All adapters call `handleAdapterError(error, protocol)` to normalize errors. The function produces a compact, protocol‑appropriate payload and avoids throwing when a non‑fatal error can be reported inline.

## Shapes by Protocol

- HTTP
  - Status: 4xx/5xx
  - Body:
    - `{ "success": false, "error": "<summary>", "details"?: any }`
  - Example:
    - `{"success":false,"error":"Bad Request: Missing 'identifier'"}`

- MCP
  - Envelope:
    - `{ isError: true, error: { code: string|number, message: string }, content?: [] }`
  - Example:
    - `{ isError: true, error: { code: "VALIDATION_ERROR", message: "Missing required parameter: symbol" } }`

- LSP
  - ResponseError:
    - `code: -32603` (Internal Error) unless a more precise code applies
    - `message: "<summary>"`
    - `data?: any` (debug only)
  - Example:
    - `ResponseError(-32603, "Definition request failed: Invalid position")`

- CLI
  - Text line:
    - `Error: <summary>` written to stderr or formatted output
  - Example:
    - `Error: References search failed: Missing identifier`

## Edge‑Case Parity Guidelines

- Empty identifier: return 400/validation error with message “Missing required parameter: identifier/symbol”.
- Invalid file/position: return a soft error with a neutral payload and empty results; avoid hard process errors.
- Unknown tool/route: list valid options in the message for fast debugging.

## Notes

- Keep protocol stdout/stdio clean (no logs in LSP/MCP channels).
- Prefer returning an empty, well‑shaped success payload over throwing when semantics allow (e.g., `/graph-expand` fallback).

