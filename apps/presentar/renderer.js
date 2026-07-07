// ===== Presentar - editor de presentaciones de la suite Oficinar =====
const { ipcRenderer, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

const $ = (id) => document.getElementById(id);
const lienzo = $('lienzo');
let ANCHO = 960, ALTO = 540;

// ---------- Temas ----------
const TEMAS = {
  claro:     { fondo: '#ffffff', texto: '#1d2433' },
  oscuro:    { fondo: 'linear-gradient(135deg, #1c2030, #262b40)', texto: '#f2f4fa' },
  degradado: { fondo: 'linear-gradient(135deg, #dceeff, #b8d4f5)', texto: '#15335c' },
  atardecer: { fondo: 'linear-gradient(135deg, #ffe3c4, #ffb98a, #ff9d9d)', texto: '#5c2a10' },
  bosque:    { fondo: 'linear-gradient(135deg, #e2f3e5, #bfe3c8)', texto: '#1c4527' },
  cristal:   { fondo: 'linear-gradient(135deg, #eef1f7, #e3ebfa, #f0e9f7)', texto: '#253052' }
};

// ---------- Estado ----------
let pres = presentacionNueva();
let diapoActual = 0;
let objSel = null;          // índice del objeto seleccionado en la diapositiva actual
let selMultiple = new Set(); // selección múltiple (índices) para alinear/distribuir/agrupar
let archivoActual = null;
let modificado = false;
let pilaDeshacer = [], pilaRehacer = [];
let portapapelesObj = null;
let enPresentacion = false;
let presIndice = 0;

function presentacionNueva() {
  return {
    tipo: 'oficinar-presentacion', version: 1,
    tema: 'claro', transicion: 'fundido', relacion: '16:9',
    diapositivas: [diapoNueva('titulo')]
  };
}
// Plantillas de diapositiva (layouts)
function diapoNueva(plantilla) {
  const d = { fondo: null, objetos: [], notas: '' };
  if (plantilla === 'titulo' || plantilla === true) {
    d.objetos.push({ tipo: 'texto', x: 80, y: 170, w: 800, h: 110, html: 'Haz clic para agregar un título', tam: 44, negrita: true, alinear: 'center' });
    d.objetos.push({ tipo: 'texto', x: 160, y: 300, w: 640, h: 60, html: 'Subtítulo', tam: 22, alinear: 'center' });
  } else if (plantilla === 'tituloContenido') {
    d.objetos.push({ tipo: 'texto', x: 60, y: 40, w: 840, h: 80, html: 'Título', tam: 34, negrita: true });
    d.objetos.push({ tipo: 'texto', x: 60, y: 140, w: 840, h: 360, html: '<ul><li>Punto uno</li><li>Punto dos</li></ul>', tam: 22, valinear: 'top' });
  } else if (plantilla === 'dosContenidos') {
    d.objetos.push({ tipo: 'texto', x: 60, y: 40, w: 840, h: 70, html: 'Título', tam: 32, negrita: true });
    d.objetos.push({ tipo: 'texto', x: 60, y: 130, w: 400, h: 370, html: '<ul><li>Columna izquierda</li></ul>', tam: 20, valinear: 'top' });
    d.objetos.push({ tipo: 'texto', x: 500, y: 130, w: 400, h: 370, html: '<ul><li>Columna derecha</li></ul>', tam: 20, valinear: 'top' });
  } else if (plantilla === 'seccion') {
    d.fondo = 'linear-gradient(135deg, #2b3350, #3a4570)';
    d.objetos.push({ tipo: 'texto', x: 80, y: 220, w: 800, h: 100, html: 'Título de la sección', tam: 40, negrita: true, alinear: 'center', color: '#ffffff' });
  }
  // 'blanco' u otros: sin objetos
  return d;
}
const diapo = () => pres.diapositivas[diapoActual];

// ---------- Modificación / título ----------
function marcarModificado() {
  if (!modificado) { modificado = true; ipcRenderer.send('set-dirty', true); }
  actualizarTitulo();
}
function limpiarModificado() { modificado = false; ipcRenderer.send('set-dirty', false); actualizarTitulo(); }
function actualizarTitulo() {
  const nombre = archivoActual ? path.basename(archivoActual) : 'Presentación nueva';
  $('estadoArchivo').textContent = nombre;
  $('estadoDiapo').textContent = `Diapositiva ${diapoActual + 1} de ${pres.diapositivas.length}`;
  ipcRenderer.send('set-title', `${modificado ? '● ' : ''}${nombre} - Presentar`);
}

// ---------- Deshacer / rehacer ----------
function snapshot() {
  pilaDeshacer.push(JSON.stringify(pres));
  if (pilaDeshacer.length > 100) pilaDeshacer.shift();
  pilaRehacer = [];
}
function deshacer() {
  if (!pilaDeshacer.length) return;
  pilaRehacer.push(JSON.stringify(pres));
  pres = JSON.parse(pilaDeshacer.pop());
  diapoActual = Math.min(diapoActual, pres.diapositivas.length - 1);
  objSel = null; renderTodo(); marcarModificado();
}
function rehacer() {
  if (!pilaRehacer.length) return;
  pilaDeshacer.push(JSON.stringify(pres));
  pres = JSON.parse(pilaRehacer.pop());
  diapoActual = Math.min(diapoActual, pres.diapositivas.length - 1);
  objSel = null; renderTodo(); marcarModificado();
}

// ---------- Render de una diapositiva (reutilizable) ----------
const FORMAS_SVG = ['triangulo', 'flecha', 'linea', 'estrella', 'rombo', 'pentagono', 'hexagono', 'globo'];

function svgForma(o) {
  const relleno = o.relleno || '#ef8f3c';
  const borde = o.borde || '#c05621';
  const svgIni = `<svg viewBox="0 0 100 100" preserveAspectRatio="none">`;
  const pol = (pts) => `${svgIni}<polygon points="${pts}" fill="${relleno}" stroke="${borde}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  switch (o.forma) {
    case 'triangulo': return pol('50,4 96,96 4,96');
    case 'flecha': return pol('4,38 62,38 62,18 96,50 62,82 62,62 4,62');
    case 'linea': return `${svgIni}<line x1="0" y1="50" x2="100" y2="50" stroke="${borde}" stroke-width="4" vector-effect="non-scaling-stroke"/></svg>`;
    case 'estrella': return pol('50,2 61,36 98,36 68,58 79,94 50,72 21,94 32,58 2,36 39,36');
    case 'rombo': return pol('50,3 97,50 50,97 3,50');
    case 'pentagono': return pol('50,3 97,38 79,95 21,95 3,38');
    case 'hexagono': return pol('27,6 73,6 97,50 73,94 27,94 3,50');
    case 'globo': return `${svgIni}<path d="M6,10 h88 a6,6 0 0 1 6,6 v46 a6,6 0 0 1 -6,6 H40 L18,92 L24,68 H6 a6,6 0 0 1 -6,-6 V16 a6,6 0 0 1 6,-6 Z" fill="${relleno}" stroke="${borde}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
    default: return '';
  }
}

function renderDiapositiva(d, cont, editable) {
  const tema = TEMAS[pres.tema] || TEMAS.claro;
  cont.style.background = d.fondo || tema.fondo;
  cont.innerHTML = '';
  d.objetos.forEach((o, i) => {
    const div = document.createElement('div');
    div.className = 'objeto ' + o.tipo + (o.forma ? ' forma' : '');
    div.dataset.indice = i;
    div.style.left = o.x + 'px'; div.style.top = o.y + 'px';
    div.style.width = o.w + 'px'; div.style.height = o.h + 'px';
    div.style.zIndex = i + 1;
    // Rotación, opacidad y sombra
    if (o.rot) div.style.transform = `rotate(${o.rot}deg)`;
    if (o.opacidad !== undefined && o.opacidad !== 1) div.style.opacity = o.opacidad;
    if (o.sombra) div.style.filter = 'drop-shadow(3px 4px 6px rgba(0,0,0,.4))';

    if (o.tipo === 'imagen') {
      const img = document.createElement('img');
      img.src = o.src;
      if (o.recorte) img.style.objectFit = 'cover';
      if (o.filtros) img.style.filter = o.filtros;
      div.appendChild(img);
    } else if (o.tipo === 'video') {
      const vid = document.createElement('video');
      vid.src = o.src; vid.controls = true; vid.style.width = '100%'; vid.style.height = '100%';
      if (o.bucle) vid.loop = true;
      div.appendChild(vid);
    } else if (o.tipo === 'audio') {
      div.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:28px">🔊</div>';
      const au = document.createElement('audio');
      au.src = o.src; au.controls = true; au.style.width = '100%'; au.style.position = 'absolute'; au.style.bottom = '0'; au.style.left = '0';
      if (o.bucle) au.loop = true;
      div.appendChild(au);
    } else if (o.tipo === 'tabla') {
      div.appendChild(construirTablaObjeto(o));
    } else if (o.tipo === 'forma' && FORMAS_SVG.includes(o.forma)) {
      div.innerHTML = svgForma(o);
      if (o.forma !== 'linea') {
        const c = document.createElement('div');
        c.className = 'contenido';
        c.style.position = 'absolute'; c.style.inset = '0';
        c.innerHTML = o.html || '';
        aplicarEstiloTexto(c, o, tema);
        div.appendChild(c);
      }
    } else {
      const c = document.createElement('div');
      c.className = 'contenido';
      c.innerHTML = o.html || '';
      aplicarEstiloTexto(c, o, tema);
      if (o.tipo === 'forma') {
        div.style.background = o.degradado ? o.degradado : (o.relleno || '#ef8f3c');
        div.style.border = o.borde === 'transparent' ? 'none' : `2px solid ${o.borde || '#c05621'}`;
        if (o.forma === 'elipse') div.style.borderRadius = '50%';
        else if (o.forma === 'rectred') div.style.borderRadius = '18px';
      } else if (o.tipo === 'texto') {
        // Los cuadros de texto también admiten relleno y borde
        if (o.relleno) { div.style.background = o.relleno; div.style.borderRadius = '8px'; }
        if (o.borde) { div.style.border = `2px solid ${o.borde}`; div.style.borderRadius = '8px'; }
      }
      div.appendChild(c);
    }
    cont.appendChild(div);
    if (editable && objSel === i) decorarSeleccion(div);
  });
}

function aplicarEstiloTexto(c, o, tema) {
  c.style.fontSize = (o.tam || 18) + 'px';
  c.style.fontFamily = o.fuente || 'Segoe UI';
  c.style.fontWeight = o.negrita ? '700' : '400';
  c.style.fontStyle = o.cursiva ? 'italic' : 'normal';
  c.style.textDecoration = o.subrayado ? 'underline' : 'none';
  c.style.textAlign = o.alinear || 'left';
  c.style.color = o.color || tema.texto;
  if (o.interlineado) c.style.lineHeight = o.interlineado;
  if (o.tracking) c.style.letterSpacing = o.tracking + 'px';
  // Alineación vertical dentro de la caja
  const va = o.valinear || (o.tipo === 'forma' ? 'middle' : 'top');
  c.style.display = 'flex'; c.style.flexDirection = 'column';
  c.style.justifyContent = va === 'top' ? 'flex-start' : va === 'bottom' ? 'flex-end' : 'center';
  if (o.tipo === 'forma') {
    c.style.alignItems = o.alinear === 'left' ? 'flex-start' : o.alinear === 'right' ? 'flex-end' : 'center';
  }
}

// Construye una tabla editable como objeto de diapositiva
function construirTablaObjeto(o) {
  const t = document.createElement('table');
  t.className = 'tabla-diapo';
  (o.celdas || []).forEach(fila => {
    const tr = document.createElement('tr');
    fila.forEach(txt => {
      const td = document.createElement('td');
      td.textContent = txt;
      tr.appendChild(td);
    });
    t.appendChild(tr);
  });
  return t;
}

function decorarSeleccion(div) {
  div.classList.add('seleccionado');
  ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(p => {
    const a = document.createElement('div');
    a.className = 'asa ' + p;
    a.dataset.asa = p;
    div.appendChild(a);
  });
}

// ---------- Render completo ----------
function renderTodo() {
  aplicarRelacion();
  renderDiapositiva(diapo(), lienzo, true);
  asegurarGuias();
  renderSeleccionMultiple();
  renderMiniaturas();
  actualizarTitulo();
  sincronizarControles();
  const na = $('notasOrador');
  if (na && document.activeElement !== na) na.value = diapo().notas || '';
}

function aplicarRelacion() {
  const r = pres.relacion || '16:9';
  ANCHO = 960;
  ALTO = r === '4:3' ? 720 : 540;
  lienzo.style.width = ANCHO + 'px';
  lienzo.style.height = ALTO + 'px';
}

function renderSeleccionMultiple() {
  lienzo.querySelectorAll('.objeto.multi-sel').forEach(e => e.classList.remove('multi-sel'));
  if (selMultiple.size > 1) {
    selMultiple.forEach(i => {
      const div = lienzo.querySelector(`.objeto[data-indice="${i}"]`);
      if (div) div.classList.add('multi-sel');
    });
  }
}

function renderMiniaturas() {
  const panel = $('panelMiniaturas');
  panel.innerHTML = '';
  pres.diapositivas.forEach((d, i) => {
    const m = document.createElement('div');
    m.className = 'miniatura' + (i === diapoActual ? ' activa' : '');
    m.draggable = true;
    m.dataset.indice = i;
    const num = document.createElement('span');
    num.className = 'mini-num'; num.textContent = i + 1;
    const marco = document.createElement('div');
    marco.className = 'mini-marco';
    const mini = document.createElement('div');
    mini.className = 'mini-lienzo';
    mini.style.width = ANCHO + 'px'; mini.style.height = ALTO + 'px';
    renderDiapositiva(d, mini, false);
    marco.appendChild(mini);
    m.appendChild(num); m.appendChild(marco);
    m.addEventListener('click', () => { guardarTextoActivo(); diapoActual = i; objSel = null; renderTodo(); });
    // Reordenar arrastrando
    m.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(i)));
    m.addEventListener('dragover', (e) => e.preventDefault());
    m.addEventListener('drop', (e) => {
      e.preventDefault();
      const desde = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const hasta = i;
      if (isNaN(desde) || desde === hasta) return;
      snapshot();
      const [mov] = pres.diapositivas.splice(desde, 1);
      pres.diapositivas.splice(hasta, 0, mov);
      diapoActual = hasta;
      renderTodo(); marcarModificado();
    });
    panel.appendChild(m);
  });
}

function sincronizarControles() {
  $('selTema').value = pres.tema;
  $('selTransicion').value = pres.transicion;
  if ($('selRelacion')) $('selRelacion').value = pres.relacion || '16:9';
  const o = objetoSel();
  if (o && $('rangoOpacidad')) $('rangoOpacidad').value = Math.round((o.opacidad !== undefined ? o.opacidad : 1) * 100);
  if (o && (o.tipo === 'texto' || o.tipo === 'forma')) {
    if (o.tam) $('selTamano').value = String(o.tam);
    if (o.fuente) $('selFuente').value = o.fuente;
    $('btnNegrita').classList.toggle('activo', !!o.negrita);
    $('btnCursiva').classList.toggle('activo', !!o.cursiva);
    $('btnSubrayado').classList.toggle('activo', !!o.subrayado);
  } else {
    ['btnNegrita', 'btnCursiva', 'btnSubrayado'].forEach(id => $(id).classList.remove('activo'));
  }
  $('selAnimacion').value = (o && o.anim) || 'ninguna';
}

const objetoSel = () => (objSel !== null && diapo().objetos[objSel]) ? diapo().objetos[objSel] : null;

// ---------- Guías de alineación (centro de la diapositiva) ----------
function asegurarGuias() {
  if (!document.getElementById('guiaV')) {
    const v = document.createElement('div'); v.id = 'guiaV'; v.className = 'guia-lienzo';
    const h = document.createElement('div'); h.id = 'guiaH'; h.className = 'guia-lienzo';
    lienzo.appendChild(v); lienzo.appendChild(h);
  } else {
    lienzo.appendChild(document.getElementById('guiaV'));
    lienzo.appendChild(document.getElementById('guiaH'));
  }
}
function mostrarGuia(id, visible) {
  const g = document.getElementById(id);
  if (g) g.style.display = visible ? 'block' : 'none';
}

// ---------- Escala del lienzo ----------
function ajustarEscala() {
  const area = $('areaLienzo');
  const esc = Math.min((area.clientWidth - 60) / ANCHO, (area.clientHeight - 50) / ALTO, 1.6);
  lienzo.style.transform = `scale(${Math.max(esc, 0.2)})`;
  lienzo._escala = Math.max(esc, 0.2);
  $('lienzoContenedor').style.width = (ANCHO * lienzo._escala) + 'px';
  $('lienzoContenedor').style.height = (ALTO * lienzo._escala) + 'px';
  lienzo.style.transformOrigin = 'top left';
}
new ResizeObserver(ajustarEscala).observe($('areaLienzo'));

// ---------- Interacción con objetos ----------
let arrastre = null; // { tipo:'mover'|'redim', asa, x0, y0, ox, oy, ow, oh }

lienzo.addEventListener('mousedown', (e) => {
  const asa = e.target.closest('.asa');
  const objDiv = e.target.closest('.objeto');
  if (asa && objDiv) {
    const o = objetoSel();
    if (!o) return;
    arrastre = { tipo: 'redim', asa: asa.dataset.asa, x0: e.clientX, y0: e.clientY, ox: o.x, oy: o.y, ow: o.w, oh: o.h, snap: false };
    e.preventDefault();
    return;
  }
  if (objDiv) {
    const i = parseInt(objDiv.dataset.indice, 10);
    // Shift/Ctrl + clic: alternar selección múltiple
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (objSel !== null && objSel !== i && selMultiple.size === 0) selMultiple.add(objSel);
      if (selMultiple.has(i)) selMultiple.delete(i); else selMultiple.add(i);
      objSel = i;
      renderTodo();
      return;
    }
    // Clic normal: si el objeto pertenece a un grupo, seleccionar todo el grupo
    const obj = diapo().objetos[i];
    if (obj && obj.grupo) {
      selMultiple = new Set(diapo().objetos.map((o, k) => o.grupo === obj.grupo ? k : -1).filter(k => k >= 0));
    } else if (!selMultiple.has(i)) {
      selMultiple.clear();
    }
    if (objSel !== i) { guardarTextoActivo(); objSel = i; renderTodo(); }
    const o = objetoSel();
    // Si se está editando el texto, no iniciar arrastre
    if (document.activeElement && document.activeElement.isContentEditable) return;
    // Arrastre en grupo/selección múltiple: guardar posiciones base
    const grupoIdx = selMultiple.size > 1 ? [...selMultiple] : [i];
    arrastre = { tipo: 'mover', x0: e.clientX, y0: e.clientY, ox: o.x, oy: o.y, snap: false,
      grupo: grupoIdx.map(k => ({ k, x: diapo().objetos[k].x, y: diapo().objetos[k].y })) };
    e.preventDefault();
  } else {
    guardarTextoActivo();
    objSel = null; selMultiple.clear(); renderTodo();
  }
});

document.addEventListener('mousemove', (e) => {
  if (!arrastre) return;
  const esc = lienzo._escala || 1;
  const dx = (e.clientX - arrastre.x0) / esc;
  const dy = (e.clientY - arrastre.y0) / esc;
  const o = objetoSel();
  if (!o) return;
  if (!arrastre.snap && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) { snapshot(); arrastre.snap = true; }
  if (arrastre.tipo === 'mover') {
    // Mover todos los objetos del grupo/selección
    if (arrastre.grupo && arrastre.grupo.length > 1) {
      arrastre.grupo.forEach(g => {
        const ob = diapo().objetos[g.k];
        if (ob) { ob.x = Math.round(g.x + dx); ob.y = Math.round(g.y + dy); }
      });
      const div = lienzo.querySelector(`.objeto[data-indice="${objSel}"]`);
      renderTodo();
      return;
    }
    o.x = Math.round(arrastre.ox + dx);
    o.y = Math.round(arrastre.oy + dy);
    // Ajuste magnético al centro de la diapositiva, con guías visuales
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const encajaV = Math.abs(cx - ANCHO / 2) < 7;
    const encajaH = Math.abs(cy - ALTO / 2) < 7;
    if (encajaV) o.x = Math.round(ANCHO / 2 - o.w / 2);
    if (encajaH) o.y = Math.round(ALTO / 2 - o.h / 2);
    mostrarGuia('guiaV', encajaV);
    mostrarGuia('guiaH', encajaH);
  } else {
    const a = arrastre.asa;
    if (a.includes('e')) o.w = Math.max(20, Math.round(arrastre.ow + dx));
    if (a.includes('s')) o.h = Math.max(20, Math.round(arrastre.oh + dy));
    if (a.includes('w')) { o.w = Math.max(20, Math.round(arrastre.ow - dx)); o.x = Math.round(arrastre.ox + (arrastre.ow - o.w)); }
    if (a.includes('n')) { o.h = Math.max(20, Math.round(arrastre.oh - dy)); o.y = Math.round(arrastre.oy + (arrastre.oh - o.h)); }
  }
  const div = lienzo.querySelector(`.objeto[data-indice="${objSel}"]`);
  if (div) {
    div.style.left = o.x + 'px'; div.style.top = o.y + 'px';
    div.style.width = o.w + 'px'; div.style.height = o.h + 'px';
  }
});

document.addEventListener('mouseup', () => {
  if (arrastre && arrastre.snap) { renderMiniaturas(); marcarModificado(); }
  arrastre = null;
  mostrarGuia('guiaV', false);
  mostrarGuia('guiaH', false);
});

// Doble clic: editar texto
lienzo.addEventListener('dblclick', (e) => {
  const objDiv = e.target.closest('.objeto');
  if (!objDiv) return;
  const o = pres.diapositivas[diapoActual].objetos[parseInt(objDiv.dataset.indice, 10)];
  if (o.tipo === 'imagen' || o.forma === 'linea') return;
  const c = objDiv.querySelector('.contenido');
  if (!c) return;
  snapshot();
  c.contentEditable = 'true';
  c.focus();
  document.execCommand('selectAll');
});

function guardarTextoActivo() {
  const c = lienzo.querySelector('.contenido[contenteditable="true"]');
  if (!c) return;
  const objDiv = c.closest('.objeto');
  const o = diapo().objetos[parseInt(objDiv.dataset.indice, 10)];
  if (o && o.html !== c.innerHTML) { o.html = c.innerHTML; marcarModificado(); renderMiniaturas(); }
  c.contentEditable = 'false';
}
lienzo.addEventListener('focusout', (e) => {
  if (e.target.classList && e.target.classList.contains('contenido')) guardarTextoActivo();
});

// Entrar en modo de edición de texto del objeto seleccionado
function editarObjetoSel(seleccionarTodo) {
  const o = objetoSel();
  if (!o || o.tipo === 'imagen' || o.forma === 'linea') return false;
  const div = lienzo.querySelector(`.objeto[data-indice="${objSel}"]`);
  const c = div && div.querySelector('.contenido');
  if (!c) return false;
  snapshot();
  c.contentEditable = 'true';
  c.focus();
  if (seleccionarTodo) document.execCommand('selectAll');
  return true;
}

// Teclas: eliminar, mover con flechas, Enter = nueva diapositiva, escribir = editar texto
document.addEventListener('keydown', (e) => {
  if (enPresentacion) return;
  if (document.activeElement && (document.activeElement.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) return;
  const o = objetoSel();
  if (!o) {
    // Sin objeto seleccionado: Enter crea una diapositiva nueva (como PowerPoint en el panel)
    if (e.key === 'Enter') { e.preventDefault(); nuevaDiapositiva(); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); eliminarObjeto(); }
  else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); editarObjetoSel(true); }
  else if (/^Arrow/.test(e.key)) {
    e.preventDefault(); snapshot();
    const paso = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') o.x -= paso;
    if (e.key === 'ArrowRight') o.x += paso;
    if (e.key === 'ArrowUp') o.y -= paso;
    if (e.key === 'ArrowDown') o.y += paso;
    renderTodo(); marcarModificado();
  }
  else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // Empezar a escribir directamente sobre el objeto seleccionado (reemplaza el texto)
    editarObjetoSel(true);
  }
});

// ---------- Alta de objetos ----------
function agregarObjeto(o) {
  snapshot();
  diapo().objetos.push(o);
  objSel = diapo().objetos.length - 1;
  renderTodo(); marcarModificado();
}
function nuevoTexto() {
  agregarObjeto({ tipo: 'texto', x: 280, y: 220, w: 400, h: 80, html: 'Texto', tam: 24 });
}
function nuevaForma(forma) {
  const base = { tipo: 'forma', forma, x: 360, y: 190, w: 240, h: 160, html: '', tam: 20, relleno: $('colorRelleno').value, borde: $('colorBorde').value, alinear: 'center' };
  if (forma === 'linea') { base.h = 24; base.y = 260; }
  if (['estrella', 'rombo', 'pentagono', 'hexagono'].includes(forma)) { base.w = 200; base.h = 200; base.x = 380; base.y = 170; }
  if (forma === 'globo') { base.w = 280; base.h = 200; base.x = 340; base.y = 170; }
  agregarObjeto(base);
}
async function nuevaImagen() {
  const ruta = await ipcRenderer.invoke('dialogo-abrir', {
    title: 'Insertar imagen',
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }],
    properties: ['openFile']
  });
  if (!ruta) return;
  const ext = path.extname(ruta).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'svg+xml' : (ext === 'jpg' ? 'jpeg' : ext);
  const src = `data:image/${mime};base64,${fs.readFileSync(ruta).toString('base64')}`;
  const img = new Image();
  img.onload = () => {
    const esc = Math.min(500 / img.width, 380 / img.height, 1);
    agregarObjeto({ tipo: 'imagen', src, x: 300, y: 120, w: Math.round(img.width * esc), h: Math.round(img.height * esc) });
  };
  img.src = src;
}
function eliminarObjeto() {
  if (objSel === null) return;
  snapshot();
  diapo().objetos.splice(objSel, 1);
  objSel = null;
  renderTodo(); marcarModificado();
}

// ---------- Diapositivas ----------
function nuevaDiapositiva() {
  guardarTextoActivo(); snapshot();
  pres.diapositivas.splice(diapoActual + 1, 0, diapoNueva(false));
  diapoActual++;
  objSel = null; renderTodo(); marcarModificado();
}
function duplicarDiapositiva() {
  guardarTextoActivo(); snapshot();
  pres.diapositivas.splice(diapoActual + 1, 0, JSON.parse(JSON.stringify(diapo())));
  diapoActual++;
  renderTodo(); marcarModificado();
}
function eliminarDiapositiva() {
  snapshot();
  pres.diapositivas.splice(diapoActual, 1);
  if (!pres.diapositivas.length) pres.diapositivas.push(diapoNueva(true));
  diapoActual = Math.min(diapoActual, pres.diapositivas.length - 1);
  objSel = null; renderTodo(); marcarModificado();
}

// ---------- Controles de la cinta ----------
poblarFuentesSistema($('selFuente'), 'Segoe UI');

function cambiarPropTexto(cambios) {
  const o = objetoSel();
  if (!o || o.tipo === 'imagen') return;
  snapshot();
  Object.assign(o, cambios);
  renderTodo(); marcarModificado();
}

$('btnDeshacer').addEventListener('click', deshacer);
$('btnRehacer').addEventListener('click', rehacer);
$('btnTexto').addEventListener('click', nuevoTexto);
$('btnImagen').addEventListener('click', nuevaImagen);
$('btnRect').addEventListener('click', () => nuevaForma('rect'));
$('btnRectRed').addEventListener('click', () => nuevaForma('rectred'));
$('btnElipse').addEventListener('click', () => nuevaForma('elipse'));
$('btnTriangulo').addEventListener('click', () => nuevaForma('triangulo'));
$('btnFlecha').addEventListener('click', () => nuevaForma('flecha'));
$('btnLinea').addEventListener('click', () => nuevaForma('linea'));
$('btnEstrella').addEventListener('click', () => nuevaForma('estrella'));
$('btnRombo').addEventListener('click', () => nuevaForma('rombo'));
$('btnPentagono').addEventListener('click', () => nuevaForma('pentagono'));
$('btnHexagono').addEventListener('click', () => nuevaForma('hexagono'));
$('btnGlobo').addEventListener('click', () => nuevaForma('globo'));
$('btnEliminarObj').addEventListener('click', eliminarObjeto);

// ---------- Nuevas formas / multimedia / tabla ----------
$('btnTabla').addEventListener('click', () => {
  const filas = 3, cols = 3;
  const celdas = Array.from({ length: filas }, () => Array.from({ length: cols }, () => ''));
  celdas[0] = ['Columna 1', 'Columna 2', 'Columna 3'];
  agregarObjeto({ tipo: 'tabla', x: 180, y: 160, w: 600, h: 220, celdas });
});
$('btnVideo').addEventListener('click', () => insertarMedia('video'));
$('btnAudio').addEventListener('click', () => insertarMedia('audio'));
async function insertarMedia(tipo) {
  const filtros = tipo === 'video'
    ? [{ name: 'Video', extensions: ['mp4', 'webm', 'ogg', 'mov', 'mkv'] }]
    : [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }];
  const ruta = await ipcRenderer.invoke('dialogo-abrir', { title: 'Insertar ' + tipo, filters: filtros, properties: ['openFile'] });
  if (!ruta) return;
  const ext = path.extname(ruta).slice(1).toLowerCase();
  const mime = tipo + '/' + (ext === 'mov' ? 'mp4' : ext === 'm4a' ? 'mp4' : ext);
  const src = `data:${mime};base64,${fs.readFileSync(ruta).toString('base64')}`;
  if (tipo === 'video') agregarObjeto({ tipo: 'video', src, x: 260, y: 120, w: 440, h: 300, bucle: false });
  else agregarObjeto({ tipo: 'audio', src, x: 380, y: 230, w: 200, h: 80, bucle: false });
}

// ---------- Rotación, opacidad, sombra, degradado ----------
$('btnRotIzq').addEventListener('click', () => rotarObjeto(-15));
$('btnRotDer').addEventListener('click', () => rotarObjeto(15));
function rotarObjeto(delta) {
  const o = objetoSel(); if (!o) return;
  snapshot(); o.rot = ((o.rot || 0) + delta) % 360; renderTodo(); marcarModificado();
}
$('rangoOpacidad').addEventListener('input', (e) => {
  const o = objetoSel(); if (!o) return;
  o.opacidad = parseInt(e.target.value, 10) / 100;
  const div = lienzo.querySelector(`.objeto[data-indice="${objSel}"]`);
  if (div) div.style.opacity = o.opacidad;
  marcarModificado();
});
$('btnSombra').addEventListener('click', () => {
  const o = objetoSel(); if (!o) return;
  snapshot(); o.sombra = !o.sombra; renderTodo(); marcarModificado();
});
$('colorDegradado').addEventListener('input', (e) => {
  const o = objetoSel(); if (!o) return;
  snapshot();
  o.degradado = `linear-gradient(135deg, ${o.relleno || '#ef8f3c'}, ${e.target.value})`;
  renderTodo(); marcarModificado();
});

// ---------- Relación de aspecto ----------
$('selRelacion').addEventListener('change', (e) => {
  snapshot(); pres.relacion = e.target.value; renderTodo(); ajustarEscala(); marcarModificado();
});

// ---------- Alinear (6 ejes) ----------
function objetosParaAlinear() {
  if (selMultiple.size > 1) return [...selMultiple];
  return objSel !== null ? [objSel] : [];
}
function alinear(eje) {
  const idxs = objetosParaAlinear();
  if (!idxs.length) return;
  snapshot();
  const objs = idxs.map(i => diapo().objetos[i]);
  const multi = idxs.length > 1;
  // Con varios objetos: alinear entre ellos; con uno: respecto al lienzo
  const minX = Math.min(...objs.map(o => o.x)), maxX = Math.max(...objs.map(o => o.x + o.w));
  const minY = Math.min(...objs.map(o => o.y)), maxY = Math.max(...objs.map(o => o.y + o.h));
  objs.forEach(o => {
    switch (eje) {
      case 'izq': o.x = multi ? minX : 0; break;
      case 'derecha': o.x = multi ? maxX - o.w : ANCHO - o.w; break;
      case 'centroH': o.x = Math.round((multi ? (minX + maxX) / 2 : ANCHO / 2) - o.w / 2); break;
      case 'sup': o.y = multi ? minY : 0; break;
      case 'inf': o.y = multi ? maxY - o.h : ALTO - o.h; break;
      case 'centroV': o.y = Math.round((multi ? (minY + maxY) / 2 : ALTO / 2) - o.h / 2); break;
    }
  });
  renderTodo(); marcarModificado();
}
$('btnAlinIzq').addEventListener('click', () => alinear('izq'));
$('btnAlinCH').addEventListener('click', () => alinear('centroH'));
$('btnAlinDer').addEventListener('click', () => alinear('derecha'));
$('btnAlinSup').addEventListener('click', () => alinear('sup'));
$('btnAlinCV').addEventListener('click', () => alinear('centroV'));
$('btnAlinInf').addEventListener('click', () => alinear('inf'));

// ---------- Distribuir ----------
function distribuir(horizontal) {
  const idxs = [...selMultiple];
  if (idxs.length < 3) { alert('Selecciona al menos 3 objetos (clic con Shift).'); return; }
  snapshot();
  const objs = idxs.map(i => diapo().objetos[i]).sort((a, b) => horizontal ? a.x - b.x : a.y - b.y);
  const ini = horizontal ? objs[0].x : objs[0].y;
  const fin = horizontal ? objs[objs.length - 1].x + objs[objs.length - 1].w : objs[objs.length - 1].y + objs[objs.length - 1].h;
  const totalObj = objs.reduce((s, o) => s + (horizontal ? o.w : o.h), 0);
  const hueco = (fin - ini - totalObj) / (objs.length - 1);
  let cursor = ini;
  objs.forEach(o => {
    if (horizontal) { o.x = Math.round(cursor); cursor += o.w + hueco; }
    else { o.y = Math.round(cursor); cursor += o.h + hueco; }
  });
  renderTodo(); marcarModificado();
}
$('btnDistH').addEventListener('click', () => distribuir(true));
$('btnDistV').addEventListener('click', () => distribuir(false));

// ---------- Agrupar / desagrupar ----------
$('btnAgrupar').addEventListener('click', agrupar);
$('btnDesagrupar').addEventListener('click', desagrupar);
function agrupar() {
  if (selMultiple.size < 2) return;
  snapshot();
  const id = 'g' + Date.now();
  selMultiple.forEach(i => { diapo().objetos[i].grupo = id; });
  marcarModificado(); renderTodo();
}
function desagrupar() {
  const o = objetoSel();
  const gid = o && o.grupo;
  if (!gid) return;
  snapshot();
  diapo().objetos.forEach(ob => { if (ob.grupo === gid) delete ob.grupo; });
  marcarModificado(); renderTodo();
}

// ---------- Animación del objeto seleccionado ----------
$('selAnimacion').addEventListener('change', (e) => {
  const o = objetoSel(); if (!o) return;
  snapshot();
  o.anim = e.target.value === 'ninguna' ? undefined : e.target.value;
  o.animTipo = $('selAnimTipo').value;
  marcarModificado();
});

// ---------- Notas del orador ----------
$('notasOrador').addEventListener('input', (e) => { diapo().notas = e.target.value; marcarModificado(); });

// ---------- Plantillas de diapositiva ----------
$('btnNuevaDiapo').addEventListener('click', () => menuPresentar('btnNuevaDiapo', [
  { label: '📄 En blanco', fn: () => nuevaDiapositivaPlantilla('blanco') },
  { label: '🅣 Título', fn: () => nuevaDiapositivaPlantilla('titulo') },
  { label: '🅣 Título y contenido', fn: () => nuevaDiapositivaPlantilla('tituloContenido') },
  { label: '⧉ Dos contenidos', fn: () => nuevaDiapositivaPlantilla('dosContenidos') },
  { label: '▭ Encabezado de sección', fn: () => nuevaDiapositivaPlantilla('seccion') }
]));
function nuevaDiapositivaPlantilla(plantilla) {
  guardarTextoActivo(); snapshot();
  pres.diapositivas.splice(diapoActual + 1, 0, diapoNueva(plantilla));
  diapoActual++; objSel = null; selMultiple.clear();
  renderTodo(); marcarModificado();
}

// ---------- Menú flotante de Presentar ----------
let menuPres = null;
function cerrarMenuPres() { if (menuPres) { menuPres.remove(); menuPres = null; } }
document.addEventListener('mousedown', (e) => { if (menuPres && !menuPres.contains(e.target)) cerrarMenuPres(); });
function menuPresentar(botonId, items) {
  cerrarMenuPres();
  const b = $(botonId).getBoundingClientRect();
  const m = document.createElement('div');
  m.className = 'menu-flotante-p';
  items.forEach(it => {
    if (it.sep) { const s = document.createElement('div'); s.className = 'mfp-sep'; m.appendChild(s); return; }
    const d = document.createElement('div'); d.className = 'mfp-item'; d.textContent = it.label;
    d.addEventListener('click', () => { cerrarMenuPres(); it.fn(); });
    m.appendChild(d);
  });
  document.body.appendChild(m);
  m.style.left = Math.min(b.left, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = (b.bottom + 2) + 'px';
  menuPres = m;
}

// ---------- Vista del moderador ----------
$('btnModerador').addEventListener('click', () => iniciarPresentacion(0, true));
$('modSalir').addEventListener('click', salirPresentacion);
$('modAnt').addEventListener('click', () => avanzar(-1));
$('modSig').addEventListener('click', () => avanzar(1));

// Listas dentro del texto en edición (mousedown para no perder el foco del contenteditable)
function aplicarLista(cmd) {
  let c = lienzo.querySelector('.contenido[contenteditable="true"]');
  if (!c && editarObjetoSel(true)) c = lienzo.querySelector('.contenido[contenteditable="true"]');
  if (c) document.execCommand(cmd);
}
$('btnListaVineta').addEventListener('mousedown', (e) => { e.preventDefault(); aplicarLista('insertUnorderedList'); });
$('btnListaNum').addEventListener('mousedown', (e) => { e.preventDefault(); aplicarLista('insertOrderedList'); });

// Autocorrección al escribir en los cuadros de texto
conectarAutocorreccion(lienzo, () => true);

// Si se está editando texto dentro del cuadro, el formato se aplica a la selección;
// si no, se aplica al cuadro completo. mousedown+preventDefault conserva el foco del texto.
function contenidoEnEdicion() { return lienzo.querySelector('.contenido[contenteditable="true"]'); }

function formatoTexto(cmdEdicion, cambiosObjeto) {
  const c = contenidoEnEdicion();
  if (c && cmdEdicion) { document.execCommand('styleWithCSS', false, true); document.execCommand(...cmdEdicion); }
  else { const o = objetoSel(); if (o) cambiarPropTexto(typeof cambiosObjeto === 'function' ? cambiosObjeto(o) : cambiosObjeto); }
}
function botonFormato(id, cmdEdicion, cambiosObjeto) {
  $(id).addEventListener('mousedown', (e) => { e.preventDefault(); formatoTexto(cmdEdicion, cambiosObjeto); });
}

$('selFuente').addEventListener('change', (e) => cambiarPropTexto({ fuente: e.target.value }));
$('selTamano').addEventListener('change', (e) => cambiarPropTexto({ tam: parseInt(e.target.value, 10) }));
botonFormato('btnNegrita', ['bold'], (o) => ({ negrita: !o.negrita }));
botonFormato('btnCursiva', ['italic'], (o) => ({ cursiva: !o.cursiva }));
botonFormato('btnSubrayado', ['underline'], (o) => ({ subrayado: !o.subrayado }));
botonFormato('alignIzq', ['justifyLeft'], { alinear: 'left' });
botonFormato('alignCentro', ['justifyCenter'], { alinear: 'center' });
botonFormato('alignDer', ['justifyRight'], { alinear: 'right' });

$('colorTexto').addEventListener('input', (e) => {
  $('iconoColorTexto').style.borderBottomColor = e.target.value;
  formatoTexto(['foreColor', false, e.target.value], { color: e.target.value });
});
$('colorRelleno').addEventListener('input', (e) => { $('iconoColorRelleno').style.borderBottomColor = e.target.value; cambiarPropTexto({ relleno: e.target.value }); });
$('colorBorde').addEventListener('input', (e) => { $('iconoColorBorde').style.borderBottomColor = e.target.value; cambiarPropTexto({ borde: e.target.value }); });
$('btnSinRelleno').addEventListener('click', () => {
  const o = objetoSel(); if (!o) return;
  if (o.tipo === 'forma') cambiarPropTexto({ relleno: 'transparent' });
  else cambiarPropTexto({ relleno: undefined, borde: undefined });
});
$('colorFondoDiapo').addEventListener('input', (e) => {
  $('iconoColorFondoD').style.borderBottomColor = e.target.value;
  snapshot(); diapo().fondo = e.target.value; renderTodo(); marcarModificado();
});

$('btnAlFrente').addEventListener('click', () => {
  const o = objetoSel(); if (!o) return;
  snapshot();
  diapo().objetos.splice(objSel, 1); diapo().objetos.push(o);
  objSel = diapo().objetos.length - 1;
  renderTodo(); marcarModificado();
});
$('btnAlFondo').addEventListener('click', () => {
  const o = objetoSel(); if (!o) return;
  snapshot();
  diapo().objetos.splice(objSel, 1); diapo().objetos.unshift(o);
  objSel = 0;
  renderTodo(); marcarModificado();
});

$('selTema').addEventListener('change', (e) => { snapshot(); pres.tema = e.target.value; renderTodo(); marcarModificado(); });
$('selTransicion').addEventListener('change', (e) => { pres.transicion = e.target.value; marcarModificado(); });

$('btnPresentar').addEventListener('click', () => iniciarPresentacion(0));
$('btnIA').addEventListener('click', () => window.IA.alternar());

// ---------- Copiar / pegar objetos ----------
function copiarObjeto(cortar) {
  const o = objetoSel();
  if (!o) return;
  portapapelesObj = JSON.parse(JSON.stringify(o));
  if (cortar) eliminarObjeto();
}
function pegarObjeto() {
  if (!portapapelesObj) return;
  const copia = JSON.parse(JSON.stringify(portapapelesObj));
  copia.x += 24; copia.y += 24;
  agregarObjeto(copia);
}

// ---------- Modo presentación ----------
let presPaso = 0; // objetos animados ya revelados en la diapositiva actual

function animadosDe(d) {
  const lista = [];
  d.objetos.forEach((o, i) => { if (o.anim && o.anim !== 'ninguna') lista.push(i); });
  return lista;
}

let modoModerador = false;
let relojInterval = null, relojSeg = 0;

function iniciarPresentacion(desde, moderador) {
  guardarTextoActivo();
  enPresentacion = true;
  modoModerador = !!moderador;
  presIndice = desde;
  presPaso = 0;
  $('modoPresentacion').classList.remove('oculto');
  document.documentElement.requestFullscreen().catch(() => {});
  ajustarLienzoTinta();
  if (modoModerador) {
    $('vistaModerador').classList.remove('oculto');
    relojSeg = 0;
    clearInterval(relojInterval);
    relojInterval = setInterval(() => {
      relojSeg++;
      const m = String(Math.floor(relojSeg / 60)).padStart(2, '0');
      const s = String(relojSeg % 60).padStart(2, '0');
      $('modReloj').textContent = `${m}:${s}`;
    }, 1000);
  }
  mostrarDiapoPresentacion(true);
}
function salirPresentacion() {
  enPresentacion = false;
  modoModerador = false;
  clearInterval(relojInterval);
  $('modoPresentacion').classList.add('oculto');
  $('vistaModerador').classList.add('oculto');
  limpiarTinta();
  fijarHerramientaPres(null);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function mostrarDiapoPresentacion(conTransicion) {
  const cont = $('presDiapo');
  cont.style.width = ANCHO + 'px'; cont.style.height = ALTO + 'px';
  const esc = Math.min(window.innerWidth / ANCHO, window.innerHeight / ALTO);
  cont.style.setProperty('--esc', esc);
  cont.style.transform = `scale(${esc})`;
  const selPrevio = objSel; objSel = null;
  const d = pres.diapositivas[presIndice];
  renderDiapositiva(d, cont, false);
  objSel = selPrevio;
  // Ocultar los objetos animados que todavía no se han revelado
  const anims = animadosDe(d);
  anims.forEach((idxObjeto, orden) => {
    const el = cont.querySelector(`.objeto[data-indice="${idxObjeto}"]`);
    if (el && orden >= presPaso) el.classList.add('anim-oculto');
  });
  $('presContador').textContent = `${presIndice + 1} / ${pres.diapositivas.length}`;
  cont.className = '';
  if (conTransicion && pres.transicion !== 'ninguna') {
    void cont.offsetWidth; // reiniciar animación
    cont.classList.add('trans-' + pres.transicion);
  }
  limpiarTinta();
  if (modoModerador) actualizarModerador();
}

// ---------- Vista del moderador ----------
function actualizarModerador() {
  const d = pres.diapositivas[presIndice];
  const sig = pres.diapositivas[presIndice + 1];
  const pintar = (cont, dia) => {
    cont.innerHTML = '';
    if (!dia) { cont.innerHTML = '<div style="color:#556;padding:20px;text-align:center">Fin</div>'; return; }
    const mini = document.createElement('div');
    const escala = cont.clientWidth / ANCHO || 0.3;
    mini.style.width = ANCHO + 'px'; mini.style.height = ALTO + 'px';
    mini.style.transform = `scale(${escala})`; mini.style.transformOrigin = 'top left';
    mini.style.position = 'relative';
    const selPrevio = objSel; objSel = null;
    renderDiapositiva(dia, mini, false);
    objSel = selPrevio;
    cont.appendChild(mini);
    cont.style.height = (ALTO * escala) + 'px';
  };
  pintar($('modActual'), d);
  pintar($('modSiguiente'), sig);
  $('modNotas').textContent = d.notas || '(Sin notas para esta diapositiva)';
  $('modContador').textContent = `${presIndice + 1} / ${pres.diapositivas.length}`;
}

function revelarSiguiente() {
  const d = pres.diapositivas[presIndice];
  const anims = animadosDe(d);
  if (presPaso >= anims.length) return false;
  const idxObjeto = anims[presPaso];
  const o = d.objetos[idxObjeto];
  const el = $('presDiapo').querySelector(`.objeto[data-indice="${idxObjeto}"]`);
  if (el) {
    el.classList.remove('anim-oculto');
    if (o.anim && o.anim !== 'aparecer') el.classList.add('anim-' + o.anim);
  }
  presPaso++;
  return true;
}

function avanzar(delta) {
  if (delta > 0 && revelarSiguiente()) return; // primero se revelan las animaciones pendientes
  const nuevo = presIndice + delta;
  if (nuevo < 0) return;
  if (nuevo >= pres.diapositivas.length) { salirPresentacion(); return; }
  presIndice = nuevo;
  // Al retroceder, la diapositiva se muestra con todo revelado
  presPaso = delta < 0 ? animadosDe(pres.diapositivas[presIndice]).length : 0;
  mostrarDiapoPresentacion(delta > 0);
}
$('presDiapo').addEventListener('click', () => { if (!herramientaPres) avanzar(1); });
document.addEventListener('keydown', (e) => {
  if (!enPresentacion) return;
  if (e.key === 'Escape') salirPresentacion();
  else if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); avanzar(1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); avanzar(-1); }
  else if (e.key === 'Home') { presIndice = 0; presPaso = 0; mostrarDiapoPresentacion(false); }
  else if (e.key === 'End') { presIndice = pres.diapositivas.length - 1; presPaso = animadosDe(pres.diapositivas[presIndice]).length; mostrarDiapoPresentacion(false); }
});
window.addEventListener('resize', () => { if (enPresentacion) { mostrarDiapoPresentacion(false); ajustarLienzoTinta(); } });

// ---------- Herramientas de proyección: puntero, tinta, resaltador ----------
let herramientaPres = null;
let tintaCtx = null, dibujandoTinta = false;
function ajustarLienzoTinta() {
  const c = $('presTinta');
  c.width = window.innerWidth; c.height = window.innerHeight;
  tintaCtx = c.getContext('2d');
}
function limpiarTinta() {
  if (!tintaCtx) ajustarLienzoTinta();
  tintaCtx.clearRect(0, 0, $('presTinta').width, $('presTinta').height);
}
function fijarHerramientaPres(h) {
  herramientaPres = (herramientaPres === h) ? null : h;
  $('presTinta').classList.toggle('activa', herramientaPres === 'tinta' || herramientaPres === 'resaltar');
  $('presPuntero').classList.toggle('oculto', herramientaPres !== 'puntero');
  document.querySelectorAll('#presHerramientas button[data-pres-h]').forEach(b =>
    b.classList.toggle('activo', b.dataset.presH === herramientaPres));
}
document.querySelectorAll('#presHerramientas button[data-pres-h]').forEach(b =>
  b.addEventListener('click', (e) => { e.stopPropagation(); fijarHerramientaPres(b.dataset.presH); }));
$('presLimpiar').addEventListener('click', (e) => { e.stopPropagation(); limpiarTinta(); });
$('presSalir').addEventListener('click', (e) => { e.stopPropagation(); salirPresentacion(); });

document.addEventListener('mousemove', (e) => {
  if (!enPresentacion || herramientaPres !== 'puntero') return;
  const p = $('presPuntero');
  p.style.left = e.clientX + 'px'; p.style.top = e.clientY + 'px';
});
$('presTinta').addEventListener('mousedown', (e) => {
  if (herramientaPres !== 'tinta' && herramientaPres !== 'resaltar') return;
  dibujandoTinta = true;
  tintaCtx.beginPath();
  tintaCtx.moveTo(e.clientX, e.clientY);
  tintaCtx.strokeStyle = herramientaPres === 'resaltar' ? 'rgba(255,235,0,.45)' : '#ff2d2d';
  tintaCtx.lineWidth = herramientaPres === 'resaltar' ? 18 : 3;
  tintaCtx.lineCap = 'round'; tintaCtx.lineJoin = 'round';
});
$('presTinta').addEventListener('mousemove', (e) => {
  if (!dibujandoTinta) return;
  tintaCtx.lineTo(e.clientX, e.clientY);
  tintaCtx.stroke();
});
document.addEventListener('mouseup', () => { dibujandoTinta = false; });

// ---------- Archivo ----------
async function confirmarPerdida() {
  if (!modificado) return true;
  const r = await ipcRenderer.invoke('mensaje', {
    type: 'question', buttons: ['Guardar', 'No guardar', 'Cancelar'], defaultId: 0, cancelId: 2,
    title: 'Presentar', message: '¿Desea guardar los cambios de la presentación actual?'
  });
  if (r === 2) return false;
  if (r === 0) return await accionGuardar();
  return true;
}
async function accionNuevo() {
  if (!await confirmarPerdida()) return;
  pres = presentacionNueva();
  diapoActual = 0; objSel = null; archivoActual = null;
  pilaDeshacer = []; pilaRehacer = [];
  limpiarModificado(); renderTodo();
}
async function accionAbrir() {
  if (!await confirmarPerdida()) return;
  const ruta = await ipcRenderer.invoke('dialogo-abrir', {
    title: 'Abrir presentación',
    filters: [
      { name: 'Presentaciones compatibles', extensions: ['presentacion', 'pptx'] },
      { name: 'Presentación de Presentar', extensions: ['presentacion'] },
      { name: 'Presentación de PowerPoint', extensions: ['pptx'] }
    ],
    properties: ['openFile']
  });
  if (!ruta) return;
  try {
    if (path.extname(ruta).toLowerCase() === '.pptx') {
      const importada = await importarPPTX(ruta);
      pres = importada; archivoActual = null;
    } else {
      const j = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      if (j.tipo !== 'oficinar-presentacion') throw new Error('El archivo no es una presentación de Presentar.');
      pres = j; archivoActual = ruta;
    }
    diapoActual = 0; objSel = null;
    pilaDeshacer = []; pilaRehacer = [];
    limpiarModificado(); renderTodo();
    if (!archivoActual) $('estadoArchivo').textContent = path.basename(ruta) + ' (importado)';
  } catch (err) {
    await ipcRenderer.invoke('mensaje', { type: 'error', title: 'Presentar', message: 'No se pudo abrir el archivo.', detail: String(err.message || err) });
  }
}

// ---------- Importación básica de PowerPoint (.pptx) ----------
// Recupera cuadros de texto (posición, tamaño, negrita, alineación) e imágenes de cada diapositiva.
async function importarPPTX(ruta) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(ruta));
  const EMU_POR_PX = 9525;
  const parser = new DOMParser();

  // Tamaño de la diapositiva para escalar al lienzo 960x540
  let escalaX = 960 / 1280, escalaY = 540 / 720;
  const presXML = zip.file('ppt/presentation.xml');
  if (presXML) {
    const px = parser.parseFromString(await presXML.async('string'), 'application/xml');
    const tam = px.getElementsByTagName('p:sldSz')[0];
    if (tam) {
      escalaX = 960 / (parseInt(tam.getAttribute('cx'), 10) / EMU_POR_PX);
      escalaY = 540 / (parseInt(tam.getAttribute('cy'), 10) / EMU_POR_PX);
    }
  }

  const archivosDiapo = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  if (!archivosDiapo.length) throw new Error('El archivo .pptx no contiene diapositivas.');

  const nueva = { tipo: 'oficinar-presentacion', version: 1, tema: 'claro', transicion: 'fundido', diapositivas: [] };

  for (const nombre of archivosDiapo) {
    const xml = parser.parseFromString(await zip.file(nombre).async('string'), 'application/xml');
    const num = nombre.match(/slide(\d+)\.xml/)[1];
    // Relaciones (para localizar las imágenes)
    const rels = {};
    const relFile = zip.file(`ppt/slides/_rels/slide${num}.xml.rels`);
    if (relFile) {
      const rx = parser.parseFromString(await relFile.async('string'), 'application/xml');
      for (const rel of rx.getElementsByTagName('Relationship')) {
        rels[rel.getAttribute('Id')] = rel.getAttribute('Target');
      }
    }

    const d = { fondo: null, objetos: [] };

    // Cuadros de texto y formas con texto
    for (const sp of xml.getElementsByTagName('p:sp')) {
      try {
        const off = sp.getElementsByTagName('a:off')[0];
        const ext = sp.getElementsByTagName('a:ext')[0];
        const parrafos = [...sp.getElementsByTagName('a:p')].map(p =>
          [...p.getElementsByTagName('a:t')].map(t => t.textContent).join('')
        ).filter(t => t !== undefined);
        const texto = parrafos.join('<br>');
        if (!texto.replace(/<br>/g, '').trim()) continue;
        const rPr = sp.getElementsByTagName('a:rPr')[0];
        const pPr = sp.getElementsByTagName('a:pPr')[0];
        const alinear = pPr && pPr.getAttribute('algn') === 'ctr' ? 'center'
          : pPr && pPr.getAttribute('algn') === 'r' ? 'right' : 'left';
        const obj = {
          tipo: 'texto',
          x: off ? Math.round(parseInt(off.getAttribute('x'), 10) / EMU_POR_PX * escalaX) : 60,
          y: off ? Math.round(parseInt(off.getAttribute('y'), 10) / EMU_POR_PX * escalaY) : 60,
          w: ext ? Math.max(40, Math.round(parseInt(ext.getAttribute('cx'), 10) / EMU_POR_PX * escalaX)) : 840,
          h: ext ? Math.max(30, Math.round(parseInt(ext.getAttribute('cy'), 10) / EMU_POR_PX * escalaY)) : 80,
          html: texto,
          tam: rPr && rPr.getAttribute('sz') ? Math.max(10, Math.round(parseInt(rPr.getAttribute('sz'), 10) / 100 * 1.33 * escalaY)) : 20,
          negrita: !!(rPr && rPr.getAttribute('b') === '1'),
          cursiva: !!(rPr && rPr.getAttribute('i') === '1'),
          alinear
        };
        d.objetos.push(obj);
      } catch (e) { /* forma no compatible: se omite */ }
    }

    // Imágenes
    for (const pic of xml.getElementsByTagName('p:pic')) {
      try {
        const blip = pic.getElementsByTagName('a:blip')[0];
        const id = blip && (blip.getAttribute('r:embed') || blip.getAttribute('r:link'));
        if (!id || !rels[id]) continue;
        const destino = rels[id].replace(/^\.\.\//, 'ppt/');
        const archivo = zip.file(destino) || zip.file('ppt/slides/' + rels[id]);
        if (!archivo) continue;
        const ext2 = destino.split('.').pop().toLowerCase();
        const mime = ext2 === 'png' ? 'png' : (ext2 === 'gif' ? 'gif' : (ext2 === 'svg' ? 'svg+xml' : 'jpeg'));
        const b64 = await archivo.async('base64');
        const off = pic.getElementsByTagName('a:off')[0];
        const ext = pic.getElementsByTagName('a:ext')[0];
        d.objetos.push({
          tipo: 'imagen',
          src: `data:image/${mime};base64,${b64}`,
          x: off ? Math.round(parseInt(off.getAttribute('x'), 10) / EMU_POR_PX * escalaX) : 300,
          y: off ? Math.round(parseInt(off.getAttribute('y'), 10) / EMU_POR_PX * escalaY) : 140,
          w: ext ? Math.max(20, Math.round(parseInt(ext.getAttribute('cx'), 10) / EMU_POR_PX * escalaX)) : 320,
          h: ext ? Math.max(20, Math.round(parseInt(ext.getAttribute('cy'), 10) / EMU_POR_PX * escalaY)) : 240
        });
      } catch (e) { /* imagen no compatible: se omite */ }
    }

    nueva.diapositivas.push(d);
  }
  return nueva;
}
async function accionGuardar() {
  guardarTextoActivo();
  if (!archivoActual) return accionGuardarComo();
  fs.writeFileSync(archivoActual, JSON.stringify(pres), 'utf8');
  limpiarModificado();
  return true;
}
async function accionGuardarComo() {
  guardarTextoActivo();
  const ruta = await ipcRenderer.invoke('dialogo-guardar', {
    title: 'Guardar presentación',
    defaultPath: archivoActual || 'presentacion.presentacion',
    filters: [{ name: 'Presentación de Presentar', extensions: ['presentacion'] }]
  });
  if (!ruta) return false;
  archivoActual = ruta;
  fs.writeFileSync(ruta, JSON.stringify(pres), 'utf8');
  limpiarModificado();
  return true;
}

// Exportar a PDF: se genera una zona de impresión con todas las diapositivas
async function exportarPDF() {
  guardarTextoActivo();
  const zona = document.createElement('div');
  zona.id = 'zonaImpresion';
  const estilo = document.createElement('style');
  estilo.textContent = `
    @media print {
      body > *:not(#zonaImpresion) { display: none !important; }
      #zonaImpresion { display: block !important; }
      @page { size: 11in 6.19in; margin: 0; }
      .print-diapo { width: 960px; height: 540px; position: relative; overflow: hidden; page-break-after: always; transform: scale(1.1); transform-origin: top left; }
      .print-diapo:last-child { page-break-after: avoid; }
    }
    #zonaImpresion { display: none; }
  `;
  document.body.appendChild(estilo);
  const selPrevio = objSel; objSel = null;
  pres.diapositivas.forEach(d => {
    const pd = document.createElement('div');
    pd.className = 'print-diapo';
    renderDiapositiva(d, pd, false);
    zona.appendChild(pd);
  });
  objSel = selPrevio;
  document.body.appendChild(zona);
  const nombre = archivoActual ? path.basename(archivoActual, '.presentacion') + '.pdf' : 'presentacion.pdf';
  const ruta = await ipcRenderer.invoke('imprimir-pdf', { nombre, horizontal: true, usarCSS: true });
  zona.remove(); estilo.remove();
  if (ruta) await ipcRenderer.invoke('mensaje', { type: 'info', title: 'Presentar', message: 'PDF exportado correctamente.', detail: ruta });
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
    case 'deshacer': deshacer(); break;
    case 'rehacer': rehacer(); break;
    case 'cortar': if (contenidoEnEdicion()) document.execCommand('cut'); else copiarObjeto(true); break;
    case 'copiar': if (contenidoEnEdicion()) document.execCommand('copy'); else copiarObjeto(false); break;
    case 'pegar':
      if (contenidoEnEdicion()) document.execCommand('insertText', false, clipboard.readText());
      else pegarObjeto();
      break;
    case 'nuevaDiapositiva': nuevaDiapositiva(); break;
    case 'duplicarDiapositiva': duplicarDiapositiva(); break;
    case 'eliminarDiapositiva': eliminarDiapositiva(); break;
    case 'insertarTexto': nuevoTexto(); break;
    case 'insertarImagen': nuevaImagen(); break;
    case 'insertarRect': nuevaForma('rect'); break;
    case 'insertarElipse': nuevaForma('elipse'); break;
    case 'insertarTriangulo': nuevaForma('triangulo'); break;
    case 'insertarFlecha': nuevaForma('flecha'); break;
    case 'insertarLineaForma': nuevaForma('linea'); break;
    case 'insertarEstrella': nuevaForma('estrella'); break;
    case 'insertarRombo': nuevaForma('rombo'); break;
    case 'insertarPentagono': nuevaForma('pentagono'); break;
    case 'insertarHexagono': nuevaForma('hexagono'); break;
    case 'insertarGlobo': nuevaForma('globo'); break;
    case 'presentarInicio': iniciarPresentacion(0); break;
    case 'presentarActual': iniciarPresentacion(diapoActual); break;
  }
});

// Recepción de archivo desde asociación (sin diálogo)
ipcRenderer.on('abrir-archivo-recibido', async (_e, ruta) => {
  if (!ruta || typeof ruta !== 'string') return;
  try {
    if (!await confirmarPerdida()) return;
    const ext = require('path').extname(ruta).toLowerCase();
    if (ext === '.pptx') {
      const importada = await importarPPTX(ruta);
      pres = importada; archivoActual = null;
    } else {
      const j = JSON.parse(require('fs').readFileSync(ruta, 'utf8'));
      if (j.tipo !== 'oficinar-presentacion') throw new Error('El archivo no es una presentación de Presentar.');
      pres = j; archivoActual = ruta;
    }
    diapoActual = 0; objSel = null;
    pilaDeshacer = []; pilaRehacer = [];
    limpiarModificado(); renderTodo();
  } catch (err) {
    await ipcRenderer.invoke('mensaje', { type: 'error', title: 'Presentar', message: 'No se pudo abrir el archivo.', detail: String(err.message || err) });
  }
});

document.addEventListener('keydown', (e) => {
  if (enPresentacion) return;
  if (e.key === 'F5') { e.preventDefault(); iniciarPresentacion(e.shiftKey ? diapoActual : 0); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && !e.shiftKey) {
    if (document.activeElement && document.activeElement.isContentEditable) return;
    e.preventDefault(); agrupar();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); desagrupar(); }
});

// ---------- Integración con el Asistente IA ----------
window.IA_APP = {
  nombre: 'Presentar (presentaciones)',
  etiquetaInsertar: 'Crear diapositivas',
  instrucciones:
    'El documento es una presentación de diapositivas. Cuando el usuario pida crear o generar diapositivas, ' +
    'responde SOLO con este formato de texto plano (sin markdown):\n' +
    '=== Título de la diapositiva 1\n- punto uno\n- punto dos\n=== Título de la diapositiva 2\n- punto uno\n' +
    'Cada bloque "===" es una diapositiva nueva.',
  obtenerContexto() {
    const quitarHTML = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.innerText.trim(); };
    return pres.diapositivas.map((d, i) =>
      `Diapositiva ${i + 1}:\n` + d.objetos.filter(o => o.html).map(o => '  ' + quitarHTML(o.html)).join('\n')
    ).join('\n');
  },
  insertar(texto) {
    const limpio = texto.replace(/```[a-z]*\n?/g, '').replace(/\r/g, '').trim();
    const bloques = limpio.split(/^===\s*/m).map(b => b.trim()).filter(Boolean);
    snapshot();
    if (bloques.length === 0) return;
    if (bloques.length === 1 && !/^===/m.test(limpio)) {
      // Sin marcador: insertar como cuadro de texto en la diapositiva actual
      diapo().objetos.push({ tipo: 'texto', x: 120, y: 140, w: 720, h: 300, html: limpio.replace(/\n/g, '<br>'), tam: 22 });
    } else {
      for (const b of bloques) {
        const lineas = b.split('\n');
        const titulo = lineas.shift() || 'Diapositiva';
        const cuerpo = lineas.map(l => l.replace(/^\s*[-•*]\s*/, '')).filter(l => l.trim());
        const d = { fondo: null, objetos: [] };
        d.objetos.push({ tipo: 'texto', x: 60, y: 40, w: 840, h: 90, html: titulo, tam: 36, negrita: true });
        if (cuerpo.length) {
          d.objetos.push({
            tipo: 'texto', x: 80, y: 160, w: 800, h: 340,
            html: '<ul style="margin-left:24px">' + cuerpo.map(l => `<li>${l}</li>`).join('') + '</ul>', tam: 24
          });
        }
        pres.diapositivas.splice(++diapoActual, 0, d);
      }
    }
    objSel = null;
    renderTodo(); marcarModificado();
  },

  // Acciones que la IA puede ejecutar en la presentación
  acciones: {
    cambiar_tema: {
      descripcion: 'Cambia el tema visual. Parámetros: {"tema": "claro" | "oscuro" | "degradado" | "atardecer" | "bosque" | "cristal"}',
      fn: (p) => {
        if (!TEMAS[p.tema]) throw new Error('Tema desconocido: ' + p.tema);
        snapshot(); pres.tema = p.tema; renderTodo(); marcarModificado();
        return 'Tema cambiado a ' + p.tema;
      }
    },
    nueva_diapositiva: {
      descripcion: 'Agrega una diapositiva en blanco después de la actual. Sin parámetros.',
      fn: () => { nuevaDiapositiva(); return 'Diapositiva agregada'; }
    },
    iniciar_presentacion: {
      descripcion: 'Inicia el modo de proyección desde la primera diapositiva. Sin parámetros.',
      fn: () => { iniciarPresentacion(0); return 'Presentación iniciada'; }
    }
  }
};

// ---------- Inicio ----------
renderTodo();
ajustarEscala();
