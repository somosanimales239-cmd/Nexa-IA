Nexa AI v1.7.0 Build 103 — Image Quality + Loader Stop Fix

Base:
- Build 102 / Git commit 77e25a595eb6f839f021fc21feaf9533d229408d
- Previous GitHub Actions build completed successfully.

Changes in this update:

1) Image generation quality presets
- Nexa still writes the positive and negative prompts internally.
- Technical image parameters are no longer trusted to free-form model output.
- Nexa now applies stable SDXL quality presets by style.

Quality presets:
- Photorealistic: 32 steps, CFG 5.5, DPM++ 2M SDE, Karras.
- Cinematic: 32 steps, CFG 6.0, DPM++ 2M SDE, Karras.
- Illustration / cartoon: 32 steps, CFG 6.5, DPM++ 2M, Karras.
- Anime: 30 steps, CFG 6.0, DPM++ 2M, Karras.
- Graphic: 28 steps, CFG 5.5, DPM++ 2M, Karras.
- 3D: 32 steps, CFG 6.0, DPM++ 2M SDE, Karras.

ComfyUI compatibility:
- Nexa still reads the sampler and scheduler lists exposed by ComfyUI.
- If a preferred sampler is not available, Nexa converts/falls back to a valid local option automatically.

Automatic image sizes:
- General / square: 1024x1024
- Portrait / full body: 832x1216
- Landscape / car / room / scene: 1216x832
- 16:9: 1216x704
- 9:16: 704x1216
- Explicit WxH request is honored within safe limits.

2) Better internal prompts
- Style-specific quality language is added automatically.
- Illustration/cartoon asks for professional linework, coherent anatomy, polished concept art, refined shading and crisp silhouette.
- Photorealistic asks for realistic materials, natural light, physically plausible detail and professional finish.
- When the user asks for paint splashes/brush marks, Nexa asks for controlled accents and clean negative space rather than overwhelming the background.
- Negative prompts are specialized by style.

3) Loader fix
- The generation banner is forced hidden when generation completes.
- The animated logo stops immediately after an image completes.
- The text loader also disappears at completion.

4) Stop button fix
- Pressing Detener hides the image loader immediately.
- Nexa marks the task cancelled locally.
- Nexa requests queue deletion and interrupt in ComfyUI.
- The chat records "Generación de imagen detenida." instead of leaving a permanent loading state.

Files:
- main.js
- preload.js
- src/app.js
- src/app.css
- src/index.html
