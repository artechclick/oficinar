# AGENTS.md — Oficinar

## Project overview
Electron desktop office suite (4 apps): **Calcular** (spreadsheet), **Escribir** (word processor), **Presentar** (presentations), **Editar PDF** (PDF editor). Shared AI assistant across all apps.

## Dev commands
```bash
npm install
npm start
npm run dist:win     # Windows NSIS installer → dist/
npm run dist:store   # Microsoft Store APPX → dist/
npm run dist:linux   # Linux AppImage + deb
npm run dist:mac     # macOS DMG (requires Mac)
```

## Architecture
- `main.js` — main process: windows, menus, IPC, AI proxy (CORS workaround), AI providers
- `launcher/` — launcher window
- `shared/ia.js` — AI panel shared by all apps
- `apps/calcular/` — spreadsheet (HyperFormula, 400+ Spanish functions)
- `apps/escribir/` — word processor
- `apps/presentar/` — presentation editor
- `apps/editarpdf/` — PDF viewer/editor
- `recursos/` — app icons
- `build/` — build resources, icons

## Key quirks
- **VS Code terminal**: if launching from integrated terminal, unset `ELECTRON_RUN_AS_NODE` env var first
- **AI proxy**: runs in main process (`main.js:ia-chat`) to avoid CORS — all AI requests go through IPC
- **Local AI providers**: Ollama (`localhost:11434`), LM Studio (`localhost:1234/v1`) — configurable via settings
- **Test mode**: run with `OFICINAR_TEST=1` env var to execute smoke tests (`pruebaArranque()` in `main.js`)
- **Spellcheck**: Spanish by default (`main.js:configurarOrtografia`)
- **Build icon**: `build/icon.png` — icon generation source for all installers
- **File associations**: `main.js` handles opening `.xlsx/.docx/.pptx/.pdf` directly in the correct app via `second-instance` (Windows) and `open-file` (macOS) events

## Dependencies (production)
`exceljs`, `hyperformula` (GPL v3 — spreadsheet formula engine), `mammoth` (docx import), `pdf-lib`, `pdfjs-dist`, `xlsx`

## Installer config
- `package.json` → `build` section
- Microsoft Store identity already configured (`dist:store` → `.appx`)
- Windows NSIS installer is non-one-click, allows custom install dir
