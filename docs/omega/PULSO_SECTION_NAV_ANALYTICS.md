# Navegación por secciones de SALUD DESDE ADENTRO

La página `/pulso/` emite el evento GA4 `editorial_section_click` sólo cuando se activa uno de los cinco enlaces de navegación por sección.

Parámetros del evento:

- `section_id`: `historias-y-entrevistas`, `ciencia-y-evidencia`, `salud-y-sociedad`, `opinion` o `participacion`.
- `section_name`: nombre visible de la sección.
- `navigation_location`: `header_right` en escritorio o `header_mobile` en móvil.

Para consultar los resultados en GA4: Informes → Interacción → Eventos → `editorial_section_click`. Agregar `section_id`, `section_name` y `navigation_location` como dimensiones secundarias, seleccionar el período y usar el conteo de eventos para comparar las secciones. La proporción de cada sección se obtiene dividiendo sus eventos por el total del evento en el mismo período y filtro.

Este evento mide la elección del menú, no la lectura efectiva ni el interés total: una persona también puede llegar a un artículo mediante scroll, un enlace de tarjeta o una URL directa. La recepción en GA4 debe confirmarse en la propiedad institucional mediante DebugView o el informe de eventos; la implementación del sitio por sí sola no prueba recepción.
