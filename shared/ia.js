// ===== Oficinar - Asistente IA compartido =====
// Cada app define window.IA_APP = {
//   nombre: 'Escribir',
//   obtenerContexto(): string        -> contenido del documento para dar contexto a la IA
//   insertar(texto): void            -> escribe la respuesta de la IA en el documento (opcional)
//   etiquetaInsertar: 'Insertar'     -> texto del botón (opcional)
// }
(function () {
  const { ipcRenderer, clipboard } = require('electron');

  let config = {};            // { ia: { proveedor, modelo, claves: {prov: key}, modelosCache: {prov: []} } }
  let historial = [];         // [{rol:'usuario'|'ia', texto}]
  let ocupado = false;
  let proveedores = [];

  const app = () => window.IA_APP || { nombre: 'Oficinar', obtenerContexto: null, insertar: null };

  // ---------- Construcción del panel ----------
  const burbuja = document.createElement('button');
  burbuja.id = 'iaBurbuja';
  burbuja.title = 'Asistente IA (Ctrl+I)';
  burbuja.textContent = 'IA';
  document.body.appendChild(burbuja);

  const panel = document.createElement('div');
  panel.id = 'iaPanel';
  panel.innerHTML = `
    <div class="ia-cabecera">
      <div class="ia-orbe"></div>
      <div class="ia-titulo">Asistente IA
        <span class="ia-sub" id="iaModeloActual">Sin configurar</span>
      </div>
      <button class="ia-btn-icono" id="iaLimpiar" title="Nueva conversación">&#10227;</button>
      <button class="ia-btn-icono" id="iaAjustes" title="Configuración de IA">&#9881;</button>
      <button class="ia-btn-icono" id="iaCerrar" title="Cerrar panel">&#10005;</button>
    </div>
    <label class="ia-contexto" id="iaFilaContexto">
      <input type="checkbox" id="iaUsarContexto" checked>
      <span>Compartir el documento con la IA (hablar con el documento)</span>
    </label>
    <div id="iaMensajes">
      <div class="ia-vacio" id="iaVacio">
        <span class="grande">&#10024;</span>
        Pregunta lo que quieras sobre tu documento o pide a la IA que
        escriba contenido y luego insértalo con un clic.
      </div>
    </div>
    <div class="ia-entrada">
      <button id="iaMic" class="oculto" title="Dictar por voz (transcribe con Whisper)">&#127908;</button>
      <textarea id="iaTexto" placeholder="Escribe tu mensaje... (Enter para enviar)"></textarea>
      <button id="iaEnviar" title="Enviar">&#10148;</button>
    </div>
    <div id="iaConfig" class="oculto">
      <div class="ia-cabecera">
        <div class="ia-orbe"></div>
        <div class="ia-titulo">Configuración de IA</div>
        <button class="ia-btn-icono" id="iaConfigCerrar" title="Volver">&#10005;</button>
      </div>
      <div class="ia-config-cuerpo">
        <div class="ia-campo">
          <label>Proveedor</label>
          <select id="iaProveedor"></select>
        </div>
        <div class="ia-campo" id="iaCampoClave">
          <label>Clave API</label>
          <input type="password" id="iaClave" placeholder="Pega aquí tu clave API" spellcheck="false">
        </div>
        <div class="ia-campo oculto" id="iaCampoBase">
          <label>Dirección del servidor local</label>
          <input type="text" id="iaBase" placeholder="http://localhost:11434" spellcheck="false">
        </div>
        <div class="ia-campo">
          <label>Modelo</label>
          <div class="ia-fila-modelo">
            <select id="iaModelo"></select>
            <button class="ia-btn secundario" id="iaActualizarModelos" title="Consultar los modelos disponibles del proveedor">&#8635; Actualizar</button>
          </div>
          <div class="ia-estado-modelos" id="iaEstadoModelos"></div>
        </div>
        <div class="ia-nota" id="iaNotaProveedor">
          La clave se guarda solo en este equipo y se usa una clave distinta por proveedor.
          Pulsa <b>Actualizar</b> para consultar en línea los modelos disponibles de tu cuenta.
          La configuración es compartida por todas las apps de Oficinar.
        </div>
      </div>
      <div class="ia-config-pie">
        <button class="ia-btn secundario" id="iaConfigCancelar">Cancelar</button>
        <button class="ia-btn" id="iaConfigGuardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = (id) => document.getElementById(id);
  const mensajesEl = $('iaMensajes');
  const textoEl = $('iaTexto');

  // ---------- Utilidades de configuración ----------
  function cfgIA() {
    if (!config.ia) config.ia = { proveedor: 'claude', modelo: '', claves: {}, modelos: {}, modelosCache: {}, bases: {} };
    if (!config.ia.claves) config.ia.claves = {};
    if (!config.ia.modelos) config.ia.modelos = {};       // modelo elegido por proveedor
    if (!config.ia.modelosCache) config.ia.modelosCache = {}; // listas descargadas
    if (!config.ia.bases) config.ia.bases = {};           // dirección local por proveedor
    return config.ia;
  }

  function infoProveedor(id) { return proveedores.find(p => p.id === id) || null; }
  function esLocal(id) { const p = infoProveedor(id); return !!(p && p.local); }
  function etiquetaProveedor(id) { const p = infoProveedor(id); return p ? p.nombre : id; }
  function configurado(id) {
    const ia = cfgIA();
    return (esLocal(id) || ia.claves[id]) && ia.modelos[id];
  }

  function actualizarEtiqueta() {
    const ia = cfgIA();
    const el = $('iaModeloActual');
    if (configurado(ia.proveedor)) {
      el.textContent = `${etiquetaProveedor(ia.proveedor)} · ${ia.modelos[ia.proveedor]}`;
    } else {
      el.textContent = 'Sin configurar — pulsa el engranaje';
    }
  }

  // ---------- Panel: mostrar / ocultar ----------
  function alternarPanel(forzar) {
    const visible = typeof forzar === 'boolean' ? forzar : !panel.classList.contains('visible');
    panel.classList.toggle('visible', visible);
    burbuja.classList.toggle('oculto', visible);
    if (visible) textoEl.focus();
  }
  burbuja.addEventListener('click', () => alternarPanel(true));
  $('iaCerrar').addEventListener('click', () => alternarPanel(false));
  $('iaLimpiar').addEventListener('click', () => {
    historial = [];
    mensajesEl.querySelectorAll('.ia-msg').forEach(m => m.remove());
    $('iaVacio').style.display = '';
  });

  if (!app().obtenerContexto) $('iaFilaContexto').style.display = 'none';

  // ---------- Configuración: interfaz ----------
  function abrirConfig() {
    const ia = cfgIA();
    const selProv = $('iaProveedor');
    selProv.innerHTML = proveedores.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
    selProv.value = ia.proveedor || 'claude';
    cargarCamposProveedor();
    $('iaConfig').classList.remove('oculto');
  }

  const BASES_DEF = { ollama: 'http://localhost:11434', lmstudio: 'http://localhost:1234/v1' };

  function cargarCamposProveedor() {
    const ia = cfgIA();
    const prov = $('iaProveedor').value;
    const local = esLocal(prov);
    // Local: mostrar dirección del servidor en vez de clave API
    $('iaCampoClave').classList.toggle('oculto', local);
    $('iaCampoBase').classList.toggle('oculto', !local);
    $('iaClave').value = ia.claves[prov] || '';
    $('iaBase').value = ia.bases[prov] || BASES_DEF[prov] || '';
    if (local) {
      $('iaNotaProveedor').innerHTML = prov === 'ollama'
        ? 'IA local con <b>Ollama</b>. Instala Ollama, ejecútalo y descarga un modelo (por ejemplo <code>ollama pull llama3.2</code>). No requiere clave ni conexión a internet. Pulsa <b>Actualizar</b> para listar tus modelos.'
        : 'IA local con <b>LM Studio</b>. Abre LM Studio, carga un modelo e inicia el <i>servidor local</i> (pestaña Developer). No requiere clave. Pulsa <b>Actualizar</b> para listar los modelos cargados.';
    } else {
      $('iaNotaProveedor').innerHTML = 'La clave se guarda solo en este equipo y se usa una clave distinta por proveedor. Pulsa <b>Actualizar</b> para consultar en línea los modelos disponibles de tu cuenta.';
    }
    const lista = ia.modelosCache[prov] || [];
    poblarModelos(lista, ia.modelos[prov] || '');
    $('iaEstadoModelos').textContent = lista.length
      ? `${lista.length} modelos en caché. Actualiza para consultar de nuevo.`
      : (local ? 'Pulsa Actualizar para listar los modelos locales.' : 'Guarda tu clave y pulsa Actualizar para listar los modelos.');
    $('iaEstadoModelos').classList.remove('error');
  }

  function poblarModelos(lista, seleccionado) {
    const sel = $('iaModelo');
    const opciones = [...lista];
    if (seleccionado && !opciones.includes(seleccionado)) opciones.unshift(seleccionado);
    sel.innerHTML = opciones.map(m => `<option>${m}</option>`).join('') || '<option value="">(sin modelos)</option>';
    if (seleccionado) sel.value = seleccionado;
  }

  $('iaAjustes').addEventListener('click', abrirConfig);
  $('iaConfigCerrar').addEventListener('click', () => $('iaConfig').classList.add('oculto'));
  $('iaConfigCancelar').addEventListener('click', () => $('iaConfig').classList.add('oculto'));
  $('iaProveedor').addEventListener('change', cargarCamposProveedor);

  $('iaActualizarModelos').addEventListener('click', async () => {
    const prov = $('iaProveedor').value;
    const local = esLocal(prov);
    const clave = $('iaClave').value.trim();
    const base = $('iaBase').value.trim();
    const estado = $('iaEstadoModelos');
    estado.classList.remove('error');
    if (!local && !clave) { estado.textContent = 'Escribe primero la clave API.'; estado.classList.add('error'); return; }
    estado.textContent = local ? 'Conectando con el servidor local...' : 'Consultando modelos disponibles...';
    const r = await ipcRenderer.invoke('ia-modelos', { proveedor: prov, apiKey: clave, base });
    if (r.ok) {
      cfgIA().modelosCache[prov] = r.modelos;
      poblarModelos(r.modelos, $('iaModelo').value);
      estado.textContent = `${r.modelos.length} modelos disponibles.`;
    } else {
      estado.textContent = 'Error: ' + r.error;
      estado.classList.add('error');
    }
  });

  $('iaConfigGuardar').addEventListener('click', async () => {
    const ia = cfgIA();
    const prov = $('iaProveedor').value;
    ia.proveedor = prov;
    ia.claves[prov] = $('iaClave').value.trim();
    ia.bases[prov] = $('iaBase').value.trim();
    ia.modelos[prov] = $('iaModelo').value;
    await ipcRenderer.invoke('config-guardar', config);
    $('iaConfig').classList.add('oculto');
    actualizarEtiqueta();
  });

  // ---------- Razonamiento (<think>) y formato Markdown ----------
  // Separa los bloques <think>/<thinking> que emiten algunos modelos (DeepSeek R1, etc.)
  function extraerRazonamiento(texto) {
    const bloques = [];
    let limpio = String(texto || '').replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_m, t) => {
      if (t.trim()) bloques.push(t.trim());
      return '';
    });
    // Etiqueta sin cerrar al inicio de la respuesta
    const abierto = /^<think(?:ing)?>([\s\S]*)$/i.exec(limpio.trim());
    if (abierto && !/<\/think/i.test(limpio)) { bloques.push(abierto[1].trim()); limpio = ''; }
    return { limpio: limpio.trim(), razonamiento: bloques.join('\n\n') };
  }

  // Markdown ligero -> HTML seguro (se escapa todo el HTML de la respuesta)
  function mdAHTML(md) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const linea = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|\s)\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1<i>$2</i>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>');
    const lineas = String(md || '').replace(/\r/g, '').split('\n');
    let html = '', enUL = false, enOL = false, enPre = false;
    const cerrar = () => { if (enUL) { html += '</ul>'; enUL = false; } if (enOL) { html += '</ol>'; enOL = false; } };
    for (const l of lineas) {
      if (/^\s*```/.test(l)) { cerrar(); html += enPre ? '</pre>' : '<pre>'; enPre = !enPre; continue; }
      if (enPre) { html += esc(l) + '\n'; continue; }
      const h = /^(#{1,4})\s+(.*)/.exec(l);
      if (h) { cerrar(); const n = h[1].length; html += `<h${n}>${linea(h[2])}</h${n}>`; continue; }
      if (/^\s*([-*_]){3,}\s*$/.test(l)) { cerrar(); html += '<hr>'; continue; }
      if (/^\s*>\s?/.test(l)) { cerrar(); html += `<blockquote>${linea(l.replace(/^\s*>\s?/, ''))}</blockquote>`; continue; }
      if (/^\s*[-*•]\s+/.test(l)) { if (!enUL) { cerrar(); html += '<ul>'; enUL = true; } html += `<li>${linea(l.replace(/^\s*[-*•]\s+/, ''))}</li>`; continue; }
      if (/^\s*\d+[.)]\s+/.test(l)) { if (!enOL) { cerrar(); html += '<ol>'; enOL = true; } html += `<li>${linea(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`; continue; }
      cerrar();
      if (!l.trim()) continue;
      html += `<p>${linea(l)}</p>`;
    }
    cerrar();
    if (enPre) html += '</pre>';
    return html || '<p></p>';
  }

  // ---------- Chat ----------
  // Indicador de escritura: burbuja con tres puntos animados mientras la IA responde
  function crearIndicadorEscribiendo() {
    $('iaVacio').style.display = 'none';
    const div = document.createElement('div');
    div.className = 'ia-msg ia ia-escribiendo';
    div.title = 'La IA está escribiendo...';
    div.innerHTML = '<span class="ia-punto"></span><span class="ia-punto"></span><span class="ia-punto"></span>';
    mensajesEl.appendChild(div);
    mensajesEl.scrollTop = mensajesEl.scrollHeight;
    return div;
  }

  // Efecto de escritura: revela el texto progresivamente con cursor parpadeante
  function escribirProgresivo(el, texto, alTerminar) {
    el.classList.add('escribiendo');
    const total = texto.length;
    const paso = Math.max(2, Math.ceil(total / 220)); // termina en ~3,5 s como máximo
    let i = 0;
    const timer = setInterval(() => {
      i = Math.min(total, i + paso);
      el.innerHTML = mdAHTML(texto.slice(0, i));
      // Mantener la vista abajo solo si el usuario no subió a leer
      if (mensajesEl.scrollHeight - mensajesEl.scrollTop - mensajesEl.clientHeight < 90) {
        mensajesEl.scrollTop = mensajesEl.scrollHeight;
      }
      if (i >= total) {
        clearInterval(timer);
        el.classList.remove('escribiendo');
        el.innerHTML = mdAHTML(texto);
        if (alTerminar) alTerminar();
      }
    }, 16);
  }

  function agregarMensaje(rol, texto, opciones) {
    $('iaVacio').style.display = 'none';
    const div = document.createElement('div');
    div.className = 'ia-msg ' + rol + (opciones && opciones.clase ? ' ' + opciones.clase : '');

    const agregarAcciones = () => {
      if (rol !== 'ia' || (opciones && opciones.sinAcciones)) return;
      const acciones = document.createElement('div');
      acciones.className = 'ia-acciones';
      if (app().insertar) {
        const b = document.createElement('button');
        b.className = 'ia-accion';
        b.textContent = '⤵ ' + (app().etiquetaInsertar || 'Insertar en el documento');
        b.addEventListener('click', () => app().insertar(texto));
        acciones.appendChild(b);
      }
      const c = document.createElement('button');
      c.className = 'ia-accion';
      c.textContent = 'Copiar';
      c.addEventListener('click', () => { clipboard.writeText(texto); c.textContent = '✓ Copiado'; setTimeout(() => c.textContent = 'Copiar', 1200); });
      acciones.appendChild(c);
      div.appendChild(acciones);
    };

    if (rol === 'ia' && !(opciones && opciones.clase)) {
      // Respuesta normal de la IA: razonamiento plegable + cuerpo con formato
      if (opciones && opciones.razonamiento) {
        const det = document.createElement('details');
        det.className = 'ia-think';
        const sum = document.createElement('summary');
        sum.textContent = '💭 Razonamiento del modelo';
        const cuerpo = document.createElement('div');
        cuerpo.className = 'ia-think-cuerpo';
        cuerpo.textContent = opciones.razonamiento;
        det.appendChild(sum); det.appendChild(cuerpo);
        div.appendChild(det);
      }
      const md = document.createElement('div');
      md.className = 'ia-md';
      div.appendChild(md);
      if (opciones && opciones.maquina && texto) {
        escribirProgresivo(md, texto, agregarAcciones);
      } else {
        md.innerHTML = mdAHTML(texto || '');
        agregarAcciones();
      }
    } else {
      div.textContent = texto;
      agregarAcciones();
    }
    mensajesEl.appendChild(div);
    mensajesEl.scrollTop = mensajesEl.scrollHeight;
    return div;
  }

  // ---------- Acciones que la IA puede ejecutar (modo agente) ----------
  const ACCIONES_GLOBALES = {
    abrir_app: {
      descripcion: 'Abre una aplicación de la suite. Parámetros: {"app": "calcular" | "escribir" | "presentar" | "editarpdf"}',
      fn: (p) => { ipcRenderer.send('abrir-app', p.app); return `Abrí ${p.app}`; }
    },
    crear_documento: {
      descripcion: 'Abre una aplicación y escribe contenido en un documento nuevo. Parámetros: {"app": "...", "contenido": "..."} ' +
        '(contenido en el formato de esa app: TSV para calcular, Markdown para escribir, bloques "=== Título" para presentar)',
      fn: (p) => { ipcRenderer.send('ia-abrir-app-con', { aplicacion: p.app, contenido: p.contenido }); return `Creé un documento en ${p.app}`; }
    }
  };

  function accionesDisponibles() {
    const propias = (app().acciones) || {};
    return { ...ACCIONES_GLOBALES, ...propias };
  }

  function descripcionAcciones() {
    const acc = accionesDisponibles();
    const lineas = Object.entries(acc).map(([n, a]) => `- ${n}: ${a.descripcion}`);
    if (app().insertar) {
      lineas.push('- insertar: Escribe contenido en el documento actual. Parámetros: {"contenido": "..."}');
    }
    return lineas.join('\n');
  }

  async function ejecutarAcciones(lista) {
    const acc = accionesDisponibles();
    const resultados = [];
    for (const item of lista) {
      const nombre = item.accion;
      const p = item.parametros || item;
      try {
        if (nombre === 'insertar' && app().insertar) {
          app().insertar(String(p.contenido ?? ''));
          resultados.push({ ok: true, texto: 'Contenido insertado en el documento' });
        } else if (acc[nombre]) {
          const r = await acc[nombre].fn(p);
          resultados.push({ ok: true, texto: r || nombre });
        } else {
          resultados.push({ ok: false, texto: `Acción desconocida: ${nombre}` });
        }
      } catch (err) {
        resultados.push({ ok: false, texto: `${nombre}: ${err.message || err}` });
      }
    }
    return resultados;
  }

  // Extrae el bloque ```acciones ...``` de la respuesta; devuelve { texto, acciones }
  function separarAcciones(respuesta) {
    const re = /```(?:acciones|json)?\s*\n?(\[[\s\S]*?\])\s*```/m;
    const m = re.exec(respuesta);
    if (!m) return { texto: respuesta, acciones: null };
    try {
      const lista = JSON.parse(m[1]);
      if (!Array.isArray(lista) || !lista.length || !lista.every(x => x && typeof x === 'object' && x.accion)) {
        return { texto: respuesta, acciones: null };
      }
      return { texto: respuesta.replace(re, '').trim(), acciones: lista };
    } catch {
      return { texto: respuesta, acciones: null };
    }
  }

  function sistemaPrompt() {
    const a = app();
    let s = `Eres el asistente de IA integrado en "${a.nombre}", una aplicación de la suite de oficina Oficinar (en español). ` +
      `Responde siempre en el idioma del usuario (normalmente español). ` +
      `Cuando el usuario pida crear, redactar o generar contenido para el documento, responde ÚNICAMENTE con el contenido listo para insertar, sin explicaciones adicionales.`;
    if (a.instrucciones) s += ' ' + a.instrucciones;
    s += `\n\nPuedes USAR las aplicaciones de la suite ejecutando acciones. Si el usuario te pide abrir una app, crear un archivo, ` +
      `escribir en el documento o realizar una operación, incluye al FINAL de tu respuesta un bloque con este formato exacto:\n` +
      '```acciones\n[{"accion": "nombre_accion", "parametros": { ... }}]\n```\n' +
      `Acciones disponibles:\n${descripcionAcciones()}\n` +
      `Ejecuta acciones solo cuando el usuario lo pida o sea claramente útil. Explica brevemente qué hiciste.`;
    if ($('iaUsarContexto').checked && a.obtenerContexto) {
      let doc = '';
      try { doc = String(a.obtenerContexto() || ''); } catch { doc = ''; }
      if (doc.length > 60000) doc = doc.slice(0, 60000) + '\n[... documento truncado ...]';
      if (doc.trim()) s += `\n\nContenido actual del documento del usuario:\n"""\n${doc}\n"""`;
      else s += '\n\nEl documento del usuario está vacío actualmente.';
    }
    return s;
  }

  async function enviar() {
    if (ocupado) return;
    const texto = textoEl.value.trim();
    if (!texto) return;
    const ia = cfgIA();
    if (!configurado(ia.proveedor)) { abrirConfig(); return; }

    textoEl.value = '';
    ajustarAltura();
    agregarMensaje('usuario', texto);
    historial.push({ rol: 'usuario', texto });

    ocupado = true;
    $('iaEnviar').disabled = true;
    const espera = crearIndicadorEscribiendo();

    const r = await ipcRenderer.invoke('ia-chat', {
      proveedor: ia.proveedor,
      apiKey: ia.claves[ia.proveedor],
      base: ia.bases[ia.proveedor],
      modelo: ia.modelos[ia.proveedor],
      sistema: sistemaPrompt(),
      mensajes: historial.slice(-16)
    });

    espera.remove();
    ocupado = false;
    $('iaEnviar').disabled = false;

    if (r.ok) {
      const { limpio, razonamiento } = extraerRazonamiento(r.texto);
      historial.push({ rol: 'ia', texto: limpio || r.texto });
      const { texto: visible, acciones } = separarAcciones(limpio);
      // Efecto de escritura solo cuando no hay acciones pendientes de ejecutar
      if (visible || razonamiento) agregarMensaje('ia', visible, { razonamiento, maquina: !acciones });
      if (acciones) {
        const resultados = await ejecutarAcciones(acciones);
        for (const res of resultados) {
          agregarMensaje('ia', (res.ok ? '✔ ' : '✖ ') + res.texto, { clase: res.ok ? 'accion-ok' : 'error', sinAcciones: true });
        }
        historial.push({ rol: 'usuario', texto: '[Sistema] Resultado de las acciones: ' + resultados.map(r2 => (r2.ok ? 'OK: ' : 'ERROR: ') + r2.texto).join('; ') });
      }
    } else {
      agregarMensaje('ia', 'Error: ' + r.error, { clase: 'error', sinAcciones: true });
    }
    textoEl.focus();
  }

  function ajustarAltura() {
    textoEl.style.height = 'auto';
    textoEl.style.height = Math.min(textoEl.scrollHeight, 130) + 'px';
  }

  $('iaEnviar').addEventListener('click', enviar);
  textoEl.addEventListener('input', ajustarAltura);
  textoEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); alternarPanel(); }
  });

  ipcRenderer.on('menu', (_e, accion) => { if (accion === 'ia') alternarPanel(); });
  ipcRenderer.on('config-cambiada', (_e, cfg) => { config = cfg || {}; actualizarEtiqueta(); });

  // Contenido enviado por la IA desde otra ventana (crear_documento)
  ipcRenderer.on('ia-ejecutar', (_e, contenido) => {
    if (app().insertar) {
      app().insertar(String(contenido));
      alternarPanel(true);
      agregarMensaje('ia', '✔ El asistente creó este contenido desde otra ventana.', { clase: 'accion-ok', sinAcciones: true });
    }
  });

  // ---------- Dictado por voz (transcripción con Whisper) ----------
  let grabadora = null, grabando = false, chunks = [];
  let transcriptor = null;   // pipeline de transformers.js (perezoso)
  let cargandoModelo = false;

  const micBtn = $('iaMic');

  async function iniciarDictado() {
    if (grabando) { detenerDictado(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      grabadora = new MediaRecorder(stream);
      grabadora.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      grabadora.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        await transcribir(new Blob(chunks, { type: 'audio/webm' }));
      };
      grabadora.start();
      grabando = true;
      micBtn.classList.add('grabando');
      micBtn.title = 'Detener y transcribir';
    } catch (err) {
      agregarMensaje('ia', 'No se pudo acceder al micrófono: ' + (err.message || err), { clase: 'error', sinAcciones: true });
    }
  }
  function detenerDictado() {
    if (grabadora && grabando) { grabando = false; micBtn.classList.remove('grabando'); micBtn.title = 'Dictar por voz'; grabadora.stop(); }
  }

  async function asegurarTranscriptor() {
    if (transcriptor) return transcriptor;
    if (cargandoModelo) throw new Error('El modelo se está cargando...');
    cargandoModelo = true;
    // Cargar transformers.js desde CDN solo cuando se necesita (no infla el instalador)
    const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    mod.env.allowLocalModels = false;
    mod.env.useBrowserCache = true;   // el modelo se cachea tras la primera descarga
    transcriptor = await mod.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
    cargandoModelo = false;
    return transcriptor;
  }

  // Decodifica el audio a PCM mono 16 kHz (formato que espera Whisper)
  async function audioAFloat32(blob) {
    const buf = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const audio = await ctx.decodeAudioData(buf);
    let datos = audio.getChannelData(0);
    if (audio.sampleRate !== 16000) {
      const ratio = audio.sampleRate / 16000;
      const nuevo = new Float32Array(Math.floor(datos.length / ratio));
      for (let i = 0; i < nuevo.length; i++) nuevo[i] = datos[Math.floor(i * ratio)];
      datos = nuevo;
    }
    ctx.close();
    return datos;
  }

  async function transcribir(blob) {
    const aviso = agregarMensaje('ia', 'Transcribiendo tu voz (la primera vez descarga el modelo Whisper)', { clase: 'pensando', sinAcciones: true });
    try {
      const pipe = await asegurarTranscriptor();
      const audio = await audioAFloat32(blob);
      const r = await pipe(audio, { language: 'spanish', task: 'transcribe' });
      aviso.remove();
      const texto = (r && r.text ? r.text : '').trim();
      if (texto) {
        textoEl.value = (textoEl.value ? textoEl.value + ' ' : '') + texto;
        ajustarAltura();
        textoEl.focus();
      } else {
        agregarMensaje('ia', 'No se detectó voz en el audio.', { clase: 'error', sinAcciones: true });
      }
    } catch (err) {
      aviso.remove();
      cargandoModelo = false;
      agregarMensaje('ia', 'No se pudo transcribir: ' + (err.message || err) + '\n(La primera transcripción necesita conexión para descargar el modelo Whisper.)', { clase: 'error', sinAcciones: true });
    }
  }

  micBtn.addEventListener('click', iniciarDictado);

  // ---------- Inicio ----------
  (async () => {
    proveedores = await ipcRenderer.invoke('ia-proveedores');
    config = (await ipcRenderer.invoke('config-leer')) || {};
    actualizarEtiqueta();
    // Ofrecer dictado por voz solo si el equipo tiene recursos suficientes
    try {
      const rec = await ipcRenderer.invoke('ia-recursos');
      if (rec && rec.transcripcion) micBtn.classList.remove('oculto');
    } catch { /* sin datos de recursos: se deja oculto */ }
  })();

  // API pública para las apps
  window.IA = {
    alternar: alternarPanel,
    abrirConfig: () => { alternarPanel(true); abrirConfig(); }
  };
})();
