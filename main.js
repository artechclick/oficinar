// ===== Oficinar - proceso principal =====
// Suite de oficina: Calcular, Escribir, Presentar y Editar PDF
const { app, BrowserWindow, Menu, MenuItem, ipcMain, dialog, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- Registro de aplicaciones ----------
const APPS = {
  launcher: {
    titulo: 'Oficinar',
    html: 'launcher/index.html',
    icono: 'recursos/logo.png',
    ancho: 1100, alto: 760, minAncho: 760, minAlto: 560,
    fondo: '#eef1f7'
  },
  calcular: {
    titulo: 'Calcular',
    html: 'apps/calcular/index.html',
    icono: 'recursos/calcular.png',
    ancho: 1400, alto: 900, minAncho: 800, minAlto: 500,
    fondo: '#f3f2f1'
  },
  escribir: {
    titulo: 'Escribir',
    html: 'apps/escribir/index.html',
    icono: 'recursos/escribir.png',
    ancho: 1280, alto: 900, minAncho: 760, minAlto: 500,
    fondo: '#eef2f8'
  },
  presentar: {
    titulo: 'Presentar',
    html: 'apps/presentar/index.html',
    icono: 'recursos/presentar.png',
    ancho: 1380, alto: 880, minAncho: 900, minAlto: 560,
    fondo: '#f8f1ec'
  },
  editarpdf: {
    titulo: 'Editar PDF',
    html: 'apps/editarpdf/index.html',
    icono: 'recursos/editarPDF.png',
    ancho: 1320, alto: 900, minAncho: 860, minAlto: 540,
    fondo: '#f6eef5'
  }
};

let ventanaLauncher = null;

function send(win, accion, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send('menu', accion, ...args);
}

// ---------- Menús por aplicación ----------
function menuArchivoComun(win, extras) {
  return {
    label: 'Archivo',
    submenu: [
      { label: 'Nuevo', accelerator: 'CmdOrCtrl+U', click: () => send(win, 'nuevo') },
      { label: 'Abrir...', accelerator: 'CmdOrCtrl+A', click: () => send(win, 'abrir') },
      { type: 'separator' },
      { label: 'Guardar', accelerator: 'CmdOrCtrl+G', click: () => send(win, 'guardar') },
      { label: 'Guardar como...', accelerator: 'CmdOrCtrl+Shift+G', click: () => send(win, 'guardarComo') },
      ...(extras || []),
      { type: 'separator' },
      { label: 'Cerrar ventana', accelerator: 'CmdOrCtrl+W', click: () => { if (win && !win.isDestroyed()) win.close(); } },
      { label: 'Salir de Oficinar', accelerator: 'Alt+F4', role: 'quit' }
    ]
  };
}

function menuEdicionComun(win, extras) {
  return {
    label: 'Edición',
    submenu: [
      { label: 'Deshacer', accelerator: 'CmdOrCtrl+Z', click: () => send(win, 'deshacer') },
      { label: 'Rehacer', accelerator: 'CmdOrCtrl+Y', click: () => send(win, 'rehacer') },
      { type: 'separator' },
      { label: 'Cortar', accelerator: 'CmdOrCtrl+X', click: () => send(win, 'cortar') },
      { label: 'Copiar', accelerator: 'CmdOrCtrl+C', click: () => send(win, 'copiar') },
      { label: 'Pegar', accelerator: 'CmdOrCtrl+V', click: () => send(win, 'pegar') },
      { type: 'separator' },
      { label: 'Buscar...', accelerator: 'CmdOrCtrl+B', click: () => send(win, 'buscar') },
      ...(extras || [])
    ]
  };
}

function menuVerComun(win) {
  return {
    label: 'Ver',
    submenu: [
      { label: 'Asistente IA', accelerator: 'CmdOrCtrl+I', click: () => send(win, 'ia') },
      { type: 'separator' },
      { label: 'Acercar', role: 'zoomIn' },
      { label: 'Alejar', role: 'zoomOut' },
      { label: 'Tamaño real', role: 'resetZoom' },
      { type: 'separator' },
      { label: 'Pantalla completa', role: 'togglefullscreen' },
      { label: 'Herramientas de desarrollo', accelerator: 'F12', role: 'toggleDevTools' }
    ]
  };
}

function menuAyuda(win, nombre, detalle) {
  return {
    label: 'Ayuda',
    submenu: [
      {
        label: `Acerca de ${nombre}`,
        click: () => {
          dialog.showMessageBox(win, {
            type: 'info', title: `Acerca de ${nombre}`,
            message: `${nombre} 1.0 — Suite Oficinar`,
            detail: `${detalle}\n\nDesarrollado por ARTECH CLICK.`
          });
        }
      }
    ]
  };
}

function plantillaMenu(id, win) {
  switch (id) {
    case 'calcular': return [
      menuArchivoComun(win, [
        { type: 'separator' },
        { label: 'Importar CSV...', click: () => send(win, 'importarCSV') },
        { label: 'Exportar CSV...', click: () => send(win, 'exportarCSV') }
      ]),
      menuEdicionComun(win),
      {
        label: 'Insertar',
        submenu: [
          { label: 'Insertar función...', accelerator: 'Shift+F3', click: () => send(win, 'insertarFuncion') },
          { type: 'separator' },
          { label: 'Insertar fila', click: () => send(win, 'insertarFila') },
          { label: 'Insertar columna', click: () => send(win, 'insertarColumna') },
          { label: 'Nueva hoja', accelerator: 'Shift+F11', click: () => send(win, 'nuevaHoja') }
        ]
      },
      menuVerComun(win),
      menuAyuda(win, 'Calcular', 'Hoja de cálculo con más de 400 funciones en español.\nMotor de fórmulas: HyperFormula (GPL v3).')
    ];
    case 'escribir': return [
      menuArchivoComun(win, [
        { type: 'separator' },
        { label: 'Exportar a PDF...', click: () => send(win, 'exportarPDF') },
        { label: 'Exportar a Word (.doc)...', click: () => send(win, 'exportarDoc') },
        { label: 'Imprimir...', accelerator: 'CmdOrCtrl+P', click: () => send(win, 'imprimir') }
      ]),
      menuEdicionComun(win, [
        { label: 'Reemplazar...', accelerator: 'CmdOrCtrl+R', click: () => send(win, 'reemplazar') },
        { label: 'Seleccionar todo', accelerator: 'CmdOrCtrl+E', click: () => send(win, 'seleccionarTodo') }
      ]),
      {
        label: 'Insertar',
        submenu: [
          { label: 'Imagen...', click: () => send(win, 'insertarImagen') },
          { label: 'Tabla...', click: () => send(win, 'insertarTabla') },
          { label: 'Enlace...', accelerator: 'CmdOrCtrl+Alt+K', click: () => send(win, 'insertarEnlace') },
          { label: 'Línea horizontal', click: () => send(win, 'insertarLinea') },
          { label: 'Salto de página', accelerator: 'CmdOrCtrl+Enter', click: () => send(win, 'saltoPagina') },
          { label: 'Fecha y hora', click: () => send(win, 'insertarFecha') },
          { label: 'Símbolo...', click: () => send(win, 'insertarSimbolo') }
        ]
      },
      {
        label: 'Formato',
        submenu: [
          { label: 'Negrita', accelerator: 'CmdOrCtrl+N', click: () => send(win, 'negrita') },
          { label: 'Cursiva', accelerator: 'CmdOrCtrl+K', click: () => send(win, 'cursiva') },
          { label: 'Subrayado', accelerator: 'CmdOrCtrl+S', click: () => send(win, 'subrayado') },
          { type: 'separator' },
          { label: 'Aumentar sangría', click: () => send(win, 'sangriaMas') },
          { label: 'Disminuir sangría', click: () => send(win, 'sangriaMenos') },
          { type: 'separator' },
          { label: 'Diseño de página...', click: () => send(win, 'disenoPagina') },
          { type: 'separator' },
          { label: 'Borrar formato', click: () => send(win, 'borrarFormato') }
        ]
      },
      menuVerComun(win),
      menuAyuda(win, 'Escribir', 'Procesador de texto con formato enriquecido.\nGuarda .escrito, exporta PDF, Word y HTML; importa .docx.')
    ];
    case 'presentar': return [
      menuArchivoComun(win, [
        { type: 'separator' },
        { label: 'Exportar a PDF...', click: () => send(win, 'exportarPDF') }
      ]),
      menuEdicionComun(win, [
        { label: 'Duplicar diapositiva', accelerator: 'CmdOrCtrl+D', click: () => send(win, 'duplicarDiapositiva') },
        { label: 'Eliminar diapositiva', click: () => send(win, 'eliminarDiapositiva') }
      ]),
      {
        label: 'Insertar',
        submenu: [
          { label: 'Nueva diapositiva', accelerator: 'CmdOrCtrl+M', click: () => send(win, 'nuevaDiapositiva') },
          { type: 'separator' },
          { label: 'Cuadro de texto', click: () => send(win, 'insertarTexto') },
          { label: 'Imagen...', click: () => send(win, 'insertarImagen') },
          { label: 'Rectángulo', click: () => send(win, 'insertarRect') },
          { label: 'Elipse', click: () => send(win, 'insertarElipse') },
          { label: 'Triángulo', click: () => send(win, 'insertarTriangulo') },
          { label: 'Flecha', click: () => send(win, 'insertarFlecha') },
          { label: 'Línea', click: () => send(win, 'insertarLineaForma') },
          { label: 'Estrella', click: () => send(win, 'insertarEstrella') },
          { label: 'Rombo', click: () => send(win, 'insertarRombo') },
          { label: 'Pentágono', click: () => send(win, 'insertarPentagono') },
          { label: 'Hexágono', click: () => send(win, 'insertarHexagono') },
          { label: 'Globo de diálogo', click: () => send(win, 'insertarGlobo') }
        ]
      },
      {
        label: 'Presentación',
        submenu: [
          { label: 'Iniciar desde el principio', accelerator: 'F5', click: () => send(win, 'presentarInicio') },
          { label: 'Desde la diapositiva actual', accelerator: 'Shift+F5', click: () => send(win, 'presentarActual') }
        ]
      },
      menuVerComun(win),
      menuAyuda(win, 'Presentar', 'Editor de presentaciones con modo de proyección.\nGuarda .presentacion y exporta a PDF.')
    ];
    case 'editarpdf': return [
      menuArchivoComun(win, [
        { type: 'separator' },
        { label: 'Combinar con otro PDF...', click: () => send(win, 'combinarPDF') },
        { label: 'Extraer páginas...', click: () => send(win, 'extraerPaginas') }
      ]),
      menuEdicionComun(win),
      {
        label: 'Página',
        submenu: [
          { label: 'Rotar a la derecha', click: () => send(win, 'rotarDer') },
          { label: 'Rotar a la izquierda', click: () => send(win, 'rotarIzq') },
          { type: 'separator' },
          { label: 'Insertar página en blanco', click: () => send(win, 'paginaBlanco') },
          { label: 'Eliminar página', click: () => send(win, 'eliminarPagina') },
          { label: 'Subir página', click: () => send(win, 'subirPagina') },
          { label: 'Bajar página', click: () => send(win, 'bajarPagina') }
        ]
      },
      {
        label: 'Herramientas',
        submenu: [
          { label: 'Editar texto existente', accelerator: 'E', click: () => send(win, 'herramientaEditar') },
          { label: 'Agregar texto', accelerator: 'T', click: () => send(win, 'herramientaTexto') },
          { label: 'Resaltar', click: () => send(win, 'herramientaResaltar') },
          { label: 'Dibujar', click: () => send(win, 'herramientaDibujo') },
          { label: 'Rectángulo', click: () => send(win, 'herramientaRect') },
          { label: 'Imagen...', click: () => send(win, 'herramientaImagen') },
          { type: 'separator' },
          { label: 'Seleccionar / mover', accelerator: 'Escape', click: () => send(win, 'herramientaMover') }
        ]
      },
      menuVerComun(win),
      menuAyuda(win, 'Editar PDF', 'Visor y editor de PDF: texto, resaltado, dibujo,\npáginas, combinación y extracción.')
    ];
    default: return [
      {
        label: 'Archivo',
        submenu: [{ label: 'Salir', accelerator: 'Alt+F4', role: 'quit' }]
      },
      menuVerComun(win),
      menuAyuda(win, 'Oficinar', 'Suite de oficina: Calcular, Escribir, Presentar y Editar PDF.')
    ];
  }
}

// ---------- Creación de ventanas ----------
function abrirApp(id) {
  const def = APPS[id];
  if (!def) return;
  const win = new BrowserWindow({
    width: def.ancho, height: def.alto,
    minWidth: def.minAncho, minHeight: def.minAlto,
    title: def.titulo,
    backgroundColor: def.fondo,
    icon: path.join(__dirname, def.icono),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: true
    }
  });
  win.loadFile(def.html);
  conectarMenuContextual(win);
  const menu = Menu.buildFromTemplate(plantillaMenu(id, win));
  if (process.platform === 'darwin') {
    win.on('focus', () => Menu.setApplicationMenu(menu));
    Menu.setApplicationMenu(menu);
  } else {
    win.setMenu(menu);
  }

  win.on('close', (e) => {
    if (win._dirty) {
      const r = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Guardar', 'No guardar', 'Cancelar'],
        defaultId: 0, cancelId: 2,
        title: def.titulo,
        message: '¿Desea guardar los cambios antes de salir?'
      });
      if (r === 2) { e.preventDefault(); return; }
      if (r === 0) { e.preventDefault(); send(win, 'guardarYSalir'); }
    }
  });

  if (id === 'launcher') {
    ventanaLauncher = win;
    win.on('closed', () => { ventanaLauncher = null; });
  }
  return win;
}

// ---------- Corrector ortográfico y menú contextual con sugerencias ----------
function configurarOrtografia() {
  try {
    const ses = session.defaultSession;
    const disponibles = ses.availableSpellCheckerLanguages || [];
    const espanol = disponibles.filter(l => l.startsWith('es'));
    ses.setSpellCheckerLanguages(espanol.length ? espanol.slice(0, 2) : ['es']);
    ses.setSpellCheckerEnabled(true);
  } catch (e) { /* el corrector no está disponible en esta plataforma */ }
}

function configurarPermisos() {
  // App local de confianza: permitir fuentes locales, portapapeles, pantalla completa, etc.
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permiso, callback) => callback(true));
  ses.setPermissionCheckHandler(() => true);
}

function conectarMenuContextual(win) {
  win.webContents.on('context-menu', (_e, params) => {
    // Solo en zonas editables o con texto seleccionado (Calcular tiene su propio menú en la cuadrícula)
    if (!params.isEditable && !params.selectionText) return;
    const menu = new Menu();
    for (const sugerencia of (params.dictionarySuggestions || []).slice(0, 6)) {
      menu.append(new MenuItem({
        label: sugerencia,
        click: () => win.webContents.replaceMisspelling(sugerencia)
      }));
    }
    if (params.misspelledWord) {
      menu.append(new MenuItem({
        label: 'Agregar al diccionario',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }
    if (params.isEditable || params.selectionText) {
      menu.append(new MenuItem({ label: 'Cortar', role: 'cut', enabled: params.isEditable && !!params.selectionText }));
      menu.append(new MenuItem({ label: 'Copiar', role: 'copy', enabled: !!params.selectionText }));
      menu.append(new MenuItem({ label: 'Pegar', role: 'paste', enabled: params.isEditable }));
      menu.append(new MenuItem({ label: 'Seleccionar todo', role: 'selectAll' }));
    }
    if (menu.items.length) menu.popup({ window: win });
  });
}

// ---------- IPC de ventana ----------
const deEvento = (e) => BrowserWindow.fromWebContents(e.sender);

// La IA puede abrir otra app y escribir contenido en ella
ipcMain.on('ia-abrir-app-con', (_e, { aplicacion, contenido }) => {
  const win = abrirApp(aplicacion);
  if (!win) return;
  win.webContents.once('did-finish-load', () => {
    if (contenido) setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send('ia-ejecutar', contenido);
    }, 600);
  });
});

ipcMain.on('abrir-app', (_e, id) => abrirApp(id));
ipcMain.on('set-dirty', (e, dirty) => { const w = deEvento(e); if (w) w._dirty = dirty; });
ipcMain.on('set-title', (e, t) => { const w = deEvento(e); if (w) w.setTitle(t); });
ipcMain.on('salir-forzado', (e) => { const w = deEvento(e); if (w) { w._dirty = false; w.close(); } });

ipcMain.handle('dialogo-abrir', async (e, opciones) => {
  const r = await dialog.showOpenDialog(deEvento(e), opciones);
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialogo-guardar', async (e, opciones) => {
  const r = await dialog.showSaveDialog(deEvento(e), opciones);
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('mensaje', async (e, opciones) => {
  const r = await dialog.showMessageBox(deEvento(e), opciones);
  return r.response;
});

// Exportar la ventana actual a PDF (Escribir / Presentar)
ipcMain.handle('imprimir-pdf', async (e, opciones) => {
  const win = deEvento(e);
  const ruta = await dialog.showSaveDialog(win, {
    title: 'Exportar a PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    defaultPath: (opciones && opciones.nombre) || 'documento.pdf'
  });
  if (ruta.canceled || !ruta.filePath) return null;
  const datos = await win.webContents.printToPDF({
    printBackground: true,
    landscape: !!(opciones && opciones.horizontal),
    pageSize: (opciones && opciones.tamano) || 'Letter',
    margins: (opciones && opciones.margenes) || undefined,
    preferCSSPageSize: !!(opciones && opciones.usarCSS)
  });
  fs.writeFileSync(ruta.filePath, datos);
  return ruta.filePath;
});

ipcMain.handle('imprimir', async (e) => {
  const win = deEvento(e);
  win.webContents.print({ printBackground: true });
  return true;
});

// ---------- Configuración global (IA, preferencias) ----------
const rutaConfig = () => path.join(app.getPath('userData'), 'oficinar-config.json');

function leerConfig() {
  try { return JSON.parse(fs.readFileSync(rutaConfig(), 'utf8')); }
  catch { return {}; }
}
ipcMain.handle('config-leer', () => leerConfig());
ipcMain.handle('config-guardar', (_e, cfg) => {
  fs.writeFileSync(rutaConfig(), JSON.stringify(cfg, null, 2), 'utf8');
  // Avisar a todas las ventanas que la configuración cambió
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('config-cambiada', cfg);
  }
  return true;
});

// ---------- Proxy de IA (evita CORS: las peticiones salen del proceso principal) ----------
// local:true  -> no requiere clave API; la base es configurable por el usuario.
const PROVEEDORES = {
  claude:   { nombre: 'Claude (Anthropic)', base: 'https://api.anthropic.com' },
  openai:   { nombre: 'OpenAI',             base: 'https://api.openai.com/v1' },
  deepseek: { nombre: 'DeepSeek',           base: 'https://api.deepseek.com' },
  gemini:   { nombre: 'Gemini (Google)',    base: 'https://generativelanguage.googleapis.com/v1beta' },
  groq:     { nombre: 'Groq',               base: 'https://api.groq.com/openai/v1' },
  kimi:     { nombre: 'Kimi (Moonshot)',    base: 'https://api.moonshot.ai/v1' },
  ollama:   { nombre: 'Ollama (local)',     base: 'http://localhost:11434', local: true },
  lmstudio: { nombre: 'LM Studio (local)',  base: 'http://localhost:1234/v1', local: true }
};

// La base local puede sobreescribirse desde la configuración (host/puerto personalizado)
function baseDe(proveedor, baseUsuario) {
  const def = PROVEEDORES[proveedor];
  if (def && def.local && baseUsuario && /^https?:\/\//.test(baseUsuario)) return baseUsuario.replace(/\/+$/, '');
  return def ? def.base : '';
}

async function fetchJSON(url, opciones) {
  const r = await fetch(url, opciones);
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* respuesta no JSON */ }
  if (!r.ok) {
    const msg = (json && (json.error?.message || json.message)) || texto.slice(0, 300) || `HTTP ${r.status}`;
    throw new Error(`${r.status}: ${msg}`);
  }
  return json;
}

ipcMain.handle('ia-proveedores', () => {
  return Object.entries(PROVEEDORES).map(([id, p]) => ({ id, nombre: p.nombre, local: !!p.local }));
});

// Recursos del equipo (para decidir si se ofrece la transcripción con Whisper)
const os = require('os');
ipcMain.handle('ia-recursos', () => {
  const ramGB = os.totalmem() / (1024 ** 3);
  const cpus = os.cpus().length;
  // whisper-tiny (~75 MB) funciona con poca RAM; exigimos al menos 2 GB totales
  return { ramGB: Math.round(ramGB * 10) / 10, cpus, transcripcion: ramGB >= 2 };
});

ipcMain.handle('ia-modelos', async (_e, { proveedor, apiKey, base }) => {
  try {
    const def = PROVEEDORES[proveedor];
    if (!def) throw new Error('Proveedor desconocido.');
    if (!def.local && !apiKey) throw new Error('Falta la clave API.');
    let modelos = [];
    if (proveedor === 'claude') {
      const j = await fetchJSON(`${PROVEEDORES.claude.base}/v1/models?limit=100`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      });
      modelos = (j.data || []).map(m => m.id);
    } else if (proveedor === 'gemini') {
      const j = await fetchJSON(`${PROVEEDORES.gemini.base}/models?pageSize=100&key=${encodeURIComponent(apiKey)}`, {});
      modelos = (j.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));
    } else if (proveedor === 'ollama') {
      // Ollama expone sus modelos instalados en /api/tags
      const j = await fetchJSON(`${baseDe(proveedor, base)}/api/tags`, {});
      modelos = (j.models || []).map(m => m.name);
      if (!modelos.length) throw new Error('Ollama está en marcha pero no hay modelos. Instala uno con: ollama pull llama3.2');
    } else {
      // OpenAI, DeepSeek, Groq, Kimi y LM Studio: API compatible con OpenAI
      const headers = {};
      if (!def.local) headers['Authorization'] = `Bearer ${apiKey}`;
      const j = await fetchJSON(`${baseDe(proveedor, base)}/models`, { headers });
      modelos = (j.data || []).map(m => m.id);
      if (proveedor === 'openai') {
        modelos = modelos.filter(id => /^(gpt|o[0-9]|chatgpt)/.test(id) && !/(embedding|tts|whisper|audio|image|dall|realtime|transcribe|moderation)/.test(id));
      }
    }
    modelos.sort();
    return { ok: true, modelos };
  } catch (err) {
    const def = PROVEEDORES[proveedor];
    let msg = String(err.message || err);
    if (def && def.local && /ECONNREFUSED|fetch failed|Failed to fetch/i.test(msg)) {
      msg = proveedor === 'ollama'
        ? 'No se pudo conectar con Ollama. Verifica que esté instalado y ejecutándose (ollama serve) en ' + baseDe(proveedor, base) + '.'
        : 'No se pudo conectar con LM Studio. Abre LM Studio, inicia el servidor local y verifica el puerto (' + baseDe(proveedor, base) + ').';
    }
    return { ok: false, error: msg };
  }
});

ipcMain.handle('ia-chat', async (_e, { proveedor, apiKey, modelo, sistema, mensajes, base }) => {
  try {
    const def = PROVEEDORES[proveedor];
    if (!def) throw new Error('Proveedor desconocido.');
    if (!def.local && !apiKey) throw new Error('Configura la clave API en el panel de IA (engranaje).');
    if (!modelo) throw new Error('Selecciona un modelo en la configuración de IA.');

    if (proveedor === 'claude') {
      const j = await fetchJSON(`${PROVEEDORES.claude.base}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 8192,
          system: sistema || undefined,
          messages: mensajes.map(m => ({ role: m.rol === 'ia' ? 'assistant' : 'user', content: m.texto }))
        })
      });
      const texto = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      return { ok: true, texto };
    }

    if (proveedor === 'gemini') {
      const cuerpo = {
        contents: mensajes.map(m => ({
          role: m.rol === 'ia' ? 'model' : 'user',
          parts: [{ text: m.texto }]
        }))
      };
      if (sistema) cuerpo.system_instruction = { parts: [{ text: sistema }] };
      const j = await fetchJSON(
        `${PROVEEDORES.gemini.base}/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }
      );
      const cand = j.candidates && j.candidates[0];
      const texto = cand && cand.content && cand.content.parts
        ? cand.content.parts.map(p => p.text || '').join('') : '';
      if (!texto) throw new Error('Respuesta vacía del modelo.');
      return { ok: true, texto };
    }

    if (proveedor === 'ollama') {
      // API nativa de Ollama en /api/chat (stream desactivado)
      const msgs = [];
      if (sistema) msgs.push({ role: 'system', content: sistema });
      for (const m of mensajes) msgs.push({ role: m.rol === 'ia' ? 'assistant' : 'user', content: m.texto });
      const j = await fetchJSON(`${baseDe(proveedor, base)}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelo, messages: msgs, stream: false })
      });
      const texto = j.message && j.message.content ? j.message.content : '';
      if (!texto) throw new Error('Respuesta vacía del modelo.');
      return { ok: true, texto };
    }

    // OpenAI, DeepSeek, Groq, Kimi y LM Studio (compatibles con OpenAI)
    const msgs = [];
    if (sistema) msgs.push({ role: 'system', content: sistema });
    for (const m of mensajes) msgs.push({ role: m.rol === 'ia' ? 'assistant' : 'user', content: m.texto });
    const headers = { 'content-type': 'application/json' };
    if (!def.local) headers['Authorization'] = `Bearer ${apiKey}`;
    const j = await fetchJSON(`${baseDe(proveedor, base)}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: modelo, messages: msgs })
    });
    const texto = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
    if (!texto) throw new Error('Respuesta vacía del modelo.');
    return { ok: true, texto };
  } catch (err) {
    const def = PROVEEDORES[proveedor];
    let msg = String(err.message || err);
    if (def && def.local && /ECONNREFUSED|fetch failed|Failed to fetch/i.test(msg)) {
      msg = 'No se pudo conectar con el servidor local (' + baseDe(proveedor, base) + '). Verifica que ' +
        (proveedor === 'ollama' ? 'Ollama' : 'el servidor de LM Studio') + ' esté en ejecución.';
    }
    return { ok: false, error: msg };
  }
});

// ---------- Ciclo de vida ----------
app.whenReady().then(() => {
  configurarOrtografia();
  configurarPermisos();
  if (process.env.OFICINAR_TEST) { pruebaArranque(); return; }
  abrirApp('launcher');
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) abrirApp('launcher');
  });
});

// Prueba de humo: abre todas las apps, reporta errores de consola y termina
function pruebaArranque() {
  const ids = ['launcher', 'calcular', 'escribir', 'presentar', 'editarpdf'];
  let errores = 0;
  for (const id of ids) {
    const w = abrirApp(id);
    w.hide();
    w.webContents.on('console-message', (_e, nivel, msg, linea, origen) => {
      if (nivel >= 3) { errores++; console.log(`[ERROR ${id}] ${msg} (${origen}:${linea})`); }
    });
    w.webContents.on('render-process-gone', (_e, det) => {
      errores++; console.log(`[CRASH ${id}] ${det.reason}`);
    });
    w.webContents.on('did-finish-load', () => console.log(`[CARGADA] ${id}`));
    w.webContents.on('did-fail-load', (_e, cod, desc) => { errores++; console.log(`[FALLO ${id}] ${desc}`); });
    if (id === 'escribir') {
      // Ejercitar la paginación automática: 120 párrafos deben producir varias páginas
      w.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const n = await w.webContents.executeJavaScript(
              `(function(){
                 const html = Array.from({length:120},(_,i)=>'<p>Línea de prueba número '+i+'</p>').join('');
                 establecerHTML(html);
                 return paginasDoc().length;
               })()`);
            console.log(`[PRUEBA escribir] paginas=${n}`);
            if (n < 2) { errores++; console.log('[ERROR escribir] la paginación no dividió el contenido'); }
            // Herramientas nuevas: encabezado/pie, TOC, columnas
            const res2 = await w.webContents.executeJavaScript(`(function(){
              const out = {};
              formatoPagina.encabezado='Mi doc'; formatoPagina.pie='Pág {pagina} de {total}';
              aplicarFormatoPagina(); actualizarEncabezadosPies();
              out.encab = !!document.querySelector('.pag-encabezado');
              out.pieOk = /Pág 1 de/.test((document.querySelector('.pag-pie')||{}).textContent||'');
              establecerHTML('<h1>Capítulo</h1><h2>Sub</h2><p>texto</p>');
              insertarTOC();
              out.toc = !!document.querySelector('.toc');
              fijarColumnas(2,false);
              out.cols = getComputedStyle(paginasDoc()[0]).columnCount;
              return out;
            })()`);
            console.log('[PRUEBA escribir-2] ' + JSON.stringify(res2));
            if (!res2.encab || !res2.pieOk || !res2.toc || res2.cols !== '2') { errores++; console.log('[ERROR escribir] herramientas nuevas fallaron'); }
          } catch (err) { errores++; console.log('[ERROR escribir] ' + err.message); }
        }, 1500);
      });
    }
    if (id === 'editarpdf') {
      w.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const res = await w.webContents.executeJavaScript(`(async function(){
              const out = {};
              nuevoPDF();
              out.paginas = paginas.length;
              const p = paginas[0];
              p.anot.push({tipo:'texto', x:50, y:700, texto:'Hola', tam:14, color:'#000000'});
              p.anot.push({tipo:'resaltar', x:40, y:600, w:100, h:20, color:'#ffe100'});
              p.anot.push({tipo:'redaccion', x:40, y:500, w:80, h:20, color:'#000000'});
              p.anot.push({tipo:'nota', x:200, y:650, w:26, h:26, texto:'Comentario'});
              duplicarPagina();
              out.trasDuplicar = paginas.length;
              const bytes = await construirPDF();
              out.bytesOk = bytes && bytes.length > 400 && bytes[0]===37 && bytes[1]===80; // "%P"
              // Marcadores
              marcadores.push({pag:0, titulo:'Inicio'}); renderizarMarcadores();
              out.marcador = document.querySelectorAll('#panelMarcadores .marcador').length;
              return out;
            })()`);
            const ok = res.paginas === 1 && res.trasDuplicar === 2 && res.bytesOk && res.marcador === 1;
            console.log('[PRUEBA editarpdf] ' + JSON.stringify(res));
            if (!ok) { errores++; console.log('[ERROR editarpdf] alguna herramienta falló'); }
          } catch (err) { errores++; console.log('[ERROR editarpdf] ' + err.message); }
        }, 2000);
      });
    }
    if (id === 'presentar') {
      w.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const res = await w.webContents.executeJavaScript(`(function(){
              const out = {};
              // Plantilla
              nuevaDiapositivaPlantilla('tituloContenido');
              out.diapos = pres.diapositivas.length;
              // Objetos + alineación + agrupar
              diapoActual=0; diapo().objetos=[];
              agregarObjeto({tipo:'texto',x:100,y:100,w:200,h:80,html:'A'});
              agregarObjeto({tipo:'texto',x:400,y:300,w:200,h:80,html:'B'});
              selMultiple=new Set([0,1]); objSel=1;
              alinear('izq');
              out.alinX = diapo().objetos[0].x===diapo().objetos[1].x;
              agrupar();
              out.grupo = !!diapo().objetos[0].grupo && diapo().objetos[0].grupo===diapo().objetos[1].grupo;
              // Rotación / opacidad / relación
              objSel=0; selMultiple.clear(); rotarObjeto(15);
              out.rot = diapo().objetos[0].rot===15;
              pres.relacion='4:3'; aplicarRelacion();
              out.alto43 = ALTO;
              // Notas
              diapo().notas='Mi nota';
              out.nota = diapo().notas==='Mi nota';
              // Animación de énfasis
              objSel=0; diapo().objetos[0].anim='pulso';
              out.anim = animadosDe(diapo()).length>=1;
              return out;
            })()`);
            const ok = res.diapos >= 2 && res.alinX && res.grupo && res.rot && res.alto43 === 720 && res.nota && res.anim;
            console.log('[PRUEBA presentar] ' + JSON.stringify(res));
            if (!ok) { errores++; console.log('[ERROR presentar] alguna herramienta falló'); }
          } catch (err) { errores++; console.log('[ERROR presentar] ' + err.message); }
        }, 1800);
      });
    }
    if (id === 'calcular') {
      // Verificar que Ollama/LM Studio están registrados como proveedores locales
      w.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const provs = await w.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke('ia-proveedores')`);
            const locales = provs.filter(p => p.local).map(p => p.id).join(',');
            console.log('[PRUEBA proveedores] total=' + provs.length + ' locales=' + locales);
            if (!/ollama/.test(locales) || !/lmstudio/.test(locales)) { errores++; console.log('[ERROR proveedores] faltan Ollama/LM Studio'); }
          } catch (err) { errores++; console.log('[ERROR proveedores] ' + err.message); }
        }, 900);
      });
      w.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const res = await w.webContents.executeJavaScript(`(function(){
              const out = {};
              // Datos y ordenar
              aplicarValor(0,0,'3'); aplicarValor(1,0,'1'); aplicarValor(2,0,'2');
              sel={r1:0,c1:0,r2:2,c2:0}; ordenar(true);
              out.orden = [0,1,2].map(r=>hf.getCellValue({sheet:hojaActual,row:r,col:0})).join(',');
              // Combinar
              sel={r1:5,c1:0,r2:6,c2:1}; combinar('todo');
              out.combinadas = meta().combinadas.length;
              // Alto de fila
              meta().altos[10]=60; recalcularOffsets();
              out.alto10 = altoFila(10);
              // Bordes
              sel={r1:8,c1:0,r2:8,c2:0}; aplicarBordes('todos');
              out.borde = !!(getEstilo(8,0)&&getEstilo(8,0).bordes);
              // Formato condicional
              aplicarValor(20,0,'500');
              meta().condicionales.push({tipo:'mayor',valor:'100',color:'#ff0000',r1:20,c1:0,r2:20,c2:0});
              invalidarCacheCond();
              out.cond = !!formatoCondicionalDe(20,0);
              // Autosuma
              aplicarValor(30,0,'10'); aplicarValor(31,0,'20'); activa={r:32,c:0};
              autosumaFn('SUMA');
              out.suma = hf.getCellValue({sheet:hojaActual,row:32,col:0});
              return out;
            })()`);
            const ok = res.orden === '1,2,3' && res.combinadas === 1 && res.alto10 === 60 && res.borde && res.cond && res.suma === 30;
            console.log(`[PRUEBA calcular] ${JSON.stringify(res)}`);
            if (!ok) { errores++; console.log('[ERROR calcular] alguna herramienta falló'); }
          } catch (err) { errores++; console.log('[ERROR calcular] ' + err.message); }
        }, 1800);
      });
    }
  }
  setTimeout(() => { console.log(errores ? `RESULTADO: ${errores} errores` : 'RESULTADO: OK'); app.exit(errores ? 1 : 0); }, 12000);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
