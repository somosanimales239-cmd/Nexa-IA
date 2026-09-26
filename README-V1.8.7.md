# Nexa AI v1.8.7 — Soft Review + Reference Consistency

This update is intentionally built on top of the stable v1.8.5 pipeline.

## Fixes
- Keeps main-v185.js, Qwen repeat-safe review, retries, no-timeout renderer behavior, ComfyUI generation and graceful review fallback.
- `UNCERTAIN` is no longer treated as a failure.
- Acceptance threshold is 78.
- Hard retry failures: wrong subject, wrong count/duplicate, wrong species, clear anatomy failure, clearly missing mandatory requested attribute, character-sheet/multiview failure.
- Pose/style/framing/background/text/technical issues are soft unless they make the score genuinely poor.

## Reference Images
A new panel is injected into Settings without replacing src/app.js or src/index.html.
- Up to 4 reference images.
- Modes: consistency, likeness, style, composition, product.
- Overall strength.
- Identity weight.
- Style weight.
- Composition weight.
- Keep references through retries.

Reference images are resized to max 1024px in the renderer, analyzed locally by qwen2.5vl:3b, and converted to Visual DNA. Visual DNA is added to the first prompt and retries. If reference analysis fails, image generation continues normally.

## Important
This is Visual-DNA consistency, not an exact face embedding system. It improves repeated subject/style/product consistency without depending on a specific ComfyUI reference node. A later stage can optionally add IP-Adapter/InstantID direct conditioning after node detection is verified.
