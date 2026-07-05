// ===== Editar PDF - visor y editor de PDF de la suite Oficinar =====
// Visualización: pdf.js · Edición y guardado: pdf-lib
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

pdfjsLib.GlobalWorkerOptions.workerSrc = '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js';
// Respaldo: si el Worker no puede cargarse (app empaquetada en asar), pdf.js usa este módulo en el hilo principal
require('pdfjs-dist/legacy/build/pdf.worker.entry');

const $ = (id) => document.getElementById(id);
const contenedor = $('contenedorPaginas');

// ---------- Estado ----------
// fuentes[i] = { bytes: Uint8Array, docJS: pdf.js document }
// paginas[i] = { src: idFuente|null (página en blanco), indice, rotExtra, anot: [], ancho, alto }
// Las anotaciones se guardan en coordenadas PDF (origen abajo-izquierda, puntos).
let fuentes = [];
let paginas = [];
let archivoActual = null;
let modificado = false;
let escala = 1.25;
let paginaActual = 0;
let herramienta = 'mover';
let anotSel = null;          // { pag, idx }
let dibujoActivo = null;

const BLANCO = { ancho: 612, alto: 792 }; // carta

function marcarModificado() {
  if (!modificado) { modificado = true; ipcRenderer.send('set-dirty', true); }
  actualizarTitulo();
}
function limpiarModificado() { modificado = false; ipcRenderer.send('set-dirty', false); actualizarTitulo(); }
function actualizarTitulo() {
  const nombre = archivoActual ? path.basename(archivoActual) : 'Sin documento';
  $('estadoArchivo').textContent = nombre;
  $('estadoPagina').textContent = paginas.length ? `Página ${paginaActual + 1} de ${paginas.length} · ${Math.round(escala * 100)}%` : '';
  ipcRenderer.send('set-title', `${modificado ? '● ' : ''}${nombre} - Editar PDF`);
}

// ---------- Utilidades de color ----------
function hexARgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#d81b60');
  const n = parseInt(m ? m[1] : 'd81b60', 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

// ---------- Conversión de coordenadas ----------
async function paginaJS(p) {
  if (p.src === null) return null;
  if (!p._pdfPage) p._pdfPage = await fuentes[p.src].docJS.getPage(p.indice + 1);
  return p._pdfPage;
}
function viewportDe(p, pagJS, esc) {
  if (!pagJS) {
    return null; // página en blanco: conversión manual
  }
  return pagJS.getViewport({ scale: esc, rotation: (pagJS.rotate + p.rotExtra) % 360 });
}
// vista (px CSS, origen arriba-izq) -> PDF (puntos, origen abajo-izq)
function aPDF(p, vx, vy) {
  if (p._vp) return p._vp.convertToPdfPoint(vx, vy);
  return [vx / escala, p.alto - vy / escala];
}
// PDF -> vista
function aVista(p, x, y) {
  if (p._vp) return p._vp.convertToViewportPoint(x, y);
  return [x * escala, (p.alto - y) * escala];
}

// ---------- Render ----------
const observador = new IntersectionObserver((entradas) => {
  for (const en of entradas) {
    if (en.isIntersecting) {
      const i = parseInt(en.target.dataset.pagina, 10);
      renderizarPagina(i);
      const p = paginas[i];
      if (en.intersectionRatio > 0.4 || paginas.length === 1) {
        paginaActual = i;
        actualizarTitulo();
        marcarMiniActiva();
      }
    }
  }
}, { root: null, threshold: [0.05, 0.45] });

async function renderizarTodo() {
  contenedor.innerHTML = '';
  observador.disconnect();
  $('mensajeInicial').classList.toggle('oculto', paginas.length > 0);
  for (let i = 0; i < paginas.length; i++) {
    const p = paginas[i];
    const div = document.createElement('div');
    div.className = 'pagina-pdf';
    div.dataset.pagina = i;
    // Tamaño provisional hasta que se renderice
    const rot = p.rotExtra % 180 !== 0;
    div.style.width = ((rot ? p.alto : p.ancho) * escala) + 'px';
    div.style.height = ((rot ? p.ancho : p.alto) * escala) + 'px';
    const canvas = document.createElement('canvas');
    canvas.className = 'lienzo-pdf';
    const overlay = document.createElement('div');
    overlay.className = 'overlay h-' + herramienta;
    div.appendChild(canvas); div.appendChild(overlay);
    contenedor.appendChild(div);
    p._div = div; p._canvas = canvas; p._overlay = overlay; p._renderizada = false;
    conectarOverlay(overlay, i);
    observador.observe(div);
  }
  await renderizarMiniaturas();
  actualizarTitulo();
}

async function renderizarPagina(i) {
  const p = paginas[i];
  if (!p || p._renderizada === escala) return;
  p._renderizada = escala;
  const pagJS = await paginaJS(p);
  if (pagJS) {
    const rotBase = pagJS.rotate || 0;
    p._vp = pagJS.getViewport({ scale: escala, rotation: (rotBase + p.rotExtra) % 360 });
    p._canvas.width = Math.floor(p._vp.width * devicePixelRatio);
    p._canvas.height = Math.floor(p._vp.height * devicePixelRatio);
    p._canvas.style.width = p._vp.width + 'px';
    p._canvas.style.height = p._vp.height + 'px';
    p._div.style.width = p._vp.width + 'px';
    p._div.style.height = p._vp.height + 'px';
    const ctx = p._canvas.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    await pagJS.render({ canvasContext: ctx, viewport: p._vp }).promise;
    // Texto de la página con su geometría (para la herramienta "editar texto")
    if (!p._textItems) {
      try {
        const tc = await pagJS.getTextContent();
        p._textItems = tc.items
          .filter(it => it.str && it.str.trim())
          .map(it => ({
            str: it.str,
            x: it.transform[4],
            y: it.transform[5],
            w: it.width,
            alto: Math.max(6, Math.hypot(it.transform[1] || 0, it.transform[3] || 0))
          }));
      } catch (e) { p._textItems = []; }
    }
  } else {
    p._vp = null;
    const w = p.ancho * escala, h = p.alto * escala;
    p._canvas.width = w * devicePixelRatio; p._canvas.height = h * devicePixelRatio;
    p._canvas.style.width = w + 'px'; p._canvas.style.height = h + 'px';
    p._div.style.width = w + 'px'; p._div.style.height = h + 'px';
    const ctx = p._canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, p._canvas.width, p._canvas.height);
  }
  renderizarAnotaciones(i);
}

function renderizarAnotaciones(i) {
  const p = paginas[i];
  const ov = p._overlay;
  ov.innerHTML = '';
  ov.className = 'overlay h-' + herramienta;
  p.anot.forEach((a, idx) => {
    const el = crearElementoAnot(p, a, i, idx);
    if (el) ov.appendChild(el);
  });
}

function crearElementoAnot(p, a, iPag, idx) {
  const sel = anotSel && anotSel.pag === iPag && anotSel.idx === idx;
  if (a.tipo === 'texto') {
    const d = document.createElement('div');
    d.className = 'anot texto' + (sel ? ' seleccionada' : '');
    const [vx, vy] = aVista(p, a.x, a.y);
    d.style.left = vx + 'px'; d.style.top = vy + 'px';
    d.style.fontSize = (a.tam * escala) + 'px';
    d.style.color = a.color;
    d.textContent = a.texto;
    d.dataset.pag = iPag; d.dataset.idx = idx;
    return d;
  }
  if (a.tipo === 'imagen') {
    const img = document.createElement('img');
    img.className = 'anot caja' + (sel ? ' seleccionada' : '');
    img.src = a.src;
    posicionarCaja(p, img, a);
    img.dataset.pag = iPag; img.dataset.idx = idx;
    return img;
  }
  if (a.tipo === 'nota') {
    const d = document.createElement('div');
    d.className = 'anot nota' + (sel ? ' seleccionada' : '');
    const [vx, vy] = aVista(p, a.x, a.y);
    d.style.left = vx + 'px'; d.style.top = (vy - 26) + 'px';
    d.title = a.texto || 'Nota (doble clic para editar)';
    d.dataset.pag = iPag; d.dataset.idx = idx;
    return d;
  }
  if (a.tipo === 'resaltar' || a.tipo === 'rect' || a.tipo === 'blanqueo' || a.tipo === 'redaccion' || a.tipo === 'subrayar' || a.tipo === 'tachar') {
    const d = document.createElement('div');
    const claseExtra = a.tipo === 'blanqueo' ? ' blanqueo' : a.tipo === 'redaccion' ? ' redaccion' : '';
    d.className = 'anot caja' + claseExtra + (sel ? ' seleccionada' : '');
    posicionarCaja(p, d, a);
    if (a.tipo === 'resaltar') { d.style.background = a.color; d.style.opacity = '0.35'; }
    else if (a.tipo === 'rect') { d.style.border = `2px solid ${a.color}`; }
    else if (a.tipo === 'subrayar') { d.style.borderBottom = `2px solid ${a.color}`; }
    else if (a.tipo === 'tachar') { const cajaR = d.getBoundingClientRect; d.style.borderTop = `2px solid ${a.color}`; d.style.transform = 'translateY(50%)'; }
    d.dataset.pag = iPag; d.dataset.idx = idx;
    if (sel && a.tipo !== 'blanqueo') {
      const asa = document.createElement('div');
      asa.className = 'asa-anot';
      asa.dataset.asa = '1'; asa.dataset.pag = iPag; asa.dataset.idx = idx;
      d.appendChild(asa);
    }
    return d;
  }
  if (a.tipo === 'dibujo') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.classList.add('anot-svg');
    const poli = document.createElementNS(ns, 'polyline');
    const pts = a.puntos.map(([x, y]) => aVista(p, x, y).join(',')).join(' ');
    poli.setAttribute('points', pts);
    poli.setAttribute('fill', 'none');
    poli.setAttribute('stroke', a.color);
    poli.setAttribute('stroke-width', String(a.grosor * escala));
    poli.setAttribute('stroke-linecap', 'round');
    poli.setAttribute('stroke-linejoin', 'round');
    if (sel) poli.setAttribute('stroke-dasharray', '6 4');
    // El svg cubre toda la página: dejar pasar los clics salvo sobre el trazo
    svg.style.pointerEvents = 'none';
    poli.style.pointerEvents = 'stroke';
    svg.appendChild(poli);
    svg.dataset.pag = iPag; svg.dataset.idx = idx;
    return svg;
  }
  return null;
}

function posicionarCaja(p, el, a) {
  const [x1, y1] = aVista(p, a.x, a.y);
  const [x2, y2] = aVista(p, a.x + a.w, a.y + a.h);
  el.style.left = Math.min(x1, x2) + 'px';
  el.style.top = Math.min(y1, y2) + 'px';
  el.style.width = Math.abs(x2 - x1) + 'px';
  el.style.height = Math.abs(y2 - y1) + 'px';
  el.style.position = 'absolute';
}

// ---------- Miniaturas ----------
async function renderizarMiniaturas() {
  const panel = $('panelMiniaturas');
  panel.innerHTML = '';
  for (let i = 0; i < paginas.length; i++) {
    const p = paginas[i];
    const m = document.createElement('div');
    m.className = 'miniatura' + (i === paginaActual ? ' activa' : '');
    m.dataset.pagina = i;
    const num = document.createElement('span');
    num.className = 'mini-num'; num.textContent = i + 1;
    const canvas = document.createElement('canvas');
    const escMini = 130 / p.ancho;
    const pagJS = await paginaJS(p);
    if (pagJS) {
      const vp = pagJS.getViewport({ scale: escMini, rotation: (pagJS.rotate + p.rotExtra) % 360 });
      canvas.width = vp.width; canvas.height = vp.height;
      await pagJS.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    } else {
      canvas.width = p.ancho * escMini; canvas.height = p.alto * escMini;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    m.appendChild(canvas); m.appendChild(num);
    m.addEventListener('click', () => {
      paginaActual = i;
      marcarMiniActiva();
      paginas[i]._div.scrollIntoView({ behavior: 'smooth', block: 'start' });
      actualizarTitulo();
    });
    // Reordenar páginas arrastrando la miniatura
    m.draggable = true;
    m.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); m.classList.add('arrastrando'); });
    m.addEventListener('dragend', () => m.classList.remove('arrastrando'));
    m.addEventListener('dragover', (e) => { e.preventDefault(); m.classList.add('destino'); });
    m.addEventListener('dragleave', () => m.classList.remove('destino'));
    m.addEventListener('drop', (e) => {
      e.preventDefault(); m.classList.remove('destino');
      const desde = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (isNaN(desde) || desde === i) return;
      const [mov] = paginas.splice(desde, 1);
      paginas.splice(i, 0, mov);
      paginaActual = i;
      renderizarTodo();
      marcarModificado();
    });
    panel.appendChild(m);
  }
}
function marcarMiniActiva() {
  document.querySelectorAll('.miniatura').forEach(m =>
    m.classList.toggle('activa', parseInt(m.dataset.pagina, 10) === paginaActual));
}

// ---------- Interacción con el overlay ----------
function conectarOverlay(ov, iPag) {
  ov.addEventListener('mousedown', (e) => {
    const p = paginas[iPag];
    const r = ov.getBoundingClientRect();
    const vx = e.clientX - r.left, vy = e.clientY - r.top;
    paginaActual = iPag;

    if (herramienta === 'texto') {
      const [x, y] = aPDF(p, vx, vy);
      const texto = { tipo: 'texto', x, y, texto: 'Texto', tam: parseInt($('selTamanoTexto').value, 10), color: $('colorAnot').value };
      p.anot.push(texto);
      anotSel = { pag: iPag, idx: p.anot.length - 1 };
      renderizarAnotaciones(iPag);
      editarTextoAnot(iPag, p.anot.length - 1);
      marcarModificado();
      return;
    }

    if (herramienta === 'editar') {
      // Editar texto existente: cubrir el original con blanco y colocar texto editable encima
      const [x, y] = aPDF(p, vx, vy);
      const item = (p._textItems || []).find(it =>
        x >= it.x - 2 && x <= it.x + it.w + 2 && y >= it.y - 3 && y <= it.y + it.alto + 3);
      if (!item) return;
      p.anot.push({ tipo: 'blanqueo', x: item.x - 1.5, y: item.y - item.alto * 0.28, w: item.w + 3, h: item.alto * 1.42 });
      p.anot.push({ tipo: 'texto', x: item.x, y: item.y + item.alto, texto: item.str, tam: Math.round(item.alto), color: '#000000' });
      anotSel = { pag: iPag, idx: p.anot.length - 1 };
      renderizarAnotaciones(iPag);
      editarTextoAnot(iPag, p.anot.length - 1);
      marcarModificado();
      return;
    }

    if (herramienta === 'nota') {
      const [x, y] = aPDF(p, vx, vy);
      p.anot.push({ tipo: 'nota', x, y, w: 26, h: 26, texto: '' });
      anotSel = { pag: iPag, idx: p.anot.length - 1 };
      renderizarAnotaciones(iPag);
      editarNota(iPag, p.anot.length - 1);
      marcarModificado();
      return;
    }

    if (herramienta === 'imagen') {
      insertarImagenEn(iPag, aPDF(p, vx, vy));
      return;
    }

    if (herramienta === 'resaltar' || herramienta === 'rect' || herramienta === 'redaccion' || herramienta === 'subrayar' || herramienta === 'tachar') {
      const [x, y] = aPDF(p, vx, vy);
      let color = $('colorAnot').value;
      if (herramienta === 'resaltar') color = '#ffe100';
      if (herramienta === 'redaccion') color = '#000000';
      const a = { tipo: herramienta, x, y, w: 0, h: 0, color };
      p.anot.push(a);
      const idx = p.anot.length - 1;
      dibujoActivo = { modo: 'caja', pag: iPag, idx, ox: x, oy: y };
      e.preventDefault();
      return;
    }

    if (herramienta === 'dibujo') {
      const [x, y] = aPDF(p, vx, vy);
      const a = { tipo: 'dibujo', puntos: [[x, y]], color: $('colorAnot').value, grosor: 2.5 };
      p.anot.push(a);
      dibujoActivo = { modo: 'trazo', pag: iPag, idx: p.anot.length - 1 };
      e.preventDefault();
      return;
    }

    // Redimensionar con el asa
    const asa = e.target.closest('.asa-anot');
    if (asa) {
      const idx = parseInt(asa.dataset.idx, 10);
      const a = p.anot[idx];
      const [px, py] = aPDF(p, vx, vy);
      dibujoActivo = { modo: 'redim', pag: iPag, idx, ox: a.x, oy: a.y, ow: a.w, oh: a.h, px, py };
      e.preventDefault();
      return;
    }
    // mover / seleccionar
    const objetivo = e.target.closest('.anot, svg[data-idx]');
    if (objetivo && objetivo.dataset.idx !== undefined) {
      const idx = parseInt(objetivo.dataset.idx, 10);
      anotSel = { pag: iPag, idx };
      const a = p.anot[idx];
      const [px, py] = aPDF(p, vx, vy);
      dibujoActivo = (a.tipo === 'dibujo')
        ? { modo: 'moverTrazo', pag: iPag, idx, px, py }
        : { modo: 'mover', pag: iPag, idx, px, py, ax: a.x, ay: a.y };
      renderizarAnotaciones(iPag);
      e.preventDefault();
    } else {
      anotSel = null;
      renderizarAnotaciones(iPag);
    }
  });

  ov.addEventListener('dblclick', (e) => {
    const nota = e.target.closest('.anot.nota');
    if (nota) { editarNota(parseInt(nota.dataset.pag, 10), parseInt(nota.dataset.idx, 10)); return; }
    if (herramienta !== 'mover') return;
    const objetivo = e.target.closest('.anot.texto');
    if (objetivo) editarTextoAnot(parseInt(objetivo.dataset.pag, 10), parseInt(objetivo.dataset.idx, 10));
  });
}

document.addEventListener('mousemove', (e) => {
  if (!dibujoActivo) return;
  const p = paginas[dibujoActivo.pag];
  const r = p._overlay.getBoundingClientRect();
  const vx = Math.max(0, Math.min(e.clientX - r.left, r.width));
  const vy = Math.max(0, Math.min(e.clientY - r.top, r.height));
  const [x, y] = aPDF(p, vx, vy);
  const a = p.anot[dibujoActivo.idx];
  if (!a) return;
  if (dibujoActivo.modo === 'caja') {
    a.x = Math.min(dibujoActivo.ox, x); a.y = Math.min(dibujoActivo.oy, y);
    a.w = Math.abs(x - dibujoActivo.ox); a.h = Math.abs(y - dibujoActivo.oy);
  } else if (dibujoActivo.modo === 'trazo') {
    a.puntos.push([x, y]);
  } else if (dibujoActivo.modo === 'mover') {
    a.x = dibujoActivo.ax + (x - dibujoActivo.px);
    a.y = dibujoActivo.ay + (y - dibujoActivo.py);
  } else if (dibujoActivo.modo === 'moverTrazo') {
    const dx = x - dibujoActivo.px, dy = y - dibujoActivo.py;
    a.puntos = a.puntos.map(([px2, py2]) => [px2 + dx, py2 + dy]);
    dibujoActivo.px = x; dibujoActivo.py = y;
  } else if (dibujoActivo.modo === 'redim') {
    // El asa está abajo-derecha en pantalla → x crece, y decrece en PDF
    a.w = Math.max(6, dibujoActivo.ow + (x - dibujoActivo.px));
    const nuevoY = dibujoActivo.oy + (y - dibujoActivo.py);
    a.h = Math.max(6, dibujoActivo.oh + (dibujoActivo.oy - nuevoY));
    a.y = nuevoY;
  }
  renderizarAnotaciones(dibujoActivo.pag);
});

document.addEventListener('mouseup', () => {
  if (dibujoActivo) {
    const p = paginas[dibujoActivo.pag];
    const a = p.anot[dibujoActivo.idx];
    // Descartar cajas sin tamaño
    if (a && dibujoActivo.modo === 'caja' && (a.w < 2 || a.h < 2)) p.anot.splice(dibujoActivo.idx, 1);
    renderizarAnotaciones(dibujoActivo.pag);
    marcarModificado();
    dibujoActivo = null;
  }
});

function editarTextoAnot(iPag, idx) {
  const p = paginas[iPag];
  renderizarAnotaciones(iPag);
  const el = p._overlay.querySelector(`.anot.texto[data-idx="${idx}"]`);
  if (!el) return;
  el.contentEditable = 'true';
  el.focus();
  document.execCommand('selectAll');
  const terminar = () => {
    el.contentEditable = 'false';
    const a = p.anot[idx];
    if (a) {
      a.texto = el.innerText.trim();
      if (!a.texto) p.anot.splice(idx, 1);
    }
    renderizarAnotaciones(iPag);
    marcarModificado();
  };
  el.addEventListener('blur', terminar, { once: true });
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') el.blur(); });
}

// Editar el contenido de una nota adhesiva en un globo flotante
let globoNota = null;
function editarNota(iPag, idx) {
  cerrarGlobo();
  const p = paginas[iPag];
  const a = p.anot[idx];
  if (!a) return;
  const el = p._overlay.querySelector(`.anot.nota[data-idx="${idx}"]`);
  const g = document.createElement('div');
  g.className = 'nota-globo';
  g.contentEditable = 'true';
  g.textContent = a.texto || '';
  const r = (el || p._overlay).getBoundingClientRect();
  g.style.left = Math.min(r.right + 6, window.innerWidth - 220) + 'px';
  g.style.top = r.top + 'px';
  document.body.appendChild(g);
  g.focus();
  globoNota = { g, iPag, idx };
  g.addEventListener('blur', () => {
    a.texto = g.innerText.trim();
    cerrarGlobo();
    renderizarAnotaciones(iPag);
    marcarModificado();
  }, { once: true });
}
function cerrarGlobo() { if (globoNota) { globoNota.g.remove(); globoNota = null; } }

// Insertar imagen en una posición concreta (herramienta imagen)
async function insertarImagenEn(iPag, [x, y]) {
  const ruta = await ipcRenderer.invoke('dialogo-abrir', {
    title: 'Insertar imagen',
    filters: [{ name: 'Imágenes PNG/JPG', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile']
  });
  if (!ruta) return;
  const ext = path.extname(ruta).toLowerCase() === '.png' ? 'png' : 'jpeg';
  const src = `data:image/${ext};base64,${fs.readFileSync(ruta).toString('base64')}`;
  const img = new Image();
  img.onload = () => {
    const p = paginas[iPag];
    const esc = Math.min((p.ancho * 0.4) / img.width, 1);
    const w = img.width * esc, h = img.height * esc;
    p.anot.push({ tipo: 'imagen', src, x, y: y - h, w, h });
    anotSel = { pag: iPag, idx: p.anot.length - 1 };
    renderizarAnotaciones(iPag);
    marcarModificado();
  };
  img.src = src;
}

// ---------- Herramientas ----------
function fijarHerramienta(h) {
  herramienta = h;
  cerrarGlobo();
  document.querySelectorAll('.btn.herr').forEach(b => b.classList.toggle('activa', b.dataset.herr === h));
  paginas.forEach((p, i) => { if (p._overlay) p._overlay.className = 'overlay h-' + h; });
}
document.querySelectorAll('.btn.herr').forEach(b => b.addEventListener('click', () => fijarHerramienta(b.dataset.herr)));

function eliminarAnotSel() {
  if (!anotSel) return;
  const p = paginas[anotSel.pag];
  p.anot.splice(anotSel.idx, 1);
  const pag = anotSel.pag;
  anotSel = null;
  renderizarAnotaciones(pag);
  marcarModificado();
}
$('btnEliminarAnot').addEventListener('click', eliminarAnotSel);

document.addEventListener('keydown', (e) => {
  if (document.activeElement && (document.activeElement.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) return;
  if (e.key === 'Delete' || e.key === 'Backspace') eliminarAnotSel();
  else if (e.key === 'Escape') fijarHerramienta('mover');
  else if (e.key === 't' || e.key === 'T') fijarHerramienta('texto');
  else if (e.key === 'e' || e.key === 'E') fijarHerramienta('editar');
});

// Cambios de tamaño/color aplicados a la anotación seleccionada
$('selTamanoTexto').addEventListener('change', (e) => {
  if (!anotSel) return;
  const a = paginas[anotSel.pag].anot[anotSel.idx];
  if (a && a.tipo === 'texto') {
    a.tam = parseInt(e.target.value, 10) || a.tam;
    renderizarAnotaciones(anotSel.pag);
    marcarModificado();
  }
});
$('colorAnot').addEventListener('input', (e) => {
  if (!anotSel) return;
  const a = paginas[anotSel.pag].anot[anotSel.idx];
  if (a && a.tipo !== 'imagen' && a.tipo !== 'blanqueo') {
    a.color = e.target.value;
    renderizarAnotaciones(anotSel.pag);
    marcarModificado();
  }
});

// ---------- Imagen ----------
async function insertarImagen() {
  if (!paginas.length) return;
  const ruta = await ipcRenderer.invoke('dialogo-abrir', {
    title: 'Insertar imagen',
    filters: [{ name: 'Imágenes PNG/JPG', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile']
  });
  if (!ruta) return;
  const ext = path.extname(ruta).toLowerCase() === '.png' ? 'png' : 'jpeg';
  const src = `data:image/${ext};base64,${fs.readFileSync(ruta).toString('base64')}`;
  const img = new Image();
  img.onload = () => {
    const p = paginas[paginaActual];
    const maxW = p.ancho * 0.5;
    const esc = Math.min(maxW / img.width, (p.alto * 0.5) / img.height, 1);
    const w = img.width * esc, h = img.height * esc;
    p.anot.push({ tipo: 'imagen', src, x: (p.ancho - w) / 2, y: (p.alto - h) / 2, w, h });
    anotSel = { pag: paginaActual, idx: p.anot.length - 1 };
    fijarHerramienta('mover');
    renderizarAnotaciones(paginaActual);
    marcarModificado();
  };
  img.src = src;
}
// btnImagen ahora es una herramienta (data-herr="imagen"): al hacer clic en la página se coloca la imagen.

// ---------- Páginas ----------
function rotar(delta) {
  if (!paginas.length) return;
  const p = paginas[paginaActual];
  p.rotExtra = ((p.rotExtra + delta) % 360 + 360) % 360;
  p._renderizada = false;
  renderizarPagina(paginaActual);
  renderizarMiniaturas();
  marcarModificado();
}
$('btnRotarDer').addEventListener('click', () => rotar(90));
$('btnRotarIzq').addEventListener('click', () => rotar(-90));

function paginaEnBlanco() {
  const base = paginas[paginaActual];
  paginas.splice(paginaActual + 1, 0, {
    src: null, indice: -1, rotExtra: 0, anot: [],
    ancho: base ? base.ancho : BLANCO.ancho, alto: base ? base.alto : BLANCO.alto
  });
  paginaActual++;
  renderizarTodo();
  marcarModificado();
}
$('btnPagBlanco').addEventListener('click', paginaEnBlanco);

// Duplicar la página actual (con sus anotaciones)
function duplicarPagina() {
  const p = paginas[paginaActual];
  const copia = {
    src: p.src, indice: p.indice, rotExtra: p.rotExtra,
    anot: JSON.parse(JSON.stringify(p.anot)),
    ancho: p.ancho, alto: p.alto
  };
  paginas.splice(paginaActual + 1, 0, copia);
  paginaActual++;
  renderizarTodo();
  marcarModificado();
}
$('btnDuplicarPag').addEventListener('click', duplicarPagina);

async function eliminarPagina() {
  if (paginas.length <= 1) {
    await ipcRenderer.invoke('mensaje', { type: 'info', title: 'Editar PDF', message: 'El documento debe conservar al menos una página.' });
    return;
  }
  paginas.splice(paginaActual, 1);
  paginaActual = Math.min(paginaActual, paginas.length - 1);
  renderizarTodo();
  marcarModificado();
}
$('btnEliminarPag').addEventListener('click', eliminarPagina);

function moverPagina(delta) {
  const destino = paginaActual + delta;
  if (destino < 0 || destino >= paginas.length) return;
  const [p] = paginas.splice(paginaActual, 1);
  paginas.splice(destino, 0, p);
  paginaActual = destino;
  renderizarTodo();
  marcarModificado();
}

// ---------- Zoom ----------
function fijarZoom(z) {
  escala = z;
  $('selZoom').value = String(z);
  paginas.forEach(p => { p._renderizada = false; });
  renderizarTodo();
}
$('selZoom').addEventListener('change', (e) => fijarZoom(parseFloat(e.target.value)));
$('btnZoomMas').addEventListener('click', () => fijarZoom(Math.min(escala + 0.25, 4)));
$('btnZoomMenos').addEventListener('click', () => fijarZoom(Math.max(escala - 0.25, 0.25)));

// ---------- Archivo ----------
async function abrirPDF() {
  const ruta = await ipcRenderer.invoke('dialogo-abrir', {
    title: 'Abrir PDF',
    filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }],
    properties: ['openFile']
  });
  if (!ruta) return;
  try {
    const bytes = new Uint8Array(fs.readFileSync(ruta));
    const docJS = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    fuentes = [{ bytes, docJS }];
    paginas = [];
    for (let i = 0; i < docJS.numPages; i++) {
      const pag = await docJS.getPage(i + 1);
      const vp = pag.getViewport({ scale: 1 });
      paginas.push({ src: 0, indice: i, rotExtra: 0, anot: [], ancho: vp.width, alto: vp.height, _pdfPage: pag });
    }
    archivoActual = ruta;
    paginaActual = 0;
    limpiarModificado();
    renderizarTodo();
  } catch (err) {
    await ipcRenderer.invoke('mensaje', { type: 'error', title: 'Editar PDF', message: 'No se pudo abrir el PDF.', detail: String(err.message || err) });
  }
}

// Crear un PDF en blanco desde cero (tamaño carta)
function nuevoPDF() {
  fuentes = [];
  paginas = [{ src: null, indice: -1, rotExtra: 0, anot: [], ancho: BLANCO.ancho, alto: BLANCO.alto }];
  archivoActual = null;
  paginaActual = 0;
  anotSel = null;
  limpiarModificado();
  renderizarTodo();
  fijarHerramienta('texto');
}

async function combinarPDF() {
  if (!paginas.length) { abrirPDF(); return; }
  const ruta = await ipcRenderer.invoke('dialogo-abrir', {
    title: 'Combinar con otro PDF',
    filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }],
    properties: ['openFile']
  });
  if (!ruta) return;
  try {
    const bytes = new Uint8Array(fs.readFileSync(ruta));
    const docJS = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const idFuente = fuentes.length;
    fuentes.push({ bytes, docJS });
    for (let i = 0; i < docJS.numPages; i++) {
      const pag = await docJS.getPage(i + 1);
      const vp = pag.getViewport({ scale: 1 });
      paginas.push({ src: idFuente, indice: i, rotExtra: 0, anot: [], ancho: vp.width, alto: vp.height, _pdfPage: pag });
    }
    renderizarTodo();
    marcarModificado();
  } catch (err) {
    await ipcRenderer.invoke('mensaje', { type: 'error', title: 'Editar PDF', message: 'No se pudo combinar el PDF.', detail: String(err.message || err) });
  }
}

// Construye un PDF nuevo con las páginas indicadas (o todas), aplicando rotaciones y anotaciones
async function construirPDF(indices) {
  const lista = indices || paginas.map((_, i) => i);
  const salida = await PDFDocument.create();
  const helv = await salida.embedFont(StandardFonts.Helvetica);
  const docsLib = {};
  for (const i of lista) {
    const p = paginas[i];
    if (p.src !== null && !docsLib[p.src]) docsLib[p.src] = await PDFDocument.load(fuentes[p.src].bytes);
  }
  const imagenes = {};

  for (const i of lista) {
    const p = paginas[i];
    let pagina;
    if (p.src === null) {
      pagina = salida.addPage([p.ancho, p.alto]);
    } else {
      const [copiada] = await salida.copyPages(docsLib[p.src], [p.indice]);
      pagina = salida.addPage(copiada);
      const rotOriginal = pagina.getRotation().angle || 0;
      pagina.setRotation(degrees(((rotOriginal + p.rotExtra) % 360 + 360) % 360));
    }
    const rotTotal = p.src === null ? 0 : pagina.getRotation().angle;

    for (const a of p.anot) {
      const c = hexARgb(a.color);
      if (a.tipo === 'texto') {
        pagina.drawText(a.texto, {
          x: a.x, y: a.y - a.tam,
          size: a.tam, font: helv,
          color: rgb(c.r, c.g, c.b),
          lineHeight: a.tam * 1.2,
          rotate: degrees(rotTotal)
        });
      } else if (a.tipo === 'blanqueo') {
        pagina.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, color: rgb(1, 1, 1) });
      } else if (a.tipo === 'redaccion') {
        pagina.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, color: rgb(0, 0, 0) });
      } else if (a.tipo === 'resaltar') {
        pagina.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, color: rgb(c.r, c.g, c.b), opacity: 0.35 });
      } else if (a.tipo === 'rect') {
        pagina.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, borderColor: rgb(c.r, c.g, c.b), borderWidth: 2 });
      } else if (a.tipo === 'subrayar') {
        pagina.drawLine({ start: { x: a.x, y: a.y }, end: { x: a.x + a.w, y: a.y }, thickness: 1.5, color: rgb(c.r, c.g, c.b) });
      } else if (a.tipo === 'tachar') {
        pagina.drawLine({ start: { x: a.x, y: a.y + a.h / 2 }, end: { x: a.x + a.w, y: a.y + a.h / 2 }, thickness: 1.5, color: rgb(c.r, c.g, c.b) });
      } else if (a.tipo === 'nota') {
        // Marca de nota amarilla con su texto debajo (se aplana como contenido)
        pagina.drawRectangle({ x: a.x, y: a.y, width: 16, height: 16, color: rgb(1, 0.82, 0.3) });
        if (a.texto) pagina.drawText(a.texto, { x: a.x, y: a.y - 12, size: 8, font: helv, color: rgb(0.2, 0.15, 0), maxWidth: 180, lineHeight: 10 });
      } else if (a.tipo === 'dibujo') {
        for (let k = 1; k < a.puntos.length; k++) {
          pagina.drawLine({
            start: { x: a.puntos[k - 1][0], y: a.puntos[k - 1][1] },
            end: { x: a.puntos[k][0], y: a.puntos[k][1] },
            thickness: a.grosor, color: rgb(c.r, c.g, c.b), lineCap: 1
          });
        }
      } else if (a.tipo === 'imagen') {
        if (!imagenes[a.src]) {
          const b64 = a.src.split(',')[1];
          const datos = Buffer.from(b64, 'base64');
          imagenes[a.src] = a.src.startsWith('data:image/png')
            ? await salida.embedPng(datos) : await salida.embedJpg(datos);
        }
        pagina.drawImage(imagenes[a.src], { x: a.x, y: a.y, width: a.w, height: a.h });
      }
    }
  }
  return salida.save();
}

async function guardarPDF(como) {
  if (!paginas.length) return false;
  let ruta = archivoActual;
  if (como || !ruta) {
    ruta = await ipcRenderer.invoke('dialogo-guardar', {
      title: 'Guardar PDF',
      defaultPath: archivoActual || 'documento.pdf',
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }]
    });
    if (!ruta) return false;
  }
  try {
    const bytes = await construirPDF();
    fs.writeFileSync(ruta, Buffer.from(bytes));
    archivoActual = ruta;
    limpiarModificado();
    return true;
  } catch (err) {
    await ipcRenderer.invoke('mensaje', { type: 'error', title: 'Editar PDF', message: 'No se pudo guardar el PDF.', detail: String(err.message || err) });
    return false;
  }
}

function parsearRango(txt, max) {
  const res = new Set();
  for (const parte of txt.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(parte);
    if (!m) continue;
    const a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      if (i >= 1 && i <= max) res.add(i - 1);
    }
  }
  return [...res].sort((x, y) => x - y);
}

async function extraerPaginas() {
  if (!paginas.length) return;
  $('dialogoExtraer').classList.remove('oculto');
  $('rangoExtraer').value = String(paginaActual + 1);
  $('rangoExtraer').focus();
}
$('btnExtraerOk').addEventListener('click', async () => {
  const indices = parsearRango($('rangoExtraer').value, paginas.length);
  $('dialogoExtraer').classList.add('oculto');
  if (!indices.length) return;
  const ruta = await ipcRenderer.invoke('dialogo-guardar', {
    title: 'Guardar páginas extraídas',
    defaultPath: 'extraido.pdf',
    filters: [{ name: 'Documento PDF', extensions: ['pdf'] }]
  });
  if (!ruta) return;
  try {
    const bytes = await construirPDF(indices);
    fs.writeFileSync(ruta, Buffer.from(bytes));
    await ipcRenderer.invoke('mensaje', { type: 'info', title: 'Editar PDF', message: `${indices.length} páginas extraídas correctamente.`, detail: ruta });
  } catch (err) {
    await ipcRenderer.invoke('mensaje', { type: 'error', title: 'Editar PDF', message: 'No se pudieron extraer las páginas.', detail: String(err.message || err) });
  }
});
document.querySelectorAll('[data-cerrar]').forEach(b =>
  b.addEventListener('click', () => document.querySelectorAll('.dialogo-fondo').forEach(d => d.classList.add('oculto'))));

// ---------- Botones y menú ----------
$('btnAbrir').addEventListener('click', abrirPDF);
$('btnAbrirGrande').addEventListener('click', abrirPDF);
$('btnNuevoGrande').addEventListener('click', nuevoPDF);
$('btnGuardar').addEventListener('click', () => guardarPDF(false));
$('btnCombinar').addEventListener('click', combinarPDF);
$('btnExtraer').addEventListener('click', extraerPaginas);
$('btnIA').addEventListener('click', () => window.IA.alternar());
$('colorAnot').addEventListener('input', (e) => { $('iconoColor').style.borderBottomColor = e.target.value; });

ipcRenderer.on('menu', async (_e, accion) => {
  switch (accion) {
    case 'nuevo': nuevoPDF(); break;
    case 'abrir': abrirPDF(); break;
    case 'herramientaEditar': fijarHerramienta('editar'); break;
    case 'guardar': guardarPDF(false); break;
    case 'guardarComo': guardarPDF(true); break;
    case 'guardarYSalir': { const ok = await guardarPDF(false); if (ok) ipcRenderer.send('salir-forzado'); break; }
    case 'combinarPDF': combinarPDF(); break;
    case 'extraerPaginas': extraerPaginas(); break;
    case 'rotarDer': rotar(90); break;
    case 'rotarIzq': rotar(-90); break;
    case 'paginaBlanco': paginaEnBlanco(); break;
    case 'eliminarPagina': eliminarPagina(); break;
    case 'subirPagina': moverPagina(-1); break;
    case 'bajarPagina': moverPagina(1); break;
    case 'herramientaTexto': fijarHerramienta('texto'); break;
    case 'herramientaResaltar': fijarHerramienta('resaltar'); break;
    case 'herramientaDibujo': fijarHerramienta('dibujo'); break;
    case 'herramientaRect': fijarHerramienta('rect'); break;
    case 'herramientaImagen': fijarHerramienta('imagen'); break;
    case 'herramientaMover': fijarHerramienta('mover'); break;
  }
});

// ---------- Pestañas de la barra lateral ----------
document.querySelectorAll('.pestana-lat').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.pestana-lat').forEach(x => x.classList.toggle('activa', x === b));
  $('panelMiniaturas').classList.toggle('oculto', b.dataset.panel !== 'miniaturas');
  $('panelMarcadores').classList.toggle('oculto', b.dataset.panel !== 'marcadores');
}));

// ---------- Marcadores ----------
let marcadores = []; // { pag, titulo }
$('btnAgregarMarcador').addEventListener('click', async () => {
  if (!paginas.length) return;
  const titulo = prompt('Nombre del marcador:', 'Página ' + (paginaActual + 1));
  if (titulo === null) return;
  marcadores.push({ pag: paginaActual, titulo: titulo.trim() || 'Página ' + (paginaActual + 1) });
  marcadores.sort((a, b) => a.pag - b.pag);
  renderizarMarcadores();
  marcarModificado();
  // Cambiar a la pestaña de marcadores
  document.querySelector('.pestana-lat[data-panel="marcadores"]').click();
});
function renderizarMarcadores() {
  const cont = $('panelMarcadores');
  cont.innerHTML = '';
  if (!marcadores.length) { cont.innerHTML = '<div style="color:#987;font-size:12px;text-align:center;padding:20px">Sin marcadores.<br>Usa 🔖 Marcador.</div>'; return; }
  marcadores.forEach((mk, i) => {
    const d = document.createElement('div');
    d.className = 'marcador';
    d.innerHTML = `<span class="mc-num">${mk.pag + 1}</span><span>${mk.titulo.replace(/</g, '&lt;')}</span><button class="mc-del" title="Quitar">&#10005;</button>`;
    d.addEventListener('click', (e) => {
      if (e.target.classList.contains('mc-del')) return;
      paginaActual = mk.pag; marcarMiniActiva();
      if (paginas[mk.pag] && paginas[mk.pag]._div) paginas[mk.pag]._div.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    d.querySelector('.mc-del').addEventListener('click', () => { marcadores.splice(i, 1); renderizarMarcadores(); marcarModificado(); });
    cont.appendChild(d);
  });
}

// ---------- Dividir PDF ----------
$('btnDividir').addEventListener('click', () => {
  if (!paginas.length) return;
  $('dialogoDividir').classList.remove('oculto');
});
$('btnDividirOk').addEventListener('click', async () => {
  const modo = document.querySelector('input[name="modoDiv"]:checked').value;
  $('dialogoDividir').classList.add('oculto');
  let grupos = [];
  if (modo === 'cada') {
    grupos = paginas.map((_, i) => [i]);
  } else {
    const partes = $('rangosDiv').value.split(',');
    for (const parte of partes) {
      const idxs = parsearRango(parte, paginas.length);
      if (idxs.length) grupos.push(idxs);
    }
  }
  if (!grupos.length) return;
  const carpeta = await ipcRenderer.invoke('dialogo-guardar', {
    title: 'Guardar partes (se numerarán automáticamente)',
    defaultPath: 'parte.pdf',
    filters: [{ name: 'Documento PDF', extensions: ['pdf'] }]
  });
  if (!carpeta) return;
  const base = carpeta.replace(/\.pdf$/i, '');
  try {
    let n = 0;
    for (let g = 0; g < grupos.length; g++) {
      const bytes = await construirPDF(grupos[g]);
      fs.writeFileSync(`${base}_${g + 1}.pdf`, Buffer.from(bytes));
      n++;
    }
    await ipcRenderer.invoke('mensaje', { type: 'info', title: 'Editar PDF', message: `Documento dividido en ${n} archivos.`, detail: base + '_N.pdf' });
  } catch (err) {
    await ipcRenderer.invoke('mensaje', { type: 'error', title: 'Editar PDF', message: 'No se pudo dividir.', detail: String(err.message || err) });
  }
});

// ---------- Aplanar (fijar anotaciones) ----------
$('btnAplanar').addEventListener('click', async () => {
  if (!paginas.length) return;
  const r = await ipcRenderer.invoke('mensaje', {
    type: 'question', buttons: ['Aplanar y guardar', 'Cancelar'], defaultId: 0, cancelId: 1,
    title: 'Editar PDF',
    message: 'Aplanar el documento',
    detail: 'Las anotaciones se fijarán al contenido y dejarán de ser editables. Se guardará como un PDF nuevo.'
  });
  if (r !== 0) return;
  const ruta = await ipcRenderer.invoke('dialogo-guardar', {
    title: 'Guardar PDF aplanado', defaultPath: (archivoActual ? path.basename(archivoActual, '.pdf') : 'documento') + '_aplanado.pdf',
    filters: [{ name: 'Documento PDF', extensions: ['pdf'] }]
  });
  if (!ruta) return;
  try {
    const bytes = await construirPDF(); // construirPDF ya "quema" las anotaciones en el contenido
    fs.writeFileSync(ruta, Buffer.from(bytes));
    await ipcRenderer.invoke('mensaje', { type: 'info', title: 'Editar PDF', message: 'Documento aplanado y guardado.', detail: ruta });
  } catch (err) {
    await ipcRenderer.invoke('mensaje', { type: 'error', title: 'Editar PDF', message: 'No se pudo aplanar.', detail: String(err.message || err) });
  }
});

// Cerrar diálogos con data-cerrar (dividir)
document.querySelectorAll('#dialogoDividir [data-cerrar]').forEach(b =>
  b.addEventListener('click', () => $('dialogoDividir').classList.add('oculto')));

// ---------- Integración con el Asistente IA ----------
window.IA_APP = {
  nombre: 'Editar PDF',
  etiquetaInsertar: 'Agregar como nota de texto',
  instrucciones:
    'El documento es un PDF. El usuario puede pedirte resúmenes o preguntas sobre su contenido, ' +
    'o pedirte texto para agregar como anotación.',
  obtenerContexto() { return window._textoPDF || '(El PDF aún no tiene texto extraído; abre un documento.)'; },
  insertar(texto) {
    if (!paginas.length) nuevoPDF();
    const p = paginas[paginaActual];
    p.anot.push({
      tipo: 'texto', x: 60, y: p.alto - 60,
      texto: texto.replace(/\r/g, ''),
      tam: parseInt($('selTamanoTexto').value, 10) || 14,
      color: $('colorAnot').value
    });
    renderizarAnotaciones(paginaActual);
    marcarModificado();
  },
  acciones: {
    ir_a_pagina: {
      descripcion: 'Desplaza la vista a una página. Parámetros: {"pagina": 3}',
      fn: (p) => {
        const i = (parseInt(p.pagina, 10) || 1) - 1;
        if (i < 0 || i >= paginas.length) throw new Error('Página fuera de rango');
        paginaActual = i;
        if (paginas[i]._div) paginas[i]._div.scrollIntoView({ behavior: 'smooth' });
        marcarMiniActiva(); actualizarTitulo();
        return 'Mostrando la página ' + (i + 1);
      }
    },
    crear_pdf_en_blanco: {
      descripcion: 'Crea un PDF nuevo en blanco (tamaño carta). Sin parámetros.',
      fn: () => { nuevoPDF(); return 'PDF en blanco creado'; }
    }
  }
};

// Extraer el texto del PDF (para el contexto de la IA)
async function extraerTextoParaIA() {
  let total = '';
  for (let i = 0; i < paginas.length && total.length < 100000; i++) {
    const p = paginas[i];
    const pagJS = await paginaJS(p);
    if (!pagJS) continue;
    const tc = await pagJS.getTextContent();
    total += `\n--- Página ${i + 1} ---\n` + tc.items.map(it => it.str).join(' ');
  }
  window._textoPDF = total.trim();
}
// Actualizar el texto extraído cada vez que se abre/combina
const _renderizarTodoOriginal = renderizarTodo;
renderizarTodo = async function () {
  await _renderizarTodoOriginal();
  extraerTextoParaIA();
};

actualizarTitulo();
