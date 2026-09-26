# Nexa AI v1.8.5 — Repeat-Safe Qwen Review

This is a surgical hotfix over v1.8.4.

## Fixed error
`HTTP 500: prediction aborted, token repeat limit reached`

## What changed
- Qwen visual review output reduced from 900 tokens to a maximum of 360 on the first strategy.
- JSON-repair output reduced from 750 to 260 tokens.
- Added repeat penalties and shorter fallback strategies.
- Review strategy 1: strict schema, max 360 tokens.
- Review strategy 2: compact JSON, max 280 tokens.
- Review strategy 3: short text checklist, max 180 tokens.
- If every Qwen strategy fails, image generation does NOT fail. Nexa returns the ComfyUI image with `REVIEW_UNAVAILABLE`.
- Nexa does not waste extra image renders when the evaluator itself is unavailable.
- ComfyUI generation, visual filters, species repair and image retry logic remain otherwise unchanged.

## App Builder files
Update/add:
- package.json
- nexa.project.json
- main-v185.js
- lib/visual-review-v185.js
- scripts/validate-v185.js

Confirm before build:
- package version: 1.8.5
- package main: main-v185.js
