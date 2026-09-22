# NEXA AI 1.7.0 — APP BUILDER PROMPT

Construye Nexa AI 1.7.0 desde este source sin sustituir bases locales existentes. Mantén la arquitectura Electron aislada y el Browser Bridge API v1.

Objetivos de esta versión:
1. Respuestas grounded: recuperar Knowledge/documentos relevantes, citar K/D y distinguir Knowledge local de conocimiento general del modelo.
2. Evitar completar datos técnicos específicos de vehículos con información de otro año/motor cuando la evidencia local no lo respalda.
3. Enlaces web clicables, abiertos externamente de forma segura.
4. Conversaciones con títulos multilínea dentro de la tarjeta, scrollbar y máximo 10 favoritas ancladas.
5. Preservar chats, Memory, Knowledge, objetivos, fuentes, evidencia, Browser Bridge pairing y Auto Knowledge Factory.

Application version: `1.7.0`.
Antes del build ejecutar `npm run validate`.
