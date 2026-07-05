// ===== Escribir - procesador de texto de la suite Oficinar =====
// Documento con páginas separadas y paginación automática (los bloques fluyen entre hojas).
const { ipcRenderer, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

const $ = (id) => document.getElementById(id);
const marco = $('marcoPagina');

let archivoActual = null;
let modificado = false;
let ultimoRango = null;   // último cursor dentro del documento (para insertar desde IA/diálogos)

// ---------- Formato de la hoja ----------
const TAMANOS = {
  carta: { w: 816, h: 1056, pdf: 'Letter' },
  a4: { w: 794, h: 1123, pdf: 'A4' },
  oficio: { w: 816, h: 1344, pdf: 'Legal' }
};
let formatoPagina = { tamano: 'carta', orientacion: 'vertical', margen: 96, color: '#ffffff', encabezado: '', pie: '', columnas: 1 };

function dimensionesPagina() {
  const t = TAMANOS[formatoPagina.tamano] || TAMANOS.carta;
  return formatoPagina.orientacion === 'horizontal' ? { w: t.h, h: t.w } : { w: t.w, h: t.h };
}

function aplicarFormatoPagina() {
  const d = dimensionesPagina();
  marco.style.setProperty('--pag-ancho', d.w + 'px');
  marco.style.setProperty('--pag-alto', d.h + 'px');
  marco.style.setProperty('--pag-margen', formatoPagina.margen + 'px');
  marco.style.setProperty('--pag-color', formatoPagina.color);
  construirRegla(d.w, formatoPagina.margen);
  repaginar();
  aplicarColumnas();
}

// Campos automáticos en encabezado/pie: {pagina} {total} {fecha} {archivo}
function resolverCampos(texto, numPagina, total) {
  return (texto || '')
    .replace(/\{pagina\}/gi, numPagina)
    .replace(/\{total\}/gi, total)
    .replace(/\{fecha\}/gi, new Date().toLocaleDateString('es', { dateStyle: 'long' }))
    .replace(/\{archivo\}/gi, archivoActual ? path.basename(archivoActual) : 'Documento nuevo');
}
function actualizarEncabezadosPies() {
  const pgs = paginasDoc();
  const total = pgs.length;
  pgs.forEach((p, k) => {
    let enc = p.querySelector(':scope > .pag-encabezado');
    let pie = p.querySelector(':scope > .pag-pie');
    if (formatoPagina.encabezado) {
      if (!enc) { enc = document.createElement('div'); enc.className = 'pag-encabezado'; enc.contentEditable = 'false'; p.appendChild(enc); }
      enc.textContent = resolverCampos(formatoPagina.encabezado, k + 1, total);
    } else if (enc) enc.remove();
    if (formatoPagina.pie) {
      if (!pie) { pie = document.createElement('div'); pie.className = 'pag-pie'; pie.contentEditable = 'false'; p.appendChild(pie); }
      pie.textContent = resolverCampos(formatoPagina.pie, k + 1, total);
    } else if (pie) pie.remove();
  });
}

// ---------- Páginas ----------
const paginasDoc = () => [...marco.querySelectorAll('.pagina')];

function crearPagina() {
  const p = document.createElement('div');
  p.className = 'pagina';
  p.contentEditable = 'true';
  p.spellcheck = true;
  return p;
}
function obtenerPagina(i) {
  const pgs = paginasDoc();
  if (pgs[i]) return pgs[i];
  const nueva = crearPagina();
  marco.appendChild(nueva);
  return nueva;
}
function paginaDe(nodo) {
  while (nodo && nodo !== document) {
    if (nodo.classList && nodo.classList.contains('pagina')) return nodo;
    nodo = nodo.parentNode;
  }
  return null;
}
function paginaActiva() {
  if (ultimoRango) { const p = paginaDe(ultimoRango.startContainer); if (p) return p; }
  return paginasDoc()[0];
}
function contenidoHTML() { return paginasDoc().map(p => p.innerHTML).join(''); }
function textoDocumento() { return paginasDoc().map(p => p.innerText || '').join('\n'); }

function establecerHTML(html) {
  paginasDoc().slice(1).forEach(p => p.remove());
  paginasDoc()[0].innerHTML = html || '<p><br></p>';
  ultimoRango = null;
  repaginar();
}

// ---------- Paginación automática ----------
const ETIQUETAS_INLINE = ['B', 'I', 'U', 'S', 'A', 'SPAN', 'FONT', 'IMG', 'CODE', 'SUB', 'SUP', 'BR', 'EM', 'STRONG', 'MARK', 'SMALL'];

function esDecoracion(n) {
  return n && n.nodeType === 1 && (n.classList.contains('pag-encabezado') || n.classList.contains('pag-pie'));
}
function normalizarPagina(p) {
  // Envolver texto e inlines sueltos en párrafos para poder moverlos entre páginas
  let n = p.firstChild;
  while (n) {
    const sig = n.nextSibling;
    if (esDecoracion(n)) { n = sig; continue; }
    if (n.nodeType === 3 && !n.textContent.trim()) { n.remove(); n = sig; continue; }
    const esInline = n.nodeType === 3 || (n.nodeType === 1 && ETIQUETAS_INLINE.includes(n.tagName));
    if (esInline) {
      const envoltura = document.createElement('p');
      p.insertBefore(envoltura, n);
      let m = n;
      while (m) {
        const s2 = m.nextSibling;
        const esIn = m.nodeType === 3 || (m.nodeType === 1 && ETIQUETAS_INLINE.includes(m.tagName));
        if (!esIn) break;
        envoltura.appendChild(m);
        m = s2;
      }
      n = envoltura.nextSibling;
    } else {
      n = sig;
    }
  }
}

const desborda = (p) => p.scrollHeight > p.clientHeight + 1;

function capturarCaret() {
  const s = window.getSelection();
  if (s.rangeCount && marco.contains(s.anchorNode)) return s.getRangeAt(0);
  return null;
}
function restaurarCaret(r) {
  if (!r) return;
  try {
    const p = paginaDe(r.startContainer);
    if (p && document.activeElement !== p) p.focus({ preventScroll: true });
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  } catch (e) { /* el nodo pudo desaparecer */ }
}

let timerRepag = null;
function repaginarPronto() { clearTimeout(timerRepag); timerRepag = setTimeout(repaginar, 160); }

function repaginar() {
  clearTimeout(timerRepag);
  const caret = capturarCaret();

  for (let i = 0; i < 400; i++) {
    const pgs = paginasDoc();
    if (i >= pgs.length) break;
    const p = pgs[i];
    normalizarPagina(p);
    if (!p.firstElementChild) p.innerHTML = '<p><br></p>';

    // Salto de página forzado: todo lo que sigue pasa a la página siguiente
    const salto = p.querySelector(':scope > .salto-pagina, :scope > hr.salto-pagina');
    if (salto && salto.nextSibling) {
      const resto = [];
      let n = salto.nextSibling;
      while (n) { resto.push(n); n = n.nextSibling; }
      const sig = obtenerPagina(i + 1);
      for (let k = resto.length - 1; k >= 0; k--) sig.insertBefore(resto[k], sig.firstChild);
    }

    // Empujar los bloques que desbordan hacia la página siguiente (sin contar decoraciones)
    let guardia = 0;
    while (desborda(p) && bloquesEn(p).length > 1 && guardia++ < 600) {
      const sig = obtenerPagina(i + 1);
      sig.insertBefore(ultimoBloque(p), primerBloque(sig) || null);
    }

    // Subir bloques de la página siguiente mientras quepan (y no haya salto forzado)
    guardia = 0;
    while (guardia++ < 600) {
      const ultimo = ultimoBloque(p);
      if (ultimo && ultimo.classList && ultimo.classList.contains('salto-pagina')) break;
      const sig = paginasDoc()[i + 1];
      if (!sig) break;
      const primero = primerBloque(sig);
      if (!primero) { if (!bloquesEn(sig).length) sig.remove(); break; }
      const anclaPie = sig.querySelector(':scope > .pag-pie');
      p.insertBefore(primero, p.querySelector(':scope > .pag-pie') || null);
      if (desborda(p)) { sig.insertBefore(primero, primerBloque(sig) || null); break; }
    }
  }

  // Quitar páginas vacías del final (siempre queda al menos una)
  let pgs = paginasDoc();
  while (pgs.length > 1) {
    const u = pgs[pgs.length - 1];
    const bloques = bloquesEn(u);
    const vacia = bloques.length === 0 || (bloques.length === 1 && !u.textContent.trim() && !u.querySelector('img, table, hr'));
    if (vacia) { u.remove(); pgs = paginasDoc(); }
    else break;
  }

  // Numerar páginas
  const total = paginasDoc().length;
  paginasDoc().forEach((p, k) => { p.dataset.numero = `${k + 1} / ${total}`; });

  actualizarEncabezadosPies();
  if (formatoPagina.columnas > 1) aplicarColumnas();
  restaurarCaret(caret);
  actualizarEstadoPaginas();
}

// Bloques de flujo de una página (excluye encabezado/pie)
function bloquesEn(p) { return [...p.children].filter(n => !esDecoracion(n)); }
function primerBloque(p) { return bloquesEn(p)[0] || null; }
function ultimoBloque(p) { const b = bloquesEn(p); return b[b.length - 1] || null; }

function actualizarEstadoPaginas() {
  const pgs = paginasDoc();
  let actual = 1;
  const s = window.getSelection();
  if (s.rangeCount) {
    const p = paginaDe(s.anchorNode);
    if (p) actual = pgs.indexOf(p) + 1 || 1;
  }
  $('estadoPaginas').textContent = `Página ${actual} de ${pgs.length}`;
}

// Retroceso al inicio de una página: pasar al final de la anterior
marco.addEventListener('keydown', (e) => {
  if (e.key !== 'Backspace') return;
  const s = window.getSelection();
  if (!s.rangeCount || !s.isCollapsed) return;
  const r = s.getRangeAt(0);
  const p = paginaDe(r.startContainer);
  if (!p) return;
  const pgs = paginasDoc();
  const idx = pgs.indexOf(p);
  if (idx <= 0) return;
  const antes = document.createRange();
  antes.selectNodeContents(p);
  antes.setEnd(r.startContainer, r.startOffset);
  if (antes.toString() !== '' || antes.cloneContents().querySelector('img, table')) return;
  e.preventDefault();
  const prev = pgs[idx - 1];
  prev.focus({ preventScroll: true });
  const fin = document.createRange();
  fin.selectNodeContents(prev);
  fin.collapse(false);
  s.removeAllRanges(); s.addRange(fin);
  guardarRango();
});

// ---------- Utilidades ----------
function marcarModificado() {
  if (!modificado) { modificado = true; actualizarTitulo(); ipcRenderer.send('set-dirty', true); }
}
function limpiarModificado() {
  modificado = false; actualizarTitulo(); ipcRenderer.send('set-dirty', false);
}
function actualizarTitulo() {
  const nombre = archivoActual ? path.basename(archivoActual) : 'Documento nuevo';
  $('estadoArchivo').textContent = nombre;
  ipcRenderer.send('set-title', `${modificado ? '● ' : ''}${nombre} - Escribir`);
}

function exec(cmd, valor = null) {
  const p = paginaActiva();
  if (p) p.focus({ preventScroll: true });
  restaurarRango();
  document.execCommand(cmd, false, valor);
  actualizarEstadoBotones();
  repaginarPronto();
}

function guardarRango() {
  const sel = window.getSelection();
  if (sel.rangeCount && marco.contains(sel.anchorNode)) ultimoRango = sel.getRangeAt(0).cloneRange();
}
function restaurarRango() {
  if (!ultimoRango) return;
  const sel = window.getSelection();
  if (sel.rangeCount && marco.contains(sel.anchorNode)) return; // ya hay cursor válido
  try { sel.removeAllRanges(); sel.addRange(ultimoRango); } catch (e) { ultimoRango = null; }
}

function insertarHTML(html) {
  const p = paginaActiva();
  if (p) p.focus({ preventScroll: true });
  restaurarRango();
  document.execCommand('insertHTML', false, html);
  guardarRango();
  repaginarPronto();
}

function actualizarStats() {
  const texto = textoDocumento();
  const palabras = (texto.trim().match(/\S+/g) || []).length;
  $('estadoStats').textContent = `${palabras} palabras · ${texto.replace(/\n/g, '').length} caracteres`;
}

// ---------- Regla horizontal ----------
function construirRegla(ancho, margen) {
  const regla = $('regla');
  regla.innerHTML = '';
  regla.style.width = (ancho || 816) + 'px';
  const mIzq = document.createElement('div');
  mIzq.className = 'margen'; mIzq.style.left = '0'; mIzq.style.width = (margen || 96) + 'px';
  const mDer = document.createElement('div');
  mDer.className = 'margen'; mDer.style.right = '0'; mDer.style.width = (margen || 96) + 'px';
  regla.appendChild(mIzq); regla.appendChild(mDer);
  const PX_CM = 37.8;
  for (let cm = 1; cm * PX_CM < (ancho || 816); cm++) {
    const marca = document.createElement('div');
    marca.className = 'marca' + (cm % 2 ? ' media' : '');
    marca.style.left = (cm * PX_CM) + 'px';
    if (cm % 2 === 0) marca.innerHTML = `<span>${cm}</span>`;
    regla.appendChild(marca);
  }
}

// ---------- Fuentes (todas las instaladas en el equipo) ----------
poblarFuentesSistema($('selFuente'), 'Calibri');

// Tamaño en puntos: execCommand solo acepta 1-7, así que usamos el truco de reemplazo
function aplicarTamano(pt) {
  const p = paginaActiva();
  if (p) p.focus({ preventScroll: true });
  restaurarRango();
  document.execCommand('fontSize', false, '7');
  marco.querySelectorAll('font[size="7"]').forEach(f => {
    const span = document.createElement('span');
    span.style.fontSize = pt + 'pt';
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
  });
  marcarModificado();
  repaginarPronto();
}

// ---------- Botones de la cinta ----------
document.execCommand('styleWithCSS', false, true);

// Pegar desde el portapapeles (execCommand('paste') está bloqueado por Chromium)
function pegarPortapapeles() {
  const p = paginaActiva();
  if (p) p.focus({ preventScroll: true });
  restaurarRango();
  const html = clipboard.readHTML();
  if (html && html.trim()) document.execCommand('insertHTML', false, html);
  else {
    const t = clipboard.readText();
    if (t) document.execCommand('insertText', false, t);
  }
  guardarRango();
  marcarModificado();
  repaginarPronto();
}

$('btnDeshacer').addEventListener('click', () => exec('undo'));
$('btnRehacer').addEventListener('click', () => exec('redo'));
$('btnCortar').addEventListener('click', () => exec('cut'));
$('btnCopiar').addEventListener('click', () => exec('copy'));
$('btnPegar').addEventListener('click', pegarPortapapeles);

$('btnNegrita').addEventListener('click', () => exec('bold'));
$('btnCursiva').addEventListener('click', () => exec('italic'));
$('btnSubrayado').addEventListener('click', () => exec('underline'));
$('btnTachado').addEventListener('click', () => exec('strikeThrough'));
$('btnSub').addEventListener('click', () => exec('subscript'));
$('btnSuper').addEventListener('click', () => exec('superscript'));
$('btnBorrarFormato').addEventListener('click', () => exec('removeFormat'));

$('colorTexto').addEventListener('input', (e) => {
  $('iconoColorTexto').style.borderBottomColor = e.target.value;
  exec('foreColor', e.target.value);
});
$('colorResaltado').addEventListener('input', (e) => {
  $('iconoColorResaltado').style.borderBottomColor = e.target.value;
  exec('hiliteColor', e.target.value);
});

$('alignIzq').addEventListener('click', () => exec('justifyLeft'));
$('alignCentro').addEventListener('click', () => exec('justifyCenter'));
$('alignDer').addEventListener('click', () => exec('justifyRight'));
$('alignJust').addEventListener('click', () => exec('justifyFull'));
$('btnListaNum').addEventListener('click', () => exec('insertOrderedList'));
$('btnListaVineta').addEventListener('click', () => exec('insertUnorderedList'));
$('btnSangriaMas').addEventListener('click', () => exec('indent'));
$('btnSangriaMenos').addEventListener('click', () => exec('outdent'));

$('selFuente').addEventListener('change', (e) => exec('fontName', e.target.value));
$('selTamano').addEventListener('change', (e) => aplicarTamano(parseFloat(e.target.value)));
$('selEstilo').addEventListener('change', (e) => exec('formatBlock', '<' + e.target.value + '>'));

$('selInterlineado').addEventListener('change', (e) => {
  const v = e.target.value;
  bloquesSeleccionados().forEach(b => { b.style.lineHeight = v; });
  marcarModificado();
  repaginarPronto();
});

$('selZoom').addEventListener('change', (e) => { marco.style.zoom = e.target.value; });

// Autocorrección
let autocorreccionActiva = true;
$('btnAutocorregir').addEventListener('click', () => {
  autocorreccionActiva = !autocorreccionActiva;
  $('btnAutocorregir').classList.toggle('activo', autocorreccionActiva);
});
conectarAutocorreccion(marco, () => autocorreccionActiva);

// Clic debajo del contenido: llevar el cursor al final del documento
$('areaDoc').addEventListener('mousedown', (e) => {
  if (e.target !== e.currentTarget && e.target !== marco) return;
  const ultima = paginasDoc()[paginasDoc().length - 1];
  ultima.focus();
  const r = document.createRange();
  r.selectNodeContents(ultima);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
  e.preventDefault();
});

$('btnImagen').addEventListener('click', insertarImagen);
$('btnTabla').addEventListener('click', () => abrirDialogo('dialogoTabla'));
$('btnEnlace').addEventListener('click', abrirEnlace);
$('btnSimbolo').addEventListener('click', () => abrirDialogo('dialogoSimbolo'));
$('btnBuscar').addEventListener('click', () => abrirDialogo('dialogoBuscar'));
$('btnExportarPDF').addEventListener('click', exportarPDF);
$('btnIA').addEventListener('click', () => window.IA.alternar());
$('btnDisenoPagina').addEventListener('click', abrirDisenoPagina);

function bloquesSeleccionados() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return [];
  const bloques = new Set();
  const r = sel.getRangeAt(0);
  const bloqueDe = (n) => {
    while (n && n !== document) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('pagina')) return null;
      if (n.nodeType === 1 && /^(P|H1|H2|H3|H4|LI|BLOCKQUOTE|PRE|DIV)$/.test(n.tagName)) return n;
      n = n.parentNode;
    }
    return null;
  };
  const b1 = bloqueDe(r.startContainer), b2 = bloqueDe(r.endContainer);
  if (b1) bloques.add(b1);
  if (b2) bloques.add(b2);
  if (b1 && b2 && b1 !== b2 && b1.parentNode === b2.parentNode) {
    let sig = b1.nextElementSibling;
    while (sig && sig !== b2) { bloques.add(sig); sig = sig.nextElementSibling; }
  }
  return [...bloques];
}

// Estado activo de los botones según el cursor
function actualizarEstadoBotones() {
  const estados = {
    btnNegrita: 'bold', btnCursiva: 'italic', btnSubrayado: 'underline', btnTachado: 'strikeThrough',
    alignIzq: 'justifyLeft', alignCentro: 'justifyCenter', alignDer: 'justifyRight', alignJust: 'justifyFull',
    btnListaNum: 'insertOrderedList', btnListaVineta: 'insertUnorderedList'
  };
  for (const [id, cmd] of Object.entries(estados)) {
    try { $(id).classList.toggle('activo', document.queryCommandState(cmd)); } catch { /* sin selección */ }
  }
}
document.addEventListener('selectionchange', () => {
  const a = document.activeElement;
  if (a && a.classList && a.classList.contains('pagina')) {
    guardarRango();
    actualizarEstadoBotones();
    actualizarEstadoPaginas();
  }
});

marco.addEventListener('input', () => {
  marcarModificado();
  actualizarStats();
  repaginarPronto();
});

// ---------- Imagen: selección y configuración ----------
let imgSel = null;

function deseleccionarImagen() {
  if (imgSel) imgSel.classList.remove('img-sel');
  imgSel = null;
  $('panelImagen').classList.add('oculto');
}
function seleccionarImagen(img) {
  deseleccionarImagen();
  imgSel = img;
  img.classList.add('img-sel');
  const pct = parseInt(img.style.width, 10) || 100;
  $('imgAncho').value = pct;
  $('imgAnchoValor').textContent = pct + '%';
  posicionarPanelImagen();
  $('panelImagen').classList.remove('oculto');
}
function posicionarPanelImagen() {
  if (!imgSel) return;
  const r = imgSel.getBoundingClientRect();
  const panel = $('panelImagen');
  panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 260)) + 'px';
  panel.style.top = Math.min(r.bottom + 8, window.innerHeight - 110) + 'px';
}

marco.addEventListener('click', (e) => {
  if (e.target.tagName === 'IMG') { seleccionarImagen(e.target); e.preventDefault(); }
  else deseleccionarImagen();
});
$('areaDoc').addEventListener('scroll', () => { if (imgSel) posicionarPanelImagen(); });
$('panelImagen').addEventListener('mousedown', (e) => e.preventDefault()); // no robar el foco

$('imgAncho').addEventListener('input', (e) => {
  if (!imgSel) return;
  imgSel.style.width = e.target.value + '%';
  imgSel.style.height = 'auto';
  $('imgAnchoValor').textContent = e.target.value + '%';
  posicionarPanelImagen();
  marcarModificado();
  repaginarPronto();
});
function posicionImagen(estilos) {
  if (!imgSel) return;
  Object.assign(imgSel.style, { float: '', display: '', margin: '' }, estilos);
  posicionarPanelImagen();
  marcarModificado();
  repaginarPronto();
}
$('imgIzq').addEventListener('click', () => posicionImagen({ float: 'left', margin: '4px 14px 6px 0' }));
$('imgDer').addEventListener('click', () => posicionImagen({ float: 'right', margin: '4px 0 6px 14px' }));
$('imgCentro').addEventListener('click', () => posicionImagen({ display: 'block', margin: '10px auto' }));
$('imgLinea').addEventListener('click', () => posicionImagen({ margin: '2px 4px' }));
$('imgEliminar').addEventListener('click', () => {
  if (!imgSel) return;
  imgSel.remove();
  deseleccionarImagen();
  marcarModificado();
  actualizarStats();
  repaginar();
});
document.addEventListener('keydown', (e) => {
  if (imgSel && (e.key === 'Delete' || e.key === 'Backspace') &&
      !(document.activeElement && document.activeElement.isContentEditable)) {
    e.preventDefault();
    imgSel.remove(); deseleccionarImagen(); marcarModificado(); repaginar();
  }
});

// ---------- Diálogos ----------
function abrirDialogo(id) { guardarRango(); $(id).classList.remove('oculto'); const inp = $(id).querySelector('input'); if (inp) inp.focus(); }
function cerrarDialogos() { document.querySelectorAll('.dialogo-fondo').forEach(d => d.classList.add('oculto')); const p = paginaActiva(); if (p) p.focus({ preventScroll: true }); }
document.querySelectorAll('[data-cerrar]').forEach(b => b.addEventListener('click', cerrarDialogos));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { cerrarDialogos(); deseleccionarImagen(); } });

// Diseño de página
function abrirDisenoPagina() {
  $('pagTamano').value = formatoPagina.tamano;
  $('pagOrientacion').value = formatoPagina.orientacion;
  $('pagMargen').value = String(formatoPagina.margen);
  $('pagColor').value = formatoPagina.color;
  $('pagTextoEncab').value = formatoPagina.encabezado || '';
  $('pagTextoPie').value = formatoPagina.pie || '';
  abrirDialogo('dialogoPagina');
}
$('btnPaginaOk').addEventListener('click', () => {
  formatoPagina = Object.assign({}, formatoPagina, {
    tamano: $('pagTamano').value,
    orientacion: $('pagOrientacion').value,
    margen: parseInt($('pagMargen').value, 10) || 96,
    color: $('pagColor').value,
    encabezado: $('pagTextoEncab').value,
    pie: $('pagTextoPie').value
  });
  cerrarDialogos();
  aplicarFormatoPagina();
  marcarModificado();
});

// ---------- Menú flotante genérico ----------
let menuFlot = null;
function cerrarMenuFlot() { if (menuFlot) { menuFlot.remove(); menuFlot = null; } }
document.addEventListener('mousedown', (e) => { if (menuFlot && !menuFlot.contains(e.target)) cerrarMenuFlot(); });
function menuFlotante(botonId, items) {
  cerrarMenuFlot();
  const b = $(botonId).getBoundingClientRect();
  const m = document.createElement('div');
  m.className = 'menu-flotante-e';
  items.forEach(it => {
    if (it.sep) { const s = document.createElement('div'); s.className = 'mfe-sep'; m.appendChild(s); return; }
    const d = document.createElement('div'); d.className = 'mfe-item'; d.textContent = it.label;
    d.addEventListener('mousedown', (ev) => { ev.preventDefault(); cerrarMenuFlot(); it.fn(); });
    m.appendChild(d);
  });
  document.body.appendChild(m);
  m.style.left = Math.min(b.left, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = (b.bottom + 2) + 'px';
  menuFlot = m;
}

// ---------- Encabezado / pie ----------
$('btnEncabezado').addEventListener('click', () => { abrirDisenoPagina(); });

// ---------- Columnas ----------
$('btnColumnas').addEventListener('click', () => menuFlotante('btnColumnas', [
  { label: 'Una columna', fn: () => fijarColumnas(1, false) },
  { label: 'Dos columnas', fn: () => fijarColumnas(2, false) },
  { label: 'Tres columnas', fn: () => fijarColumnas(3, false) },
  { sep: true },
  { label: 'Dos columnas con línea', fn: () => fijarColumnas(2, true) }
]));
function fijarColumnas(n, linea) {
  formatoPagina.columnas = n;
  formatoPagina.colLinea = linea;
  aplicarColumnas();
  marcarModificado(); repaginarPronto();
}
function aplicarColumnas() {
  const n = formatoPagina.columnas || 1;
  paginasDoc().forEach(p => {
    p.classList.toggle('multicolumna', n > 1);
    p.classList.toggle('con-linea', n > 1 && !!formatoPagina.colLinea);
    p.style.columnCount = n > 1 ? String(n) : '';
  });
}

// ---------- Notas al pie ----------
let contadorNotas = 0;
$('btnNotaPie').addEventListener('click', insertarNotaPie);
function insertarNotaPie() {
  contadorNotas++;
  const n = contadorNotas;
  const p = paginaActiva();
  insertarHTML(`<sup class="nota-ref" data-nota="${n}">[${n}]</sup>`);
  // Añadir el cuerpo de la nota al final de la página actual
  let cont = p.querySelector(':scope > .notas-pie-cont');
  if (!cont) { cont = document.createElement('div'); cont.className = 'notas-pie-cont'; p.appendChild(cont); }
  const linea = document.createElement('div');
  linea.className = 'nota-pie-texto';
  linea.innerHTML = `<span class="nota-num">[${n}]</span>Escribe aquí la nota al pie...`;
  cont.appendChild(linea);
  marcarModificado(); repaginarPronto();
}

// ---------- Tabla de contenido ----------
$('btnTOC').addEventListener('click', insertarTOC);
function insertarTOC() {
  const titulos = [...marco.querySelectorAll('.pagina h1, .pagina h2, .pagina h3')];
  if (!titulos.length) {
    ipcRenderer.invoke('mensaje', { type: 'info', title: 'Escribir', message: 'No hay títulos.', detail: 'Aplica los estilos Título 1, 2 o 3 a los encabezados para generar el índice.' });
    return;
  }
  const pgs = paginasDoc();
  let html = '<div class="toc"><div class="toc-titulo">Tabla de contenido</div>';
  titulos.forEach(t => {
    const nivel = t.tagName.toLowerCase();
    let pag = 1;
    const pp = paginaDe(t); if (pp) pag = pgs.indexOf(pp) + 1;
    html += `<div class="toc-item ${nivel === 'h2' ? 'n2' : nivel === 'h3' ? 'n3' : ''}"><span>${t.textContent.replace(/</g, '&lt;')}</span><span class="toc-rel"></span><span>${pag}</span></div>`;
  });
  html += '</div><p><br></p>';
  // Insertar al inicio del documento
  const primera = pgs[0];
  primera.insertBefore(crearFragmento(html), primerBloque(primera));
  marcarModificado(); repaginar();
}
function crearFragmento(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content;
}

// ---------- Menú de tabla ----------
$('btnTablaMenu').addEventListener('click', () => menuFlotante('btnTablaMenu', [
  { label: 'Insertar fila arriba', fn: () => filaTabla(-1) },
  { label: 'Insertar fila abajo', fn: () => filaTabla(1) },
  { label: 'Insertar columna a la izquierda', fn: () => colTabla(-1) },
  { label: 'Insertar columna a la derecha', fn: () => colTabla(1) },
  { sep: true },
  { label: 'Eliminar fila', fn: eliminarFilaTabla },
  { label: 'Eliminar columna', fn: eliminarColTabla },
  { sep: true },
  { label: 'Suma de la columna (arriba)', fn: () => formulaTabla('col') },
  { label: 'Suma de la fila (izquierda)', fn: () => formulaTabla('fila') }
]));
function celdaActualTabla() {
  const s = window.getSelection();
  if (!s.rangeCount) return null;
  let n = s.anchorNode;
  while (n && n !== marco) { if (n.nodeType === 1 && (n.tagName === 'TD' || n.tagName === 'TH')) return n; n = n.parentNode; }
  return null;
}
function filaTabla(dir) {
  const td = celdaActualTabla(); if (!td) return;
  const tr = td.parentNode;
  const nueva = tr.cloneNode(true);
  nueva.querySelectorAll('td,th').forEach(c => c.innerHTML = '<br>');
  tr.parentNode.insertBefore(nueva, dir < 0 ? tr : tr.nextSibling);
  marcarModificado(); repaginarPronto();
}
function colTabla(dir) {
  const td = celdaActualTabla(); if (!td) return;
  const idx = [...td.parentNode.children].indexOf(td);
  const tabla = td.closest('table');
  tabla.querySelectorAll('tr').forEach(tr => {
    const ref = tr.children[idx];
    const celda = document.createElement(ref && ref.tagName === 'TH' ? 'th' : 'td');
    celda.innerHTML = '<br>';
    tr.insertBefore(celda, dir < 0 ? ref : (ref ? ref.nextSibling : null));
  });
  marcarModificado(); repaginarPronto();
}
function eliminarFilaTabla() {
  const td = celdaActualTabla(); if (!td) return;
  const tr = td.parentNode; const tabla = td.closest('table');
  if (tabla.querySelectorAll('tr').length > 1) { tr.remove(); marcarModificado(); repaginarPronto(); }
}
function eliminarColTabla() {
  const td = celdaActualTabla(); if (!td) return;
  const idx = [...td.parentNode.children].indexOf(td);
  const tabla = td.closest('table');
  tabla.querySelectorAll('tr').forEach(tr => { if (tr.children[idx]) tr.children[idx].remove(); });
  marcarModificado(); repaginarPronto();
}
function formulaTabla(modo) {
  const td = celdaActualTabla(); if (!td) return;
  const tr = td.parentNode; const tabla = td.closest('table');
  const idx = [...tr.children].indexOf(td);
  let suma = 0;
  if (modo === 'col') {
    for (const fila of tabla.querySelectorAll('tr')) {
      const c = fila.children[idx];
      if (c && c !== td) { const v = parseFloat((c.textContent || '').replace(',', '.')); if (!isNaN(v)) suma += v; }
    }
  } else {
    for (const c of tr.children) { if (c !== td) { const v = parseFloat((c.textContent || '').replace(',', '.')); if (!isNaN(v)) suma += v; } }
  }
  td.textContent = String(suma);
  marcarModificado(); repaginarPronto();
}

// Tabla
$('btnTablaOk').addEventListener('click', () => {
  const filas = Math.max(1, parseInt($('tablaFilas').value) || 3);
  const cols = Math.max(1, parseInt($('tablaCols').value) || 3);
  const conCab = $('tablaCabecera').checked;
  let html = '<table>';
  for (let i = 0; i < filas; i++) {
    html += '<tr>';
    for (let j = 0; j < cols; j++) html += (i === 0 && conCab) ? '<th><br></th>' : '<td><br></td>';
    html += '</tr>';
  }
  html += '</table><p><br></p>';
  cerrarDialogos();
  insertarHTML(html);
});

// Enlace
function abrirEnlace() {
  guardarRango();
  const sel = window.getSelection();
  $('enlaceTexto').value = sel.rangeCount ? sel.toString() : '';
  $('enlaceURL').value = '';
  abrirDialogo('dialogoEnlace');
}
$('btnEnlaceOk').addEventListener('click', () => {
  const url = $('enlaceURL').value.trim();
  const texto = $('enlaceTexto').value.trim() || url;
  if (!url) return;
  cerrarDialogos();
  insertarHTML(`<a href="${url.replace(/"/g, '&quot;')}" title="${url.replace(/"/g, '&quot;')}">${texto.replace(/</g, '&lt;')}</a>`);
});

// Símbolos
const SIMBOLOS = ['©','®','™','€','£','¥','¢','§','¶','†','‡','•','…','–','—','«','»','‹','›','“','”','‘','’',
  '°','±','×','÷','≠','≈','≤','≥','∞','√','∑','∏','∫','Δ','π','Ω','α','β','γ','λ','μ','θ','φ',
  '←','→','↑','↓','↔','⇒','⇐','⇔','★','☆','♥','♦','♣','♠','✓','✗','✦','✿','☀','☾','♪','♫'];
$('rejillaSimbolos').innerHTML = SIMBOLOS.map(s => `<button>${s}</button>`).join('');
$('rejillaSimbolos').addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON') { insertarHTML(e.target.textContent); marcarModificado(); }
});

// Buscar y reemplazar
function buscarSiguiente() {
  const t = $('textoBuscar').value;
  if (!t) return false;
  const p = paginaActiva(); if (p) p.focus({ preventScroll: true });
  const ok = window.find(t, false, false, true, false, true, false);
  $('resultadoBuscar').textContent = ok ? '' : 'No se encontraron más coincidencias.';
  return ok;
}
$('btnBuscarSig').addEventListener('click', buscarSiguiente);
$('textoBuscar').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarSiguiente(); });
$('btnReemplazar').addEventListener('click', () => {
  const t = $('textoBuscar').value;
  const sel = window.getSelection();
  if (t && sel.toString().toLowerCase() === t.toLowerCase()) {
    document.execCommand('insertText', false, $('textoReemplazar').value);
  }
  buscarSiguiente();
});
$('btnReemplazarTodo').addEventListener('click', () => {
  const t = $('textoBuscar').value;
  if (!t) return;
  const primera = paginasDoc()[0];
  primera.focus({ preventScroll: true });
  const sel = window.getSelection();
  sel.removeAllRanges();
  const r = document.createRange();
  r.setStart(primera, 0); r.collapse(true);
  sel.addRange(r);
  let n = 0;
  while (window.find(t, false, false, false, false, true, false) && n < 10000) {
    document.execCommand('insertText', false, $('textoReemplazar').value);
    n++;
  }
  $('resultadoBuscar').textContent = `${n} reemplazos realizados.`;
  repaginarPronto();
});

// ---------- Insertar imagen ----------
async function insertarImagen() {
  guardarRango();
  const ruta = await ipcRenderer.invoke('dialogo-abrir', {
    title: 'Insertar imagen',
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }],
    properties: ['openFile']
  });
  if (!ruta) return;
  const ext = path.extname(ruta).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'svg+xml' : (ext === 'jpg' ? 'jpeg' : ext);
  const b64 = fs.readFileSync(ruta).toString('base64');
  insertarHTML(`<img src="data:image/${mime};base64,${b64}" alt="${path.basename(ruta)}">`);
  marcarModificado();
}

// ---------- Archivo ----------
const FILTROS_ABRIR = [
  { name: 'Documentos compatibles', extensions: ['escrito', 'html', 'htm', 'docx', 'txt', 'md'] },
  { name: 'Documento de Escribir', extensions: ['escrito'] },
  { name: 'Documento de Word', extensions: ['docx'] },
  { name: 'Página web', extensions: ['html', 'htm'] },
  { name: 'Texto', extensions: ['txt', 'md'] }
];

async function confirmarPerdida() {
  if (!modificado) return true;
  const r = await ipcRenderer.invoke('mensaje', {
    type: 'question', buttons: ['Guardar', 'No guardar', 'Cancelar'], defaultId: 0, cancelId: 2,
    title: 'Escribir', message: '¿Desea guardar los cambios del documento actual?'
  });
  if (r === 2) return false;
  if (r === 0) return await accionGuardar();
  return true;
}

async function accionNuevo() {
  if (!await confirmarPerdida()) return;
  archivoActual = null;
  formatoPagina = { tamano: 'carta', orientacion: 'vertical', margen: 96, color: '#ffffff' };
  aplicarFormatoPagina();
  establecerHTML('<p><br></p>');
  limpiarModificado();
  actualizarStats();
}

async function accionAbrir() {
  if (!await confirmarPerdida()) return;
  const ruta = await ipcRenderer.invoke('dialogo-abrir', { title: 'Abrir documento', filters: FILTROS_ABRIR, properties: ['openFile'] });
  if (!ruta) return;
  await abrirRuta(ruta);
}

async function abrirRuta(ruta) {
  const ext = path.extname(ruta).toLowerCase();
  try {
    if (ext === '.escrito') {
      const j = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      if (j.formato) formatoPagina = Object.assign({ tamano: 'carta', orientacion: 'vertical', margen: 96, color: '#ffffff', encabezado: '', pie: '', columnas: 1 }, j.formato);
      aplicarFormatoPagina();
      establecerHTML(j.html || '<p><br></p>');
    } else if (ext === '.docx') {
      const mammoth = require('mammoth');
      const r = await mammoth.convertToHtml({ path: ruta });
      establecerHTML(r.value || '<p><br></p>');
    } else if (ext === '.html' || ext === '.htm') {
      const doc = new DOMParser().parseFromString(fs.readFileSync(ruta, 'utf8'), 'text/html');
      establecerHTML(doc.body.innerHTML || '<p><br></p>');
    } else {
      const texto = fs.readFileSync(ruta, 'utf8');
      establecerHTML(texto.split(/\r?\n/).map(l => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;') || '<br>'}</p>`).join(''));
    }
    archivoActual = (ext === '.escrito') ? ruta : null; // otros formatos se guardan luego como .escrito
    limpiarModificado();
    if (ext !== '.escrito') $('estadoArchivo').textContent = path.basename(ruta) + ' (importado)';
    actualizarStats();
  } catch (err) {
    await ipcRenderer.invoke('mensaje', { type: 'error', title: 'Escribir', message: 'No se pudo abrir el archivo.', detail: String(err.message || err) });
  }
}

async function accionGuardar() {
  if (!archivoActual) return accionGuardarComo();
  escribirEscrito(archivoActual);
  limpiarModificado();
  return true;
}

async function accionGuardarComo() {
  const ruta = await ipcRenderer.invoke('dialogo-guardar', {
    title: 'Guardar documento',
    defaultPath: archivoActual || 'documento.escrito',
    filters: [
      { name: 'Documento de Escribir', extensions: ['escrito'] },
      { name: 'Página web (HTML)', extensions: ['html'] },
      { name: 'Documento de Word', extensions: ['doc'] },
      { name: 'Texto sin formato', extensions: ['txt'] }
    ]
  });
  if (!ruta) return false;
  const ext = path.extname(ruta).toLowerCase();
  if (ext === '.html') fs.writeFileSync(ruta, htmlCompleto(), 'utf8');
  else if (ext === '.doc') fs.writeFileSync(ruta, docWord(), 'utf8');
  else if (ext === '.txt') fs.writeFileSync(ruta, textoDocumento(), 'utf8');
  else { escribirEscrito(ruta); archivoActual = ruta; }
  limpiarModificado();
  return true;
}

function escribirEscrito(ruta) {
  fs.writeFileSync(ruta, JSON.stringify({
    tipo: 'oficinar-escrito', version: 2,
    formato: formatoPagina,
    html: contenidoHTML()
  }, null, 1), 'utf8');
}

function htmlCompleto() {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>${archivoActual ? path.basename(archivoActual, '.escrito') : 'Documento'}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:12pt;max-width:816px;margin:40px auto;padding:0 40px;line-height:1.15}
table{border-collapse:collapse}th,td{border:1px solid #9db3d0;padding:5px 9px}th{background:#e4ecf7}
blockquote{border-left:3px solid #2b6cb8;padding-left:12px;color:#444;font-style:italic}
pre{font-family:Consolas,monospace;background:#f4f6fa;border:1px solid #e0e5f0;border-radius:6px;padding:10px;white-space:pre-wrap}</style>
</head><body>${contenidoHTML()}</body></html>`;
}

function docWord() {
  // Documento HTML con cabecera compatible con Microsoft Word
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Documento</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>body{font-family:Calibri,Arial,sans-serif;font-size:12pt}table{border-collapse:collapse}th,td{border:1pt solid #9db3d0;padding:4pt 7pt}</style>
</head><body>${contenidoHTML()}</body></html>`;
}

async function exportarPDF() {
  deseleccionarImagen();
  const nombre = archivoActual ? path.basename(archivoActual, '.escrito') + '.pdf' : 'documento.pdf';
  const zoomPrevio = marco.style.zoom;
  marco.style.zoom = 1;
  const t = TAMANOS[formatoPagina.tamano] || TAMANOS.carta;
  const ruta = await ipcRenderer.invoke('imprimir-pdf', {
    nombre,
    tamano: t.pdf,
    horizontal: formatoPagina.orientacion === 'horizontal',
    margenes: { top: 0, bottom: 0, left: 0, right: 0 }
  });
  marco.style.zoom = zoomPrevio;
  if (ruta) {
    await ipcRenderer.invoke('mensaje', { type: 'info', title: 'Escribir', message: 'PDF exportado correctamente.', detail: ruta });
  }
}

// ---------- Menú ----------
ipcRenderer.on('menu', async (_e, accion) => {
  switch (accion) {
    case 'nuevo': accionNuevo(); break;
    case 'abrir': accionAbrir(); break;
    case 'guardar': accionGuardar(); break;
    case 'guardarComo': accionGuardarComo(); break;
    case 'guardarYSalir': { const ok = await accionGuardar(); if (ok) ipcRenderer.send('salir-forzado'); break; }
    case 'exportarPDF': exportarPDF(); break;
    case 'exportarDoc': {
      const ruta = await ipcRenderer.invoke('dialogo-guardar', {
        title: 'Exportar a Word', defaultPath: 'documento.doc',
        filters: [{ name: 'Documento de Word', extensions: ['doc'] }]
      });
      if (ruta) fs.writeFileSync(ruta, docWord(), 'utf8');
      break;
    }
    case 'imprimir': deseleccionarImagen(); ipcRenderer.invoke('imprimir'); break;
    case 'deshacer': exec('undo'); break;
    case 'rehacer': exec('redo'); break;
    case 'cortar': exec('cut'); break;
    case 'copiar': exec('copy'); break;
    case 'pegar': pegarPortapapeles(); break;
    case 'buscar': abrirDialogo('dialogoBuscar'); break;
    case 'reemplazar': abrirDialogo('dialogoBuscar'); break;
    case 'seleccionarTodo': {
      const s = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(marco);
      s.removeAllRanges(); s.addRange(r);
      break;
    }
    case 'insertarImagen': insertarImagen(); break;
    case 'insertarTabla': abrirDialogo('dialogoTabla'); break;
    case 'insertarEnlace': abrirEnlace(); break;
    case 'insertarLinea': insertarHTML('<hr>'); break;
    case 'saltoPagina': insertarHTML('<hr class="salto-pagina"><p><br></p>'); break;
    case 'insertarFecha': insertarHTML(new Date().toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' })); break;
    case 'insertarSimbolo': abrirDialogo('dialogoSimbolo'); break;
    case 'negrita': exec('bold'); break;
    case 'cursiva': exec('italic'); break;
    case 'subrayado': exec('underline'); break;
    case 'sangriaMas': exec('indent'); break;
    case 'sangriaMenos': exec('outdent'); break;
    case 'borrarFormato': exec('removeFormat'); break;
    case 'disenoPagina': abrirDisenoPagina(); break;
  }
});

// Atajos locales estilo Word en español
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); exec('bold'); }
  else if (k === 'k') { e.preventDefault(); exec('italic'); }
  else if (k === 's') { e.preventDefault(); exec('underline'); }
});

// ---------- Markdown ligero -> HTML (para respuestas de la IA) ----------
function markdownAHTML(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const linea = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<i>$2</i>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
  const lineas = md.replace(/\r/g, '').split('\n');
  let html = '', enUL = false, enOL = false, enPre = false;
  const cerrarListas = () => { if (enUL) { html += '</ul>'; enUL = false; } if (enOL) { html += '</ol>'; enOL = false; } };
  for (const l of lineas) {
    if (/^```/.test(l)) { cerrarListas(); html += enPre ? '</pre>' : '<pre>'; enPre = !enPre; continue; }
    if (enPre) { html += esc(l) + '\n'; continue; }
    const h = /^(#{1,4})\s+(.*)/.exec(l);
    if (h) { cerrarListas(); html += `<h${h[1].length}>${linea(h[2])}</h${h[1].length}>`; continue; }
    if (/^\s*[-*]\s+/.test(l)) { if (!enUL) { cerrarListas(); html += '<ul>'; enUL = true; } html += `<li>${linea(l.replace(/^\s*[-*]\s+/, ''))}</li>`; continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { if (!enOL) { cerrarListas(); html += '<ol>'; enOL = true; } html += `<li>${linea(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`; continue; }
    cerrarListas();
    if (!l.trim()) continue;
    html += `<p>${linea(l)}</p>`;
  }
  cerrarListas();
  if (enPre) html += '</pre>';
  return html || '<p><br></p>';
}

// ---------- Integración con el Asistente IA ----------
window.IA_APP = {
  nombre: 'Escribir (procesador de texto)',
  etiquetaInsertar: 'Insertar en el documento',
  instrucciones: 'El documento es un texto con formato. Puedes usar Markdown sencillo (títulos #, negrita **, listas -) y se convertirá a formato del documento.',
  obtenerContexto() { return textoDocumento(); },
  insertar(texto) {
    insertarHTML(markdownAHTML(texto));
    marcarModificado();
    actualizarStats();
  },
  acciones: {
    reemplazar_documento: {
      descripcion: 'Reemplaza TODO el contenido del documento. Parámetros: {"contenido": "..."} (Markdown sencillo)',
      fn: (p) => {
        establecerHTML(markdownAHTML(String(p.contenido ?? '')));
        marcarModificado(); actualizarStats();
        return 'Reemplacé el contenido del documento';
      }
    },
    guardar_documento: {
      descripcion: 'Guarda el documento actual (pide ubicación si es nuevo). Sin parámetros.',
      fn: () => { accionGuardar(); return 'Guardando el documento'; }
    },
    formato_pagina: {
      descripcion: 'Cambia el diseño de la hoja. Parámetros: {"tamano": "carta|a4|oficio", "orientacion": "vertical|horizontal", "margen": 96, "color": "#ffffff"} (todos opcionales)',
      fn: (p) => {
        formatoPagina = Object.assign({}, formatoPagina, p);
        aplicarFormatoPagina(); marcarModificado();
        return 'Formato de la hoja actualizado';
      }
    }
  }
};

// ---------- Inicio ----------
aplicarFormatoPagina();
actualizarTitulo();
actualizarStats();
paginasDoc()[0].focus();
