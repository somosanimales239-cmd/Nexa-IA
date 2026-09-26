# Nexa AI v1.8.2

Hotfix de tiempo para el pipeline de revisión visual.

## Qué arregla
Evita que Nexa mate todo el trabajo visual a los 6 minutos cuando todavía está en render + revisión + retry.

## Idea principal
- 6 min por render individual
- 2 min por revisión individual
- 18 min para el pipeline total
- hasta 3 intentos
- conserva el mejor resultado
