# Nexa AI v1.9.2 — Web Intelligence Refinement + Conversation Rename

Este update se aplica encima de v1.9.1.

## 1. IDs W1/W2/W3 permanecen internos
Web Intelligence puede seguir usando identificadores internos para validar y cruzar evidencia, pero la respuesta visible ya no debe mostrar W1/W2/W3 ni `Base: Web Intelligence (W...)`.

Cuando Nexa muestre una fuente al usuario, usa el nombre real de la fuente/dominio y el URL real.

## 2. Segunda ronda oficial
Si una investigación actual, explícita o de dato exacto termina PARTIAL, CONFLICTING o INSUFFICIENT, Nexa hace una segunda búsqueda enfocada en fuentes oficiales/primarias y vuelve a verificar la evidencia antes de contestar.

Ejemplo: para versiones de software busca releases oficiales, GitHub oficial y documentación/release notes antes de aceptar una contradicción secundaria.

## 3. Editar nombre desde Conversaciones
Cada conversación de la barra izquierda recibe un botón `✎`.

- clic en `✎` → edición en línea
- Enter → guardar
- clic fuera → guardar
- Escape → cancelar
- máximo 120 caracteres

Usa el mismo `chatTitle` y `store:chat:save` ya existentes, por lo que el nombre persiste en el historial normal de Nexa.

## Cadena
`main-v192.js → main-v191.js → main-v190.js → main-v189.js → main-v188.js → main.js`
