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
const ETIQUETAS_BLOQUE = ['P', 'H1', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'DIV'];

function esDecoracion(n) {
  return n && n.nodeType === 1 && (
    n.classList.contains('pag-encabezado') || n.classList.contains('pag-pie') ||
    n.classList.contains('pag-num') || n.classList.contains('notas-pie-cont'));
}
function esBloqueEstandar(n) {
  return n && n.nodeType === 1 && /^(P|H1|H2|H3|H4|H5|H6|UL|OL|BLOCKQUOTE|PRE|TABLE|HR|FIGURE)$/.test(n.tagName);
}
// Bloques con clase propia de la app que deben conservarse intactos (no aplanar)
function esBloqueProtegido(n) {
  return n && n.nodeType === 1 && n.classList && (
    n.classList.contains('toc') || n.classList.contains('salto-pagina'));
}
function esBloque(n) {
  return n && n.nodeType === 1 && ETIQUETAS_BLOQUE.includes(n.tagName);
}
function esSaltoPagina(n) {
  return n && n.nodeType === 1 && n.classList && n.classList.contains('salto-pagina');
}

// Aplana y normaliza los hijos directos de una página en bloques distribuibles:
// desenvuelve DIV/SECTION que contienen bloques, convierte DIV inline en <p>,
// y envuelve texto/inline sueltos en <p>. Así el contenido pegado/importado
// (que suele venir en un <div> gigante) se divide en bloques que sí paginan.
const CONTENEDORES = ['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FORM'];
function normalizarPagina(p) {
  let n = p.firstChild;
  let guard = 0;
  while (n && guard++ < 200000) {
    const sig = n.nextSibling;
    if (esDecoracion(n) || esSaltoPagina(n)) { n = sig; continue; }

    // Nodo de texto suelto: envolver (junto a los inline siguientes) en <p>
    if (n.nodeType === 3) {
      if (!n.textContent.trim()) { n.remove(); n = sig; continue; }
      n = envolverInline(p, n); continue;
    }
    if (n.nodeType !== 1) { n = sig; continue; }

    const tag = n.tagName;
    if (esBloqueEstandar(n) || esBloqueProtegido(n)) { n = sig; continue; }

    // Inline suelto a nivel de página: envolver en <p>
    if (ETIQUETAS_INLINE.includes(tag)) { n = envolverInline(p, n); continue; }

    // Contenedor (div, section...): aplanar o convertir
    if (CONTENEDORES.includes(tag)) {
      const hijos = [...n.childNodes];
      const tieneBloque = hijos.some(c => c.nodeType === 1 &&
        (esBloqueEstandar(c) || esSaltoPagina(c) || CONTENEDORES.includes(c.tagName)));
      if (tieneBloque) {
        // Desenvolver: subir los hijos al nivel de la página y reprocesarlos
        const primero = n.firstChild;
        while (n.firstChild) p.insertBefore(n.firstChild, n);
        n.remove();
        n = primero || sig; continue;
      } else {
        // Solo inline: convertir el div en <p> conservando la alineación
        const env = document.createElement('p');
        if (n.style && n.style.textAlign) env.style.textAlign = n.style.textAlign;
        while (n.firstChild) env.appendChild(n.firstChild);
        n.replaceWith(env);
        n = env.nextSibling; continue;
      }
    }
    // Otro elemento (p.ej. figure ya cubierto): dejar como bloque
    n = sig;
  }
}
function envolverInline(p, n) {
  const env = document.createElement('p');
  p.insertBefore(env, n);
  let m = n;
  while (m && (m.nodeType === 3 || (m.nodeType === 1 && ETIQUETAS_INLINE.includes(m.tagName)))) {
    const s2 = m.nextSibling; env.appendChild(m); m = s2;
  }
  return env.nextSibling;
}

// ¿El contenido de la página supera el área útil (altura menos márgenes vertical)?
// Se mide con offset (fiable con zoom) en vez de scrollHeight (que ignora el padding inferior).
function desborda(p) {
  const bloques = bloquesEn(p);
  if (bloques.length <= 1) return false;
  const ratioMargen = formatoPagina.margen / dimensionesPagina().h;
  const fondoUtil = p.clientHeight * (1 - ratioMargen);
  const ultimo = bloques[bloques.length - 1];
  return (ultimo.offsetTop + ultimo.offsetHeight) > fondoUtil + 0.5;
}

function capturarCaret() {
  const s = window.getSelection();
  if (s.rangeCount && marco.contains(s.anchorNode)) return s.getRangeAt(0).cloneRange();
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

function forzarReflow(el) {
  if (el) void el.offsetHeight;
}

let rafRepag = null;
let repagPendiente = false;
function repaginarPronto() {
  repagPendiente = true;
  if (rafRepag) return;
  const loop = () => {
    rafRepag = null;
    if (repagPendiente) {
      repagPendiente = false;
      try { repaginar(); } catch (e) { console.error('repaginar error:', e); }
      if (repagPendiente) rafRepag = requestAnimationFrame(loop);
    }
  };
  rafRepag = requestAnimationFrame(loop);
}

// Recolecta bloques del documento agrupando listas (ul/ol) como un solo bloque
function recolectarBloques() {
  if (paginasDoc().length === 0) return [];

  // Primero, normalizar: envolver text nodes sueltos en párrafos, quitar br sueltos
  for (const pg of paginasDoc()) {
    let n = pg.firstChild;
    while (n) {
      const sig = n.nextSibling;
      if (esDecoracion(n)) { n = sig; continue; }
      if (esSaltoPagina(n)) { n = sig; continue; }
      // Text node suelto: envolver en <p>
      if (n.nodeType === 3) {
        if (!n.textContent.trim()) { n.remove(); n = sig; continue; }
        const p = document.createElement('p');
        pg.insertBefore(p, n);
        p.appendChild(n);
        n = p.nextSibling;
        continue;
      }
      // <br> suelto: quitar (será reemplazado por un espacio en el párrafo siguiente)
      if (n.tagName === 'BR' && pg === n.parentNode) {
        n.remove();
        n = sig;
        continue;
      }
      // <div> o contenedor que solo tiene texto suelto: convertir a <p>
      if ((n.tagName === 'DIV') && n.childNodes.length > 0) {
        const tieneInline = [...n.childNodes].some(c => c.nodeType === 3 || (c.nodeType === 1 && ETIQUETAS_INLINE.includes(c.tagName)));
        const tieneBloque = [...n.children].some(c => ETIQUETAS_BLOQUE.includes(c.tagName));
        if (tieneInline && !tieneBloque) {
          const p = document.createElement('p');
          pg.insertBefore(p, n);
          while (n.firstChild) p.appendChild(n.firstChild);
          n.remove();
          n = p.nextSibling;
          continue;
        }
      }
      n = sig;
    }
  }

  // Recolectar todos los hijos directos no-decoración
  const bloques = [];
  for (const pg of paginasDoc()) {
    for (const child of [...pg.children]) {
      if (esDecoracion(child)) continue;
      bloques.push(child);
      pg.removeChild(child);
    }
  }
  // Agrupar listas consecutivas
  const grupos = [];
  let actual = null;
  for (const b of bloques) {
    // Eliminar divs completamente vacíos
    if (b.tagName === 'DIV' && !b.textContent.trim() && !b.querySelector('img, table, hr.salto-pagina')) {
      b.remove();
      continue;
    }
    if (actual && (actual.tagName === 'UL' || actual.tagName === 'OL') && b.tagName === actual.tagName) {
      while (b.firstChild) actual.appendChild(b.firstChild);
      b.remove();
    } else {
      grupos.push(b);
      actual = b;
    }
  }
  return grupos;
}

// Paginación INCREMENTAL: solo mueve los bloques del borde entre páginas adyacentes.
// Ventajas: no reconstruye el documento (el cursor se conserva porque los nodos no se
// destruyen, solo se mueven) y es rápido en vivo (normalmente 0-1 movimientos por tecla).
function repaginar() {
  repagPendiente = false;
  if (paginasDoc().length === 0) marco.appendChild(crearPagina());

  const caret = capturarCaret();

  // Quitar decoraciones (encabezado/pie) para que no cuenten como bloques al balancear.
  // El número de página se muestra con el pseudo-elemento .pagina::after (data-numero),
  // así NO hay un nodo no editable que estorbe al escribir al final de la hoja.
  marco.querySelectorAll('.pag-encabezado, .pag-pie, .pag-num').forEach(d => d.remove());

  // Aplanar/normalizar cada página en bloques distribuibles
  paginasDoc().forEach(normalizarPagina);

  // Balancear páginas de izquierda a derecha
  let i = 0, vueltas = 0;
  while (i < paginasDoc().length && vueltas++ < 5000) {
    const p = paginasDoc()[i];

    // Salto de página forzado: mover lo que está después del salto a la página siguiente
    const salto = p.querySelector(':scope > .salto-pagina');
    if (salto && salto.nextSibling) {
      const resto = [];
      let x = salto.nextSibling;
      while (x) { resto.push(x); x = x.nextSibling; }
      const sig = obtenerPagina(i + 1);
      for (let k = resto.length - 1; k >= 0; k--) sig.insertBefore(resto[k], sig.firstChild);
    }

    // Empujar bloques que desbordan hacia la página siguiente
    let g = 0;
    while (desborda(p) && bloquesEn(p).length > 1 && g++ < 5000) {
      const sig = obtenerPagina(i + 1);
      sig.insertBefore(ultimoBloque(p), sig.firstChild);
    }

    // Subir bloques de la página siguiente mientras quepan (y no haya salto forzado)
    g = 0;
    while (g++ < 5000) {
      const sig = paginasDoc()[i + 1];
      if (!sig) break;
      const ult = ultimoBloque(p);
      if (ult && esSaltoPagina(ult)) break;         // hay un salto: no subir más
      const primero = primerBloque(sig);
      if (!primero) { if (bloquesEn(sig).length === 0) sig.remove(); break; }
      if (esSaltoPagina(primero)) break;            // el siguiente bloque es un salto: arranca su página
      p.appendChild(primero);
      if (desborda(p)) { sig.insertBefore(primero, sig.firstChild); break; }
    }

    i++;
  }

  // Quitar páginas finales vacías (siempre queda al menos una)
  let pgs = paginasDoc();
  while (pgs.length > 1) {
    const u = pgs[pgs.length - 1];
    const b = bloquesEn(u);
    const vacia = b.length === 0 || (b.length === 1 && !u.textContent.trim() && !u.querySelector('img, table, hr.salto-pagina'));
    if (vacia) { u.remove(); pgs = paginasDoc(); } else break;
  }

  // La primera página siempre tiene al menos un párrafo editable
  const prim = paginasDoc()[0];
  if (prim && !bloquesEn(prim).length) {
    const pv = document.createElement('p'); pv.appendChild(document.createElement('br')); prim.appendChild(pv);
  }

  // Numerar páginas (mediante el atributo data-numero → pseudo-elemento CSS ::after)
  const total = paginasDoc().length;
  paginasDoc().forEach((p, k) => { p.dataset.numero = `${k + 1} / ${total}`; });

  actualizarEncabezadosPies();
  if (formatoPagina.columnas > 1) aplicarColumnas();

  // Restaurar el cursor: el rango sigue siendo válido porque solo movimos nodos
  restaurarCaret(caret);
  actualizarEstadoPaginas();
}

// Calcula el offset en texto plano del cursor dentro del documento
function textoOffsetDeRango(rango) {
  if (!rango || !marco.contains(rango.startContainer)) return -1;
  let offset = 0;
  const walker = document.createTreeWalker(marco, NodeFilter.SHOW_TEXT);
  let nodo;
  while ((nodo = walker.nextNode())) {
    if (rango.startContainer === nodo) {
      offset += rango.startOffset;
      return offset;
    }
    offset += nodo.nodeValue.length;
  }
  return -1;
}

// Encuentra el rango correspondiente a un offset de texto plano
function rangoDesdeTextoOffset(targetOffset) {
  if (targetOffset < 0) return null;
  let offset = 0;
  const walker = document.createTreeWalker(marco, NodeFilter.SHOW_TEXT);
  let nodo;
  let lastNode = null;
  while ((nodo = walker.nextNode())) {
    const len = nodo.nodeValue.length;
    if (offset + len >= targetOffset) {
      const r = document.createRange();
      r.setStart(nodo, targetOffset - offset);
      r.setEnd(nodo, targetOffset - offset);
      return r;
    }
    offset += len;
    lastNode = nodo;
  }
  // Si el offset está al final, posicionar al final del último nodo
  if (lastNode) {
    const r = document.createRange();
    r.setStart(lastNode, lastNode.nodeValue.length);
    r.setEnd(lastNode, lastNode.nodeValue.length);
    return r;
  }
  return null;
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

// Maneja teclas especiales (Enter, Backspace, etc.) que afectan la paginación
marco.addEventListener('keydown', (e) => {
  // Backspace al inicio de página: pasar al final de la página anterior y fusionar
  if (e.key === 'Backspace') {
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
    repaginarPronto();
    return;
  }
  // Enter: ejecutar paginación inmediata y scroll al cursor
  if (e.key === 'Enter' && !e.shiftKey) {
    const s = window.getSelection();
    if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    const p = paginaDe(r.startContainer);
    if (!p) return;
    const pgs = paginasDoc();
    const idx = pgs.indexOf(p);
    // Si no es la última página, deja que el navegador cree el bloque
    // y despues la paginación reorganizará
    setTimeout(() => {
      repaginar();
      // Scroll al cursor para mantenerlo visible
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const rr = sel.getRangeAt(0);
        const cont = rr.startContainer;
        if (cont.nodeType === 1) {
          const r2 = cont.getBoundingClientRect();
          if (r2.top > window.innerHeight - 100) {
            const nuevaPag = paginaDe(cont);
            if (nuevaPag) nuevaPag.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }
        }
      }
    }, 0);
  }
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
  if (typeof construirReglaVertical === 'function') {
    const d = dimensionesPagina();
    const margenV = formatoPagina.margen;
    construirReglaVertical(d.h, margenV);
  }
}

// ---------- Regla vertical (eje Y) ----------
function construirReglaVertical(alto, margen) {
  const regla = $('reglaVertical');
  if (!regla) return;
  regla.innerHTML = '';
  regla.style.height = ((alto || 1056)) + 'px';
  const margenes = alto - margen * 2;
  const mSup = document.createElement('div');
  mSup.className = 'margenV margen-sup';
  mSup.style.top = '0';
  mSup.style.height = (margen || 96) + 'px';
  regla.appendChild(mSup);
  const mInf = document.createElement('div');
  mInf.className = 'margenV margen-inf';
  mInf.style.bottom = '0';
  mInf.style.height = (margen || 96) + 'px';
  regla.appendChild(mInf);
  const PX_CM = 37.8;
  for (let cm = 1; cm * PX_CM < (alto || 1056); cm++) {
    const marca = document.createElement('div');
    marca.className = 'marcaV' + (cm % 2 ? ' media' : '') + ' centimetro';
    marca.style.top = (cm * PX_CM) + 'px';
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
  // Desactivar styleWithCSS solo aquí: así fontSize genera <font size="7"> (convertible a puntos).
  // Con styleWithCSS activo produciría font-size:xxx-large y el tamaño quedaría siempre enorme.
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontSize', false, '7');
  document.execCommand('styleWithCSS', false, true);
  const nuevos = [];
  marco.querySelectorAll('font[size="7"]').forEach(f => {
    const span = document.createElement('span');
    span.style.fontSize = pt + 'pt';
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
    // Quitar el tamaño de fuente de los elementos internos: si no, un <span> anidado
    // con un tamaño previo (p.ej. 48pt) ganaría y no se podría reducir el texto.
    span.querySelectorAll('[style*="font-size"], font[size]').forEach(el => {
      if (el.style) el.style.fontSize = '';
      if (el.tagName === 'FONT') el.removeAttribute('size');
      if (el.getAttribute && !el.getAttribute('style')) el.removeAttribute('style');
    });
    nuevos.push(span);
  });
  // Reponer la selección sobre el contenido modificado para permitir cambios de tamaño
  // consecutivos (si no, tras modificar el DOM se pierde la selección y el 2.º cambio no aplica).
  if (nuevos.length) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStartBefore(nuevos[0]);
    r.setEndAfter(nuevos[nuevos.length - 1]);
    sel.removeAllRanges(); sel.addRange(r);
    guardarRango();
  }
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
  if (html && html.trim()) {
    // Limpiar HTML del portapapeles
    const docTemp = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    const limpio = normalizarHTMLImportado(docTemp.body.firstChild ? docTemp.body.firstChild.innerHTML : '');
    document.execCommand('insertHTML', false, limpio);
  } else {
    const t = clipboard.readText();
    if (t) {
      // Convertir saltos de línea en párrafos
      const lineas = t.split(/\r?\n/);
      const htmlP = lineas.map(l => {
        const contenido = l.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return contenido ? `<p>${contenido}</p>` : '<p><br></p>';
      }).join('');
      document.execCommand('insertHTML', false, htmlP);
    }
  }
  guardarRango();
  marcarModificado();
  repaginar();
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

// Interceptar el pegado nativo (Ctrl+V) para limpiar y aplanar el contenido:
// sin esto, se inserta el HTML crudo del origen (a menudo un <div> gigante con estilos)
// que la paginación no puede dividir y todo queda en una sola hoja.
marco.addEventListener('paste', (e) => {
  e.preventDefault();
  const dt = e.clipboardData;
  if (!dt) return;
  const p = paginaActiva(); if (p) p.focus({ preventScroll: true });
  let insertado = false;
  const html = dt.getData('text/html');
  if (html && html.trim()) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const limpio = normalizarHTMLImportado(doc.body ? doc.body.innerHTML : html);
    document.execCommand('insertHTML', false, limpio);
    insertado = true;
  } else {
    const txt = dt.getData('text/plain');
    if (txt) {
      const htmlP = txt.split(/\r?\n/).map(l =>
        l.trim() ? `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : '<p><br></p>').join('');
      document.execCommand('insertHTML', false, htmlP);
      insertado = true;
    }
  }
  if (insertado) { guardarRango(); marcarModificado(); actualizarStats(); repaginar(); }
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
  // Insertar la marca como nodo real (execCommand('insertHTML') convierte <sup class> en <span>,
  // perdiendo la clase). Con la API de Range la marca conserva su clase.
  const marca = document.createElement('sup');
  marca.className = 'nota-ref';
  marca.dataset.nota = n;
  marca.textContent = `[${n}]`;
  p.focus({ preventScroll: true });
  restaurarRango();
  const sel = window.getSelection();
  if (sel.rangeCount && p.contains(sel.anchorNode)) {
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(marca);
    r.setStartAfter(marca); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
    guardarRango();
  } else {
    p.appendChild(marca);
  }
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
      const r = await mammoth.convertToHtml({ path: ruta }, {
        includeDefaultStyleMap: true,
        convertImage: mammoth.images.imgElement(async (image) => {
          const b64 = await image.read('base64');
          return { src: `data:${image.contentType};base64,${b64}` };
        }),
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Quote'] => blockquote:fresh",
          "p[style-name='Intense Quote'] => blockquote:fresh",
          "r[style-name='Strong'] => strong",
          "r[style-name='Emphasis'] => em",
          "b => strong",
          "i => em",
          "u => u"
        ]
      });
      establecerHTML(normalizarHTMLImportado(r.value || '<p><br></p>'));
    } else if (ext === '.html' || ext === '.htm') {
      const doc = new DOMParser().parseFromString(fs.readFileSync(ruta, 'utf8'), 'text/html');
      establecerHTML(normalizarHTMLImportado(doc.body.innerHTML || '<p><br></p>'));
    } else {
      const texto = fs.readFileSync(ruta, 'utf8');
      const lineas = texto.split(/\r?\n/);
      const htmlP = lineas.map(l => {
        const contenido = l.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return contenido ? `<p>${contenido}</p>` : '<p><br></p>';
      }).join('');
      establecerHTML(htmlP);
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

// Recepción de archivo desde asociación (sin diálogo)
ipcRenderer.on('abrir-archivo-recibido', async (_e, ruta) => {
  if (ruta && typeof ruta === 'string') {
    if (!await confirmarPerdida()) return;
    await abrirRuta(ruta);
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

// Normaliza HTML importado (mammoth o pegado) para que respete el line-height de la app y detecta saltos de página
function normalizarHTMLImportado(html) {
  if (!html || !html.trim()) return '<p><br></p>';
  // Parsear como fragmento HTML
  const tmpl = document.createElement('template');
  tmpl.innerHTML = html;

  // Si solo hay texto suelto, envolver en <p>
  const fragment = tmpl.content;
  const soloTexto = fragment.childNodes.length === 1 && fragment.firstChild.nodeType === 3;
  if (soloTexto) {
    const p = document.createElement('p');
    p.textContent = fragment.firstChild.textContent;
    while (fragment.firstChild) fragment.removeChild(fragment.firstChild);
    fragment.appendChild(p);
  }

  const pageBreaks = [];
  fragment.querySelectorAll('*').forEach(el => {
    el.removeAttribute('width');
    el.removeAttribute('height');
    const style = el.getAttribute('style') || '';
    const partes = style.split(';').filter(s => s.trim());
    const nuevoStyle = [];
    for (const p of partes) {
      const m = /^([\w-]+)\s*:\s*(.+)$/.exec(p.trim());
      if (!m) continue;
      const prop = m[1].toLowerCase(), val = m[2].trim();
      if (prop === 'page-break-after' || prop === 'page-break-before') {
        if (val === 'always' || val === 'page') {
          pageBreaks.push(el);
          return;
        }
      }
      // Solo conservar estilos que no afecten el layout de página
      if (prop === 'font-size' || prop === 'font-weight' || prop === 'font-style' ||
          prop === 'color' || prop === 'background-color' || prop === 'background' ||
          prop === 'text-align' || prop === 'vertical-align' ||
          prop === 'text-decoration') {
        nuevoStyle.push(`${prop}:${val}`);
      }
    }
    el.removeAttribute('style');
    if (nuevoStyle.length) el.setAttribute('style', nuevoStyle.join(';'));
  });

  // Reemplazar elementos de salto de página
  for (const el of pageBreaks) {
    if (!el.parentNode) continue;
    const hr = document.createElement('hr');
    hr.className = 'salto-pagina';
    el.replaceWith(hr);
  }

  // Serializar el contenido de vuelta a HTML
  const div = document.createElement('div');
  div.appendChild(fragment.cloneNode(true));
  return div.innerHTML;
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
