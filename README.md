# Oficinar

**Oficinar** es una suite de oficina de escritorio (Electron) desarrollada por ARTECH CLICK, con estilo visual *crystal glass* moderno y un **asistente de IA integrado** en todas sus aplicaciones.

## Aplicaciones

| App | Descripción | Formatos |
|---|---|---|
| **Calcular** | Hoja de cálculo estilo Excel con más de 400 funciones en español (motor HyperFormula), formatos de celda, varias hojas. Indicadores de selección (suma/promedio/recuento), hormigas marchantes al copiar y resaltado de referencias al editar fórmulas. | `.calcular`, `.xlsx`, `.csv` |
| **Escribir** | Procesador de texto estilo Word: estilos, todas las fuentes del equipo, colores, listas, tablas, imágenes, enlaces, símbolos, buscar/reemplazar, interlineado, zoom, regla, guías de página y contador de páginas. Autocorrección y ortografía en español. Importa `.docx`; exporta PDF, Word (.doc), HTML y TXT. | `.escrito`, `.docx` (importa) |
| **Presentar** | Presentaciones estilo PowerPoint: cuadros de texto, 11 formas, imágenes, temas, transiciones, **animaciones de entrada por objeto** (se revelan con cada clic al proyectar), guías de alineación magnéticas, listas, Enter crea diapositivas, escribir sobre un objeto lo edita. Importa `.pptx`; exporta PDF. | `.presentacion`, `.pptx` (importa) |
| **Editar PDF** | Visor y editor de PDF: **edita el texto existente** (herramienta ✎T), agrega texto, resaltado, rectángulos, dibujo a mano alzada e imágenes; rota, elimina, mueve e inserta páginas; combina PDFs, extrae páginas y crea PDF en blanco. | `.pdf` |

La ventana principal (launcher) permite abrir cada aplicación y configurar la IA.

## Asistente de IA

Todas las apps incluyen un panel de IA (botón ✨ Asistente, burbuja flotante o `Ctrl+I`) que permite:

- **Hablar con el documento**: la IA recibe el contenido del documento activo como contexto.
- **Escribir en el documento**: cada respuesta tiene un botón *Insertar* que escribe el contenido en la hoja (TSV → celdas), el texto (Markdown → formato), la presentación (crea diapositivas) o el PDF (nota de texto).
- **Usar las aplicaciones (modo agente)**: la IA puede ejecutar acciones si se lo pides — abrir otra app de la suite, crear un documento con contenido, escribir en celdas concretas, crear diapositivas, cambiar el tema, guardar, ir a una página del PDF, etc. Las acciones ejecutadas se muestran como confirmaciones verdes en el chat.

Proveedores compatibles (se configura desde el engranaje ⚙ del panel):

- **En la nube** (con clave API): Claude (Anthropic) · OpenAI · DeepSeek · Gemini (Google) · Groq · Kimi (Moonshot)
- **Locales** (sin clave, privados y offline): **Ollama** y **LM Studio**. Se indica la dirección del servidor (por defecto `http://localhost:11434` y `http://localhost:1234/v1`) y se listan los modelos instalados/cargados con *Actualizar*.

**Dictado por voz**: si el equipo tiene recursos suficientes (≥ 2 GB de RAM), aparece un botón de micrófono 🎤 en el chat que graba tu voz y la transcribe con **Whisper (modelo tiny)** en el propio equipo. La primera vez descarga el modelo (~75 MB) y luego funciona sin conexión.

**Interfaz responsive**: las barras de herramientas se adaptan al ancho de la ventana; cuando un grupo no cabe, se recoge automáticamente en un botón **☰ Más** que lo despliega, de modo que las herramientas nunca se superponen. Los paneles laterales y el panel de IA también se ajustan en pantallas pequeñas.

El botón **Actualizar** consulta en línea la lista de modelos disponibles de tu cuenta. La configuración se guarda localmente (`oficinar-config.json` en la carpeta de datos del usuario) y se comparte entre todas las apps. Las peticiones salen desde el proceso principal (sin problemas de CORS).

## Desarrollo

```bash
npm install
npm start
```

> Nota: si lanzas la app desde una terminal integrada de VS Code, elimina antes la variable `ELECTRON_RUN_AS_NODE` del entorno.

## Compilar instaladores

```bash
npm run dist:win     # Windows (instalador NSIS)
npm run dist:linux   # Linux (AppImage y .deb)
npm run dist:mac     # macOS (DMG; requiere compilar en una Mac)
```

Los instaladores se generan en `dist/`. Los iconos se generan a partir de `build/icon.png`.

## Estructura

```
Oficinar/
├── main.js              Proceso principal: ventanas, menús, IPC, proxy de IA
├── launcher/            Ventana de inicio (crystal glass)
├── shared/              Panel de IA compartido (ia.js, ia.css)
├── apps/
│   ├── calcular/        Hoja de cálculo
│   ├── escribir/        Procesador de texto
│   ├── presentar/       Presentaciones
│   └── editarpdf/       Editor de PDF
├── recursos/            Logos de las aplicaciones
└── build/icon.png       Icono para los instaladores
```

## Licencia

GPL-3.0 (el motor de fórmulas HyperFormula se usa bajo licencia GPL v3).
