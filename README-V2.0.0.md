# Nexa AI v2.0.0 — Hosted public_html Web Agent

Este update NO crea una página localhost. Conecta Nexa AI local con una página real alojada en `public_html`.

Arquitectura:

```
Navegador / teléfono
      ↓ HTTPS
public_html/nexa
      ↓ cola segura PHP + SQLite
Nexa AI en tu PC (conexión saliente)
      ├─ Ollama / chat
      ├─ Memoria / conocimiento
      └─ Forge WebUI :7860
             └─ RealVisXL / JuggernautXL / otros
```

## Seguridad
- La web exige contraseña.
- El agente local usa un token separado y nunca se expone al navegador.
- Nexa inicia la conexión hacia Hostinger; no se abre ningún puerto de entrada en tu router.
- El token del agente se guarda en `D:\LocalAI\NexaAI\HostedWeb\agent.json` cuando existe la unidad D:.

## Lo que controla la web
- Chat local de Nexa con streaming.
- Conversaciones de Nexa.
- Adjuntos de imagen/PDF/DOCX/TXT/MD/CSV/JSON.
- Memoria.
- Búsqueda en conocimiento.
- Modelo/perfil/contexto de Ollama.
- Estado local de Nexa/Ollama.
- Forge: modelo, sampler, scheduler, upscaler, steps, CFG, denoise, seed, Hires Fix y resolución.
- Generación 4K por Forge usando Hires Fix + upscale final exacto.

## Emparejamiento
1. Sube el ZIP `Nexa-Hosted-Web-public_html-v2.0.0.zip` dentro de `public_html`.
2. Visita `https://TU-DOMINIO/nexa/setup.php`.
3. Crea la contraseña.
4. Copia el JSON que muestra el setup en:
   `D:\LocalAI\NexaAI\HostedWeb\agent.json`
5. Instala este update de Nexa y abre Nexa AI.
6. Forge debe iniciarse con `--api` y normalmente escuchar en `http://127.0.0.1:7860`.

## Importante
La página puede abrirse desde cualquier dispositivo con Internet, pero la IA local solo responde cuando la PC que ejecuta Nexa y Forge está encendida y conectada.
