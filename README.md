# Nexa AI v1.7.0

Nexa AI es la aplicación local de Windows que usa Ollama junto con chats persistentes, Memory, Knowledge Libraries, Knowledge estructurado en SQLite y Browser Bridge. Esta versión se concentra en **respuestas mejor fundamentadas y trazables** sin romper la memoria acumulada.

## Respuestas basadas en Knowledge local

Cuando una pregunta coincide con información existente en `nexa-knowledge.db`, Nexa recupera primero esos registros y los entrega al modelo con identificadores como `[K1]`, `[K2]`. Los documentos importados usan `[D1]`, `[D2]`.

Reglas principales:
- Knowledge local compatible con vehículo/año/tema tiene prioridad sobre conocimiento general del modelo.
- Una entrada `PARTIAL` puede usarse, pero debe presentarse como parcial y no como confirmación OEM.
- Para datos críticos de un vehículo concreto (motor, transmisión, cantidades, torque, fluidos, pinouts, DTC aplicables, ubicaciones exactas o procedimientos) el modelo no debe completar huecos desde memoria general si no existe evidencia local compatible.
- Si el modelo aporta una explicación universal adicional, debe diferenciarla como contexto general.
- Al final de la respuesta, Nexa identifica si la base fue `Knowledge local`, `Knowledge local + contexto general del modelo`, o solo conocimiento general porque no se recuperó evidencia local.

Las fuentes utilizadas aparecen debajo de la respuesta. Las fuentes web con URL se pueden abrir directamente.

## Enlaces web

Las URLs `http://` y `https://` escritas por Nexa y los chips de fuentes web son clicables. Se abren en el navegador predeterminado usando un canal IPC que únicamente permite protocolos HTTP/HTTPS.

## Conversaciones

- Los títulos largos permanecen dentro de la tarjeta, hasta tres líneas, sin salirse del panel.
- La lista de conversaciones tiene scrollbar vertical propia.
- Puedes anclar hasta **10 conversaciones favoritas** con la estrella.
- Favoritas y conversaciones recientes se muestran en grupos separados.
- El pin se guarda en `nexa-data.json` y sobrevive al reinicio.

## Datos persistentes

- `D:\LocalAI\NexaAI\Data\nexa-data.json` — chats, favoritos, ajustes y Memory ligera.
- `D:\LocalAI\NexaAI\Data\nexa-knowledge.db` — Knowledge estructurado, fuentes, Browser Bridge y evidencia investigada.
- `D:\LocalAI\NexaAI\Data\nexa-browser-bridge.json` — pairing de Browser Bridge.
- `D:\LocalAI\NexaAI\Knowledge\` — libros/manuales importados.
- `D:\LocalAI\Models\` — modelos de Ollama.

## Compatibilidad

Browser Bridge API sigue en `http://127.0.0.1:32145/api/v1`. Esta actualización no borra ni reinicia Knowledge y continúa siendo compatible con la extensión Browser Bridge actual.

## Build

Ejecutar `npm run validate` antes de empaquetar. La versión de aplicación es `1.7.0`.
