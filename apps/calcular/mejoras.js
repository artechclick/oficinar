// ===== Calcular - mejoras de interfaz (suite Oficinar) =====
// Se carga después de renderer.js y reutiliza sus variables y funciones globales.

// ---------- Fuentes del sistema ----------
poblarFuentesSistema(document.getElementById('selFuente'), 'Calibri');

// ---------- Hormigas marchantes al copiar/cortar ----------
const zonaCopiaEl = document.createElement('div');
zonaCopiaEl.id = 'zonaCopia';
zonaCopiaEl.style.display = 'none';
viewport.appendChild(zonaCopiaEl);

let rangoCopiado = null; // { hoja, r1, c1, r2, c2 }

function mostrarZonaCopia() {
  if (!rangoCopiado || rangoCopiado.hoja !== hojaActual) { zonaCopiaEl.style.display = 'none'; return; }
  const { r1, c1, r2, c2 } = rangoCopiado;
  const x = offsetsCol[c1], y = offY(r1);
  zonaCopiaEl.style.display = 'block';
  zonaCopiaEl.style.left = x + 'px';
  zonaCopiaEl.style.top = y + 'px';
  zonaCopiaEl.style.width = (offsetsCol[c2 + 1] - x - 1) + 'px';
  zonaCopiaEl.style.height = (offY(r2 + 1) - y - 1) + 'px';
}
function limpiarZonaCopia() { rangoCopiado = null; zonaCopiaEl.style.display = 'none'; }

let ultimaOpFueCorte = false;

const _copiarOriginal = copiar;
copiar = function () {
  _copiarOriginal();
  if (!hayInputActivo()) { ultimaOpFueCorte = false; rangoCopiado = { hoja: hojaActual, ...selNorm() }; mostrarZonaCopia(); }
};
const _cortarOriginal = cortar;
cortar = function () {
  _cortarOriginal();
  if (!hayInputActivo()) { ultimaOpFueCorte = true; rangoCopiado = { hoja: hojaActual, ...selNorm() }; mostrarZonaCopia(); }
};
const _pegarOriginal = pegar;
pegar = function () {
  const limpiarDespues = ultimaOpFueCorte && !hayInputActivo();
  _pegarOriginal();
  if (limpiarDespues) { ultimaOpFueCorte = false; limpiarZonaCopia(); }
};

// ---------- Resaltado de referencias mientras se edita una fórmula ----------
const COLORES_REF = ['#2563eb', '#dc2626', '#7c3aed', '#059669', '#d97706', '#0891b2', '#be185d', '#4d7c0f'];
const capaRefs = document.createElement('div');
capaRefs.id = 'capaRefs';
viewport.appendChild(capaRefs);

function resaltarReferencias(formula) {
  capaRefs.innerHTML = '';
  if (!formula || !formula.startsWith('=')) return;
  const re = /(\$?[A-Za-z]{1,3}\$?[0-9]{1,7})(?:\s*:\s*(\$?[A-Za-z]{1,3}\$?[0-9]{1,7}))?/g;
  let m, i = 0;
  while ((m = re.exec(formula)) && i < 8) {
    const p1 = parseRef(m[1].replace(/\$/g, ''));
    if (!p1) continue;
    const p2 = m[2] ? parseRef(m[2].replace(/\$/g, '')) : p1;
    if (!p2) continue;
    const r1 = Math.min(p1.r, p2.r), r2 = Math.max(p1.r, p2.r);
    const c1 = Math.min(p1.c, p2.c), c2 = Math.max(p1.c, p2.c);
    const div = document.createElement('div');
    div.className = 'ref-formula';
    div.style.borderColor = COLORES_REF[i % COLORES_REF.length];
    div.style.background = COLORES_REF[i % COLORES_REF.length] + '14';
    div.style.left = offsetsCol[c1] + 'px';
    div.style.top = offY(r1) + 'px';
    div.style.width = (offsetsCol[c2 + 1] - offsetsCol[c1] - 2) + 'px';
    div.style.height = (offY(r2 + 1) - offY(r1) - 2) + 'px';
    capaRefs.appendChild(div);
    i++;
  }
}
editor.addEventListener('input', () => resaltarReferencias(editor.value));
entradaFormula.addEventListener('input', () => resaltarReferencias(entradaFormula.value));

// Reposicionar la zona de copia y limpiar referencias en cada render
const _renderOriginal = render;
render = function () {
  _renderOriginal();
  mostrarZonaCopia();
  if (!editando && !editandoEnBarra) capaRefs.innerHTML = '';
};

// Al empezar a editar, resaltar de inmediato las referencias de la fórmula existente
const _empezarEdicionOriginal = empezarEdicion;
empezarEdicion = function (inicial, seleccionarTodo) {
  _empezarEdicionOriginal(inicial, seleccionarTodo);
  resaltarReferencias(editor.value);
};

// Escape: quitar las hormigas marchantes (además del comportamiento normal)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !editando && !editandoEnBarra) limpiarZonaCopia();
});

// ---------- Indicador de tamaño de selección (3F × 2C) mientras se arrastra ----------
window.addEventListener('mousemove', () => {
  if (typeof arrastrando !== 'undefined' && arrastrando) {
    const n = selNorm();
    const filas = n.r2 - n.r1 + 1, cols = n.c2 - n.c1 + 1;
    if (filas > 1 || cols > 1) cuadroNombre.value = `${filas}F × ${cols}C`;
  }
});
window.addEventListener('mouseup', () => {
  setTimeout(() => { if (!editando && !editandoEnBarra) cuadroNombre.value = dirCelda(activa.r, activa.c); }, 0);
});

// ================= Herramientas avanzadas =================
const $$ = (id) => document.getElementById(id);
function forCadaCelda(fn) {
  const n = selNorm();
  for (let r = n.r1; r <= Math.min(n.r2, FILAS - 1); r++)
    for (let c = n.c1; c <= Math.min(n.c2, COLS - 1); c++) fn(r, c);
}

// ---------- Menú flotante genérico ----------
let menuAbierto = null;
function cerrarMenuFlotante() { if (menuAbierto) { menuAbierto.remove(); menuAbierto = null; } }
document.addEventListener('mousedown', (e) => {
  if (menuAbierto && !menuAbierto.contains(e.target)) cerrarMenuFlotante();
});
function abrirMenu(botonId, items) {
  cerrarMenuFlotante();
  const b = $$(botonId).getBoundingClientRect();
  const m = document.createElement('div');
  m.className = 'menu-flotante';
  for (const it of items) {
    if (it.sep) { const s = document.createElement('div'); s.className = 'mf-sep'; m.appendChild(s); continue; }
    if (it.titulo) { const t = document.createElement('div'); t.className = 'mf-titulo'; t.textContent = it.titulo; m.appendChild(t); continue; }
    const d = document.createElement('div');
    d.className = 'mf-item';
    d.textContent = it.label;
    d.addEventListener('click', () => { cerrarMenuFlotante(); it.fn(); });
    m.appendChild(d);
  }
  document.body.appendChild(m);
  m.style.left = Math.min(b.left, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = (b.bottom + 2) + 'px';
  menuAbierto = m;
}

// ---------- Tachado ----------
if ($$('btnTachado')) $$('btnTachado').onclick = () => alternarEstilo('st');

// ---------- Alineación vertical ----------
$$('vaSup').onclick = () => aplicarEstiloSel({ va: 'top' });
$$('vaMed').onclick = () => aplicarEstiloSel({ va: 'middle' });
$$('vaInf').onclick = () => aplicarEstiloSel({ va: 'bottom' });

// ---------- Orientación del texto ----------
$$('btnOrientacion').onclick = () => abrirMenu('btnOrientacion', [
  { label: 'Horizontal (normal)', fn: () => aplicarEstiloSel({ rot: null }) },
  { label: 'Texto vertical', fn: () => aplicarEstiloSel({ rot: 'vert' }) },
  { label: 'Girar hacia arriba (45°)', fn: () => aplicarEstiloSel({ rot: 'asc' }) },
  { label: 'Girar hacia abajo (45°)', fn: () => aplicarEstiloSel({ rot: 'desc' }) }
]);

// ---------- Combinar celdas ----------
function combinar(modo) {
  const n = selNorm();
  const m = meta();
  // Quitar combinaciones que se solapen con la selección
  m.combinadas = m.combinadas.filter(z => z.c2 < n.c1 || z.c1 > n.c2 || z.r2 < n.r1 || z.r1 > n.r2);
  if (modo === 'descombinar') { marcarModificado(); render(); return; }
  const nuevas = [];
  if (modo === 'todo') {
    if (n.r1 !== n.r2 || n.c1 !== n.c2) nuevas.push({ r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 });
  } else if (modo === 'horizontal') {
    for (let r = n.r1; r <= n.r2; r++) if (n.c1 !== n.c2) nuevas.push({ r1: r, c1: n.c1, r2: r, c2: n.c2 });
  }
  m.combinadas.push(...nuevas);
  marcarModificado(); render();
}
$$('btnCombinar').onclick = () => abrirMenu('btnCombinar', [
  { label: 'Combinar todo', fn: () => combinar('todo') },
  { label: 'Combinar horizontalmente', fn: () => combinar('horizontal') },
  { label: 'Descombinar', fn: () => combinar('descombinar') }
]);

// ---------- Bordes ----------
function abrirDialogoBordes() { $$('dialogoBordes').classList.remove('oculto'); }
function cerrarBordes() { $$('dialogoBordes').classList.add('oculto'); }
document.querySelectorAll('[data-cerrar-b]').forEach(b => b.onclick = cerrarBordes);
if ($$('btnBordes')) $$('btnBordes').onclick = abrirDialogoBordes;

function estiloBorde() {
  const g = $$('bordeGrosor').value, e = $$('bordeEstilo').value, col = $$('bordeColor').value;
  return `${g}px ${e} ${col}`;
}
function aplicarBordes(modo) {
  const linea = estiloBorde();
  const n = selNorm();
  forCadaCelda((r, c) => {
    const est = getEstilo(r, c) || {};
    const bordes = Object.assign({}, est.bordes);
    const borde = modo === 'ninguno' ? null : linea;
    if (modo === 'todos') { bordes.t = bordes.b = bordes.l = bordes.r = linea; }
    else if (modo === 'ninguno') { setEstilo(r, c, { bordes: null, bd: null }); return; }
    else if (modo === 'externos' || modo === 'gruesoExt') {
      const l2 = modo === 'gruesoExt' ? `3px ${$$('bordeEstilo').value} ${$$('bordeColor').value}` : linea;
      if (r === n.r1) bordes.t = l2;
      if (r === n.r2) bordes.b = l2;
      if (c === n.c1) bordes.l = l2;
      if (c === n.c2) bordes.r = l2;
    } else if (modo === 'internos') {
      if (r !== n.r2) bordes.b = linea;
      if (c !== n.c2) bordes.r = linea;
    } else { bordes[modo] = borde; } // t, b, l, r individuales
    setEstilo(r, c, { bordes });
  });
  marcarModificado(); render();
}
document.querySelectorAll('[data-borde]').forEach(b =>
  b.onclick = () => aplicarBordes(b.dataset.borde));

// ---------- Pegado especial ----------
$$('btnPegadoEsp').onclick = () => abrirMenu('btnPegadoEsp', [
  { titulo: 'Pegar' },
  { label: 'Solo valores', fn: () => pegadoEspecial('valores') },
  { label: 'Solo fórmulas', fn: () => pegadoEspecial('formulas') },
  { label: 'Solo formatos', fn: () => pegadoEspecial('formatos') },
  { sep: true },
  { label: 'Transponer (filas ↔ columnas)', fn: () => pegadoEspecial('transponer') }
]);

function pegadoEspecial(modo) {
  const texto = clipboard.readText();
  const dest = selNorm();
  if (modo === 'formatos') {
    // Requiere una copia interna previa
    if (!rangoCopiado || rangoCopiado.hoja !== hojaActual) { alert('Primero copia (Ctrl+C) el rango de origen.'); return; }
    const { r1, c1, r2, c2 } = rangoCopiado;
    const alto = r2 - r1 + 1, ancho = c2 - c1 + 1;
    for (let i = 0; i < alto; i++) for (let j = 0; j < ancho; j++) {
      const src = getEstilo(r1 + i, c1 + j);
      setEstilo(dest.r1 + i, dest.c1 + j, src ? Object.assign({}, src) : {});
      if (!src) meta().estilos.delete(claveEstilo(dest.r1 + i, dest.c1 + j));
    }
    marcarModificado(); render(); return;
  }
  if (!texto) return;
  let filas = texto.replace(/\r/g, '').split('\n');
  if (filas.length && filas[filas.length - 1] === '') filas.pop();
  let matriz = filas.map(f => f.split('\t'));
  if (modo === 'transponer') {
    const t = [];
    for (let c = 0; c < (matriz[0] ? matriz[0].length : 0); c++) {
      t.push(matriz.map(fila => fila[c] === undefined ? '' : fila[c]));
    }
    matriz = t;
  }
  if (modo === 'valores') {
    // Convertir fórmulas a su valor calculado si el origen interno existe
    matriz = matriz.map(fila => fila.map(v => v === '' ? null : v));
  } else if (modo === 'formulas') {
    matriz = matriz.map(fila => fila.map(v => v === '' ? null : v));
  } else {
    matriz = matriz.map(fila => fila.map(v => v === '' ? null : v));
  }
  try {
    hf.setCellContents({ sheet: hojaActual, row: dest.r1, col: dest.c1 }, matriz);
    marcarModificado(); render();
  } catch (e) { alert('No se pudo pegar: ' + e.message); }
}

// ---------- Copiar formato (pincel) ----------
let formatoPincel = null;
$$('btnCopiarFormato').onclick = () => {
  const est = getEstilo(activa.r, activa.c);
  formatoPincel = est ? Object.assign({}, est) : {};
  document.body.classList.add('pincel-activo');
  $$('btnCopiarFormato').classList.add('activo');
};
viewport.addEventListener('mouseup', () => {
  if (!formatoPincel) return;
  forCadaCelda((r, c) => {
    // Reemplaza estilo visual conservando el formato de número existente si el pincel no lo trae
    setEstilo(r, c, Object.assign({}, formatoPincel));
  });
  formatoPincel = null;
  document.body.classList.remove('pincel-activo');
  $$('btnCopiarFormato').classList.remove('activo');
  marcarModificado(); render();
});

// ---------- Autosuma desplegable ----------
$$('btnAutosumaMas').onclick = () => abrirMenu('btnAutosumaMas', [
  { label: 'Suma', fn: () => autosumaFn('SUMA') },
  { label: 'Promedio', fn: () => autosumaFn('PROMEDIO') },
  { label: 'Contar números', fn: () => autosumaFn('CONTAR') },
  { label: 'Máximo', fn: () => autosumaFn('MAX') },
  { label: 'Mínimo', fn: () => autosumaFn('MIN') }
]);
function autosumaFn(func) {
  const r = activa.r, c = activa.c;
  const esNum = (rr, cc) => typeof hf.getCellValue({ sheet: hojaActual, row: rr, col: cc }) === 'number';
  if (r > 0 && esNum(r - 1, c)) {
    let r0 = r - 1; while (r0 > 0 && esNum(r0 - 1, c)) r0--;
    aplicarValor(r, c, `=${func}(${dirCelda(r0, c)}:${dirCelda(r - 1, c)})`); moverActiva(1, 0, false); return;
  }
  if (c > 0 && esNum(r, c - 1)) {
    let c0 = c - 1; while (c0 > 0 && esNum(r, c0 - 1)) c0--;
    aplicarValor(r, c, `=${func}(${dirCelda(r, c0)}:${dirCelda(r, c - 1)})`); moverActiva(0, 1, false); return;
  }
  empezarEdicion(`=${func}(`, false);
}

// ---------- Borrar (menú) ----------
$$('btnBorrarMenu').onclick = () => abrirMenu('btnBorrarMenu', [
  { label: 'Borrar todo', fn: () => { borrarContenido(); forCadaCelda((r, c) => meta().estilos.delete(claveEstilo(r, c))); marcarModificado(); render(); } },
  { label: 'Borrar formatos', fn: () => { forCadaCelda((r, c) => meta().estilos.delete(claveEstilo(r, c))); marcarModificado(); render(); } },
  { label: 'Borrar contenido', fn: () => borrarContenido() }
]);

// ---------- Ordenar ----------
function ordenar(asc) {
  const n = selNorm();
  let r1 = n.r1, r2 = n.r2, c1 = n.c1, c2 = n.c2;
  // Si es una sola celda o columna, extender al bloque de datos contiguo
  if (r1 === r2 && c1 === c2) {
    const dims = hf.getSheetDimensions(hojaActual);
    r1 = 0; r2 = dims.height - 1;
    const lleno = (r) => { const v = hf.getCellValue({ sheet: hojaActual, row: r, col: c1 }); return v !== null && v !== undefined && v !== ''; };
    while (r1 < r2 && !lleno(r1)) r1++;
    while (r2 > r1 && !lleno(r2)) r2--;
    // ampliar columnas contiguas con datos
    let cc = c1;
    while (cc + 1 < COLS) { let hay = false; for (let r = r1; r <= r2; r++) { const v = hf.getCellValue({ sheet: hojaActual, row: r, col: cc + 1 }); if (v !== null && v !== undefined && v !== '') { hay = true; break; } } if (!hay) break; cc++; }
    c2 = cc;
    let cq = c1;
    while (cq - 1 >= 0) { let hay = false; for (let r = r1; r <= r2; r++) { const v = hf.getCellValue({ sheet: hojaActual, row: r, col: cq - 1 }); if (v !== null && v !== undefined && v !== '') { hay = true; break; } } if (!hay) break; cq--; }
    c1 = cq;
  }
  const colPivote = n.c1;
  const filas = [];
  for (let r = r1; r <= r2; r++) {
    const fila = [];
    for (let c = c1; c <= c2; c++) {
      let s = ''; try { s = hf.getCellSerialized({ sheet: hojaActual, row: r, col: c }); } catch (e) { }
      fila.push(s === null || s === undefined ? '' : s);
    }
    let clave; try { clave = hf.getCellValue({ sheet: hojaActual, row: r, col: colPivote }); } catch (e) { clave = ''; }
    filas.push({ fila, clave });
  }
  filas.sort((a, b) => {
    const x = a.clave, y = b.clave;
    let cmp;
    if (typeof x === 'number' && typeof y === 'number') cmp = x - y;
    else cmp = String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), 'es', { numeric: true });
    return asc ? cmp : -cmp;
  });
  const matriz = filas.map(f => f.fila);
  try {
    hf.setCellContents({ sheet: hojaActual, row: r1, col: c1 }, matriz);
    marcarModificado(); render();
  } catch (e) { alert('No se pudo ordenar: ' + e.message); }
}
$$('btnOrdenAZ').onclick = () => ordenar(true);
$$('btnOrdenZA').onclick = () => ordenar(false);

// ---------- Filtro sencillo ----------
$$('btnFiltro').onclick = () => {
  const m = meta();
  const n = selNorm();
  // Alternar: si ya hay filas ocultas, mostrarlas todas
  if (Object.keys(m.ocultas).length) {
    m.ocultas = {};
    recalcularOffsets(); marcarModificado(); render();
    return;
  }
  const criterio = prompt('Mostrar solo las filas cuya columna ' + nombreCol(n.c1) + ' contenga:\n(deja vacío para mostrar solo las que tengan datos)');
  if (criterio === null) return;
  const dims = hf.getSheetDimensions(hojaActual);
  const q = criterio.trim().toLowerCase();
  for (let r = n.r1 + 1; r < dims.height; r++) { // r1 = encabezado
    const info = textoCelda(r, n.c1);
    const t = (info.texto || '').toLowerCase();
    const coincide = q ? t.includes(q) : t !== '';
    if (!coincide) m.ocultas[r] = 1;
  }
  recalcularOffsets(); marcarModificado(); render();
};

// ---------- Buscar y reemplazar ----------
function reemplazarUno() {
  const q = $$('textoBuscar').value;
  const rep = $$('textoReemplazo').value;
  if (!q) return;
  const info = textoCelda(activa.r, activa.c);
  if (info.texto && info.texto.toLowerCase().includes(q.toLowerCase())) {
    let s = ''; try { s = String(hf.getCellSerialized({ sheet: hojaActual, row: activa.r, col: activa.c }) ?? ''); } catch (e) { }
    const nuevo = s.replace(new RegExp(escaparRegex(q), 'gi'), rep);
    aplicarValor(activa.r, activa.c, nuevo);
    render();
  }
  buscarSiguiente();
}
function reemplazarTodos() {
  const q = $$('textoBuscar').value;
  const rep = $$('textoReemplazo').value;
  if (!q) return;
  const dims = hf.getSheetDimensions(hojaActual);
  const re = new RegExp(escaparRegex(q), 'gi');
  let n = 0;
  for (let r = 0; r < dims.height; r++) for (let c = 0; c < dims.width; c++) {
    let s; try { s = hf.getCellSerialized({ sheet: hojaActual, row: r, col: c }); } catch (e) { continue; }
    if (typeof s === 'string' && re.test(s)) {
      re.lastIndex = 0;
      hf.setCellContents({ sheet: hojaActual, row: r, col: c }, [[s.replace(re, rep)]]);
      n++;
    }
  }
  marcarModificado(); render();
  $$('resultadoBuscar').textContent = `${n} celdas reemplazadas.`;
}
function escaparRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
if ($$('btnReemplazarUno')) $$('btnReemplazarUno').onclick = reemplazarUno;
if ($$('btnReemplazarTodos')) $$('btnReemplazarTodos').onclick = reemplazarTodos;

// ---------- Formato condicional (diálogo) ----------
function abrirDialogoCond() { renderReglasCond(); $$('dialogoCond').classList.remove('oculto'); }
function cerrarCond() { $$('dialogoCond').classList.add('oculto'); }
document.querySelectorAll('[data-cerrar-c]').forEach(b => b.onclick = cerrarCond);
$$('btnFormatoCond').onclick = abrirDialogoCond;
$$('condTipo').onchange = () => {
  const t = $$('condTipo').value;
  $$('condFilaValor').style.display = (t === 'duplicados' || t === 'escala' || t === 'barras') ? 'none' : 'flex';
};
$$('btnAgregarCond').onclick = () => {
  const n = selNorm();
  const regla = {
    tipo: $$('condTipo').value,
    valor: $$('condValor').value,
    color: $$('condColor').value,
    r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2
  };
  meta().condicionales.push(regla);
  invalidarCacheCond();
  marcarModificado(); render(); renderReglasCond();
};
function renderReglasCond() {
  const cont = $$('listaCond');
  const reglas = meta().condicionales;
  const nombres = { mayor: 'Mayor que', menor: 'Menor que', igual: 'Igual a', contiene: 'Contiene', duplicados: 'Duplicados', escala: 'Escala de color', barras: 'Barras de datos' };
  cont.innerHTML = reglas.length ? '' : '<div style="padding:10px;color:#888;font-size:12px">No hay reglas.</div>';
  reglas.forEach((g, i) => {
    const d = document.createElement('div');
    d.className = 'regla-cond';
    d.innerHTML = `<span class="muestra" style="background:${g.color}"></span>
      <span>${nombres[g.tipo] || g.tipo}${g.valor && !['duplicados','escala','barras'].includes(g.tipo) ? ' ' + g.valor : ''} · ${dirCelda(g.r1, g.c1)}:${dirCelda(g.r2, g.c2)}</span>
      <button title="Eliminar regla">&#10005;</button>`;
    d.querySelector('button').onclick = () => { reglas.splice(i, 1); invalidarCacheCond(); marcarModificado(); render(); renderReglasCond(); };
    cont.appendChild(d);
  });
}

// ---------- Dimensiones ----------
$$('btnDimensiones').onclick = () => abrirMenu('btnDimensiones', [
  { label: 'Alto de fila / ancho de columna...', fn: abrirDialogoDim },
  { sep: true },
  { label: 'Autoajustar ancho de columna', fn: () => autoajustarAncho() },
  { sep: true },
  { label: 'Ocultar filas seleccionadas', fn: () => ocultarFilas(true) },
  { label: 'Mostrar todas las filas', fn: () => ocultarFilas(false) }
]);
function abrirDialogoDim() {
  $$('dimAlto').value = altoFila(activa.r);
  $$('dimAncho').value = anchoCol(activa.c);
  $$('dialogoDim').classList.remove('oculto');
}
document.querySelectorAll('[data-cerrar-d]').forEach(b => b.onclick = () => $$('dialogoDim').classList.add('oculto'));
$$('btnDimAplicar').onclick = () => {
  const alto = parseInt($$('dimAlto').value, 10);
  const ancho = parseInt($$('dimAncho').value, 10);
  const n = selNorm();
  const m = meta();
  for (let r = n.r1; r <= n.r2; r++) m.altos[r] = alto;
  for (let c = n.c1; c <= n.c2; c++) m.anchos[c] = ancho;
  recalcularOffsets(); marcarModificado(); render();
  $$('dialogoDim').classList.add('oculto');
};
$$('btnDimAutoajuste').onclick = () => { autoajustarAncho(); $$('dialogoDim').classList.add('oculto'); };
function autoajustarAncho() {
  const n = selNorm();
  const dims = hf.getSheetDimensions(hojaActual);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '13px Calibri';
  for (let c = n.c1; c <= n.c2; c++) {
    let max = 40;
    for (let r = 0; r < Math.min(dims.height, 2000); r++) {
      const t = textoCelda(r, c).texto;
      if (t) max = Math.max(max, ctx.measureText(t).width + 14);
    }
    meta().anchos[c] = Math.min(500, Math.ceil(max));
  }
  recalcularOffsets(); marcarModificado(); render();
}
function ocultarFilas(ocultar) {
  const n = selNorm();
  const m = meta();
  if (ocultar) for (let r = n.r1; r <= n.r2; r++) m.ocultas[r] = 1;
  else m.ocultas = {};
  recalcularOffsets(); marcarModificado(); render();
}

// Recalcular offsets al inicio (por si hay filas con alto personalizado cargadas)
recalcularOffsets();
