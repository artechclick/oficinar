// ===== Calcular - hoja de cálculo estilo Excel =====
const { ipcRenderer, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { HyperFormula } = require('hyperformula');
const esES = require('hyperformula/commonjs/i18n/languages/esES.js').default;

HyperFormula.registerLanguage('esES', esES);

// ---------- Configuración ----------
const FILAS = 5000;
const COLS = 130;
const ALTO_FILA = 24;
const ANCHO_COL_DEF = 100;
const ANCHO_CAB_FILA = 46;

const CONFIG_HF = {
  licenseKey: 'gpl-v3',
  language: 'esES',
  functionArgSeparator: ';',
  decimalSeparator: ',',
  thousandSeparator: '.',
  localeLang: 'es',
  dateFormats: ['DD/MM/YYYY', 'DD/MM/YY', 'DD-MM-YYYY', 'YYYY-MM-DD'],
  timeFormats: ['hh:mm', 'hh:mm:ss.sss'],
  currencySymbol: ['$', 'COP', 'US$'],
  smartRounding: true
};

// ---------- Estado global ----------
let hf = null;
let hojaActual = 0;                 // sheetId actual
let metaHojas = {};                 // sheetId -> { estilos: Map('r,c'->estilo), anchos: {col->px} }
let sel = { r1: 0, c1: 0, r2: 0, c2: 0 };  // selección normalizada al leer
let activa = { r: 0, c: 0 };
let ancla = { r: 0, c: 0 };
let editando = false;
let editandoEnBarra = false;
let archivoActual = null;
let modificado = false;
let ultimoTSVCopiado = null;
let hayCopiaInterna = false;

// ---------- Elementos ----------
const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const sizer = $('sizer');
const celdasEl = $('celdas');
const cabColCont = $('cabColContenido');
const cabFilCont = $('cabFilContenido');
const selEl = $('seleccion');
const activaEl = $('celdaActiva');
const asaEl = $('asaRelleno');
const editor = $('editor');
const entradaFormula = $('entradaFormula');
const cuadroNombre = $('cuadroNombre');

// ---------- Utilidades ----------
function nombreCol(c) {
  let s = '';
  c++;
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}
function parseRef(txt) {
  const m = /^([A-Za-z]{1,3})([0-9]{1,7})$/.exec(txt.trim());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  const r = parseInt(m[2], 10) - 1;
  c -= 1;
  if (r < 0 || r >= FILAS || c < 0 || c >= COLS) return null;
  return { r, c };
}
function dirCelda(r, c) { return nombreCol(c) + (r + 1); }
function selNorm() {
  return {
    r1: Math.min(sel.r1, sel.r2), r2: Math.max(sel.r1, sel.r2),
    c1: Math.min(sel.c1, sel.c2), c2: Math.max(sel.c1, sel.c2)
  };
}
function meta() {
  if (!metaHojas[hojaActual]) metaHojas[hojaActual] = {};
  const m = metaHojas[hojaActual];
  if (!m.estilos) m.estilos = new Map();
  if (!m.anchos) m.anchos = {};
  if (!m.altos) m.altos = {};           // alto de fila personalizado
  if (!m.ocultas) m.ocultas = {};       // filas ocultas (filtros)
  if (!m.combinadas) m.combinadas = []; // rangos combinados {r1,c1,r2,c2}
  if (!m.condicionales) m.condicionales = []; // reglas de formato condicional
  return m;
}
function claveEstilo(r, c) { return r + ',' + c; }
function getEstilo(r, c) { return meta().estilos.get(claveEstilo(r, c)) || null; }
function setEstilo(r, c, cambios) {
  const k = claveEstilo(r, c);
  const est = Object.assign({}, meta().estilos.get(k) || {}, cambios);
  for (const kk of Object.keys(est)) if (est[kk] === null || est[kk] === undefined) delete est[kk];
  if (Object.keys(est).length === 0) meta().estilos.delete(k); else meta().estilos.set(k, est);
}
function marcarModificado() {
  invalidarCacheCond();
  if (!modificado) { modificado = true; actualizarTitulo(); ipcRenderer.send('set-dirty', true); }
}
function limpiarModificado() {
  modificado = false; actualizarTitulo(); ipcRenderer.send('set-dirty', false);
}
function actualizarTitulo() {
  const nombre = archivoActual ? path.basename(archivoActual) : 'Libro nuevo';
  ipcRenderer.send('set-title', `${modificado ? '● ' : ''}${nombre} - Calcular`);
}

// ---------- Geometría de columnas y filas ----------
let offsetsCol = [];   // offsetsCol[c] = x inicial de la columna c; length COLS+1
let offsetsFila = [];  // offsetsFila[r] = y inicial de la fila r; length FILAS+1
function anchoCol(c) { return meta().anchos[c] || ANCHO_COL_DEF; }
function altoFila(r) {
  const m = meta();
  if (m.ocultas[r]) return 0;
  return m.altos[r] || ALTO_FILA;
}
const offY = (r) => offsetsFila[Math.max(0, Math.min(FILAS, r))];

function recalcularOffsets() {
  offsetsCol = new Array(COLS + 1);
  let x = 0;
  for (let c = 0; c < COLS; c++) { offsetsCol[c] = x; x += anchoCol(c); }
  offsetsCol[COLS] = x;
  offsetsFila = new Array(FILAS + 1);
  let y = 0;
  for (let r = 0; r < FILAS; r++) { offsetsFila[r] = y; y += altoFila(r); }
  offsetsFila[FILAS] = y;
  sizer.style.width = x + 'px';
  sizer.style.height = y + 'px';
}
function colEnX(x) {
  if (x < 0) return 0;
  let lo = 0, hi = COLS - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsetsCol[mid] <= x) lo = mid; else hi = mid - 1; }
  return lo;
}
function filaEnY(y) {
  if (y < 0) return 0;
  let lo = 0, hi = FILAS - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsetsFila[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}

// ---------- Celdas combinadas ----------
function combAncla(r, c) { return meta().combinadas.find(z => z.r1 === r && z.c1 === c) || null; }
function combDe(r, c) { return meta().combinadas.find(z => r >= z.r1 && r <= z.r2 && c >= z.c1 && c <= z.c2) || null; }

// ---------- Motor HyperFormula ----------
function crearHF(hojas) {
  if (hf) hf.destroy();
  if (hojas) hf = HyperFormula.buildFromSheets(hojas, CONFIG_HF);
  else { hf = HyperFormula.buildEmpty(CONFIG_HF); hf.addSheet('Hoja1'); }
  try {
    hf.addNamedExpression('VERDADERO', '=VERDADERO()');
    hf.addNamedExpression('FALSO', '=FALSO()');
  } catch (e) { /* ya existen */ }
  hojaActual = hf.getSheetId(hf.getSheetNames()[0]);
}

// ---------- Formato de números ----------
const fmtNum = {};
function formateadorNumero(dec, miles) {
  const k = dec + '|' + miles;
  if (!fmtNum[k]) fmtNum[k] = new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: miles
  });
  return fmtNum[k];
}
function serialAFecha(n) {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
}
function fechaTexto(n) {
  const d = serialAFecha(n);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}
function horaTexto(n) {
  const frac = n - Math.floor(n);
  let seg = Math.round(frac * 86400);
  const h = Math.floor(seg / 3600) % 24; seg %= 3600;
  return `${String(h).padStart(2, '0')}:${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`;
}

// Devuelve { texto, esNum, esErr }
function textoCelda(r, c) {
  const ad = { sheet: hojaActual, row: r, col: c };
  let v;
  try { v = hf.getCellValue(ad); } catch (e) { return { texto: '', esNum: false, esErr: false }; }
  if (v === null || v === undefined || v === '') return { texto: '', esNum: false, esErr: false };
  if (typeof v === 'object' && v.value !== undefined) return { texto: String(v.value), esNum: false, esErr: true };
  if (typeof v === 'boolean') return { texto: v ? 'VERDADERO' : 'FALSO', esNum: false, esErr: false };

  const est = getEstilo(r, c) || {};
  const fmt = est.fmt || 'general';

  if (typeof v !== 'number') {
    return { texto: String(v), esNum: false, esErr: false };
  }

  let tipo = '';
  try { tipo = hf.getCellValueDetailedType(ad); } catch (e) { tipo = 'NUMBER_RAW'; }
  const dec = (est.dec !== undefined) ? est.dec : 2;

  switch (fmt) {
    case 'numero': return { texto: formateadorNumero(dec, true).format(v), esNum: true };
    case 'moneda': return { texto: '$ ' + formateadorNumero(dec, true).format(v), esNum: true };
    case 'contabilidad':
      return { texto: v < 0 ? '$ (' + formateadorNumero(dec, true).format(-v) + ')' : '$ ' + formateadorNumero(dec, true).format(v), esNum: true };
    case 'porcentaje': return { texto: formateadorNumero(dec, false).format(v * 100) + ' %', esNum: true };
    case 'fecha': return { texto: fechaTexto(v), esNum: true };
    case 'hora': return { texto: horaTexto(v), esNum: true };
    case 'cientifico': return { texto: v.toExponential(dec).replace('.', ','), esNum: true };
    case 'fraccion': {
      const signo = v < 0 ? '-' : '';
      const abs = Math.abs(v);
      const entero = Math.floor(abs);
      const frac = abs - entero;
      if (frac < 1e-9) return { texto: signo + entero, esNum: true };
      let mejorN = 1, mejorD = 1, mejorErr = Infinity;
      for (let d = 1; d <= 16; d++) {
        const nn = Math.round(frac * d);
        const err = Math.abs(frac - nn / d);
        if (nn > 0 && err < mejorErr) { mejorErr = err; mejorN = nn; mejorD = d; }
      }
      return { texto: signo + (entero ? entero + ' ' : '') + mejorN + '/' + mejorD, esNum: true };
    }
    case 'texto': {
      let s = '';
      try { s = hf.getCellSerialized(ad); } catch (e) { s = String(v); }
      return { texto: String(s), esNum: false };
    }
    default: { // general: usa el tipo detectado
      if (tipo === 'NUMBER_DATE') return { texto: fechaTexto(v), esNum: true };
      if (tipo === 'NUMBER_TIME') return { texto: horaTexto(v), esNum: true };
      if (tipo === 'NUMBER_DATETIME') return { texto: fechaTexto(v) + ' ' + horaTexto(v), esNum: true };
      if (tipo === 'NUMBER_PERCENT') return { texto: formateadorNumero(est.dec !== undefined ? est.dec : 0, false).format(v * 100) + '%', esNum: true };
      if (tipo === 'NUMBER_CURRENCY') return { texto: '$ ' + formateadorNumero(2, true).format(v), esNum: true };
      // número normal: hasta 10 decimales sin ceros de relleno
      let t = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 10, useGrouping: false }).format(v);
      return { texto: t, esNum: true };
    }
  }
}

// ---------- Formato condicional ----------
let cacheCond = null; // caché por regla: {min,max,cuentas}
function invalidarCacheCond() { cacheCond = null; }

function estadisticasRegla(idx, regla) {
  if (!cacheCond) cacheCond = {};
  const clave = hojaActual + ':' + idx;
  if (cacheCond[clave]) return cacheCond[clave];
  let min = Infinity, max = -Infinity;
  const cuentas = new Map();
  const r2 = Math.min(regla.r2, FILAS - 1), c2 = Math.min(regla.c2, COLS - 1);
  for (let r = regla.r1; r <= r2; r++) {
    for (let c = regla.c1; c <= c2; c++) {
      let v; try { v = hf.getCellValue({ sheet: hojaActual, row: r, col: c }); } catch (e) { continue; }
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'number') { if (v < min) min = v; if (v > max) max = v; }
      const k = String(v).toLowerCase();
      cuentas.set(k, (cuentas.get(k) || 0) + 1);
    }
  }
  cacheCond[clave] = { min, max, cuentas };
  return cacheCond[clave];
}

function mezclarColor(hex, factor) {
  // interpola de blanco (factor 0) al color (factor 1)
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#63be7b');
  const n = parseInt(m ? m[1] : '63be7b', 16);
  const r = Math.round(255 + (((n >> 16) & 255) - 255) * factor);
  const g = Math.round(255 + (((n >> 8) & 255) - 255) * factor);
  const b = Math.round(255 + ((n & 255) - 255) * factor);
  return `rgb(${r},${g},${b})`;
}

// Devuelve { bg, barra } o null para la celda según las reglas activas
function formatoCondicionalDe(r, c) {
  const reglas = meta().condicionales;
  if (!reglas.length) return null;
  let res = null;
  for (let i = 0; i < reglas.length; i++) {
    const g = reglas[i];
    if (r < g.r1 || r > g.r2 || c < g.c1 || c > g.c2) continue;
    let v; try { v = hf.getCellValue({ sheet: hojaActual, row: r, col: c }); } catch (e) { continue; }
    if (v === null || v === undefined || v === '') continue;
    const num = typeof v === 'number' ? v : NaN;
    switch (g.tipo) {
      case 'mayor': if (!isNaN(num) && num > parseFloat(g.valor)) res = { bg: g.color }; break;
      case 'menor': if (!isNaN(num) && num < parseFloat(g.valor)) res = { bg: g.color }; break;
      case 'igual': if (String(v).toLowerCase() === String(g.valor).toLowerCase()) res = { bg: g.color }; break;
      case 'contiene': if (String(v).toLowerCase().includes(String(g.valor).toLowerCase())) res = { bg: g.color }; break;
      case 'duplicados': {
        const st = estadisticasRegla(i, g);
        if ((st.cuentas.get(String(v).toLowerCase()) || 0) > 1) res = { bg: g.color };
        break;
      }
      case 'escala': {
        if (isNaN(num)) break;
        const st = estadisticasRegla(i, g);
        if (st.max > st.min) res = { bg: mezclarColor(g.color, (num - st.min) / (st.max - st.min)) };
        break;
      }
      case 'barras': {
        if (isNaN(num)) break;
        const st = estadisticasRegla(i, g);
        if (st.max > st.min || st.max === st.min) {
          const pct = st.max === st.min ? 100 : Math.max(2, Math.round((num - st.min) / (st.max - st.min) * 100));
          res = { barra: { pct, color: g.color } };
        }
        break;
      }
    }
  }
  return res;
}

// ---------- Renderizado ----------
function estiloCeldaCSS(r, c, est, info, w, h) {
  let clases = 'celda';
  let stl = `left:${offsetsCol[c]}px;top:${offY(r)}px;width:${w}px;height:${h}px;`;
  if (info.esNum) clases += ' num';
  if (info.esErr) clases += ' err';
  if (est) {
    if (est.b) stl += 'font-weight:bold;';
    if (est.i) stl += 'font-style:italic;';
    const deco = [];
    if (est.u) deco.push('underline');
    if (est.st) deco.push('line-through');
    if (deco.length) stl += `text-decoration:${deco.join(' ')};`;
    if (est.ff) stl += `font-family:'${est.ff}',Calibri,sans-serif;`;
    if (est.fs) stl += `font-size:${est.fs}px;`;
    if (est.c) stl += `color:${est.c};`;
    if (est.bg) stl += `background:${est.bg};`;
    if (est.al) stl += `justify-content:${est.al === 'left' ? 'flex-start' : est.al === 'right' ? 'flex-end' : 'center'};`;
    if (est.va) stl += `align-items:${est.va === 'top' ? 'flex-start' : est.va === 'bottom' ? 'flex-end' : 'center'};`;
    if (est.wrap) clases += ' ajustar';
    // Bordes: est.bordes = { t, b, l, r } con "grosor estilo color"; est.bd es el modo antiguo (todos)
    if (est.bd) stl += 'border:1px solid #555;';
    if (est.bordes) {
      if (est.bordes.t) stl += `border-top:${est.bordes.t};`;
      if (est.bordes.b) stl += `border-bottom:${est.bordes.b};`;
      if (est.bordes.l) stl += `border-left:${est.bordes.l};`;
      if (est.bordes.r) stl += `border-right:${est.bordes.r};`;
    }
    // Orientación del texto
    if (est.rot === 'vert') stl += 'writing-mode:vertical-rl;justify-content:center;';
    else if (est.rot === 'asc') stl += 'transform:rotate(-45deg);overflow:visible;';
    else if (est.rot === 'desc') stl += 'transform:rotate(45deg);overflow:visible;';
  }
  return { clases, stl };
}

function render() {
  const st = viewport.scrollTop, sl = viewport.scrollLeft;
  const alto = viewport.clientHeight, ancho = viewport.clientWidth;

  const f1 = Math.max(0, filaEnY(st) - 2);
  const f2 = Math.min(FILAS - 1, filaEnY(st + alto) + 2);
  const c1 = Math.max(0, colEnX(sl) - 1);
  const c2 = Math.min(COLS - 1, colEnX(sl + ancho) + 1);

  const n = selNorm();
  const combinadas = meta().combinadas;

  // --- celdas ---
  let html = '';
  for (let r = f1; r <= f2; r++) {
    const hFila = altoFila(r);
    if (!hFila) continue; // fila oculta
    for (let c = c1; c <= c2; c++) {
      let w = anchoCol(c), h = hFila;
      let comb = null;
      if (combinadas.length) {
        comb = combDe(r, c);
        if (comb && !(comb.r1 === r && comb.c1 === c)) continue; // celda cubierta por una combinación
        if (comb) {
          w = offsetsCol[Math.min(comb.c2 + 1, COLS)] - offsetsCol[c];
          h = offY(Math.min(comb.r2 + 1, FILAS)) - offY(r);
        }
      }
      const info = textoCelda(r, c);
      const est = getEstilo(r, c);
      const { clases, stl } = estiloCeldaCSS(r, c, est, info, w, h);
      let extra = '';
      let stlFinal = stl;
      if (comb) stlFinal += 'z-index:1;' + ((est && est.bg) ? '' : 'background:#fff;');
      const cond = formatoCondicionalDe(r, c);
      if (cond) {
        if (cond.bg) stlFinal += `background:${cond.bg};`;
        if (cond.barra) extra = `<span class="barra-datos" style="width:${cond.barra.pct}%;background:${cond.barra.color}"></span>`;
      }
      const txt = info.texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html += `<div class="${clases}" style="${stlFinal}" data-r="${r}" data-c="${c}">${extra}<span class="celda-texto">${txt}</span></div>`;
    }
  }
  celdasEl.innerHTML = html;

  // --- cabeceras de columnas ---
  let hc = '';
  for (let c = c1; c <= c2; c++) {
    const enSel = c >= n.c1 && c <= n.c2;
    hc += `<div class="cab-col${enSel ? ' sel' : ''}" style="left:${offsetsCol[c]}px;width:${anchoCol(c)}px" data-c="${c}">${nombreCol(c)}</div>`;
    hc += `<div class="redim-col" style="left:${offsetsCol[c + 1] - 3}px" data-c="${c}"></div>`;
  }
  cabColCont.innerHTML = hc;
  cabColCont.style.transform = `translateX(${-sl}px)`;
  cabColCont.style.width = offsetsCol[COLS] + 'px';
  cabColCont.style.height = ALTO_FILA + 'px';

  // --- cabeceras de filas ---
  let hfil = '';
  for (let r = f1; r <= f2; r++) {
    const hFila = altoFila(r);
    if (!hFila) continue;
    const enSel = r >= n.r1 && r <= n.r2;
    hfil += `<div class="cab-fila${enSel ? ' sel' : ''}" style="top:${offY(r)}px;height:${hFila}px;width:${ANCHO_CAB_FILA}px" data-r="${r}">${r + 1}</div>`;
  }
  cabFilCont.innerHTML = hfil;
  cabFilCont.style.transform = `translateY(${-st}px)`;

  renderSeleccion();
  actualizarBarraFormula();
  actualizarStats();
}

function renderSeleccion() {
  const nn = selNorm();
  const x = offsetsCol[nn.c1], y = offY(nn.r1);
  const w = offsetsCol[nn.c2 + 1] - x, h = offY(nn.r2 + 1) - y;
  selEl.style.display = 'block';
  selEl.style.left = x + 'px'; selEl.style.top = y + 'px';
  selEl.style.width = (w - 1) + 'px'; selEl.style.height = (h - 1) + 'px';

  // Si la celda activa es el ancla de una combinación, el marco cubre todo el rango
  const comb = combAncla(activa.r, activa.c);
  const wAct = comb ? offsetsCol[comb.c2 + 1] - offsetsCol[activa.c] : anchoCol(activa.c);
  const hAct = comb ? offY(comb.r2 + 1) - offY(activa.r) : altoFila(activa.r);
  activaEl.style.display = editando ? 'none' : 'block';
  activaEl.style.left = (offsetsCol[activa.c] - 1) + 'px';
  activaEl.style.top = (offY(activa.r) - 1) + 'px';
  activaEl.style.width = (wAct - 2) + 'px';
  activaEl.style.height = (hAct - 2) + 'px';

  asaEl.style.display = editando ? 'none' : 'block';
  asaEl.style.left = (x + w - 5) + 'px';
  asaEl.style.top = (y + h - 5) + 'px';

  cuadroNombre.value = dirCelda(activa.r, activa.c);
}

function actualizarBarraFormula() {
  if (editando || editandoEnBarra) return;
  let s = '';
  try { s = hf.getCellSerialized({ sheet: hojaActual, row: activa.r, col: activa.c }); } catch (e) { s = ''; }
  entradaFormula.value = (s === null || s === undefined) ? '' : String(s);
}

function actualizarStats() {
  const n = selNorm();
  const total = (n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1);
  const el = $('estadoStats');
  if (total <= 1) { el.textContent = ''; return; }
  const dims = hf.getSheetDimensions(hojaActual);
  const r2 = Math.min(n.r2, dims.height - 1), c2 = Math.min(n.c2, dims.width - 1);
  let suma = 0, nums = 0, cuenta = 0;
  for (let r = n.r1; r <= r2; r++) {
    for (let c = n.c1; c <= c2; c++) {
      let v; try { v = hf.getCellValue({ sheet: hojaActual, row: r, col: c }); } catch (e) { continue; }
      if (v === null || v === undefined || v === '') continue;
      cuenta++;
      if (typeof v === 'number') { suma += v; nums++; }
    }
  }
  if (cuenta === 0) { el.textContent = ''; return; }
  const f = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 4 });
  let s = `Recuento: ${cuenta}`;
  if (nums > 0) s = `Promedio: ${f.format(suma / nums)}   Recuento: ${cuenta}   Suma: ${f.format(suma)}`;
  el.textContent = s;
}

// ---------- Selección y navegación ----------
function seleccionar(r, c, extender) {
  r = Math.max(0, Math.min(FILAS - 1, r));
  c = Math.max(0, Math.min(COLS - 1, c));
  if (extender) { sel.r2 = r; sel.c2 = c; }
  else {
    // Si la celda pertenece a una combinación, se selecciona el rango completo
    const comb = combDe(r, c);
    if (comb) {
      sel = { r1: comb.r1, c1: comb.c1, r2: comb.r2, c2: comb.c2 };
      activa = { r: comb.r1, c: comb.c1 }; ancla = { r: comb.r1, c: comb.c1 };
    } else {
      sel = { r1: r, c1: c, r2: r, c2: c }; activa = { r, c }; ancla = { r, c };
    }
  }
  asegurarVisible(r, c);
  render();
}
function asegurarVisible(r, c) {
  const y1 = offY(r), y2 = offY(r + 1);
  const x1 = offsetsCol[c], x2 = offsetsCol[c + 1];
  if (y1 < viewport.scrollTop) viewport.scrollTop = y1;
  else if (y2 > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = y2 - viewport.clientHeight;
  if (x1 < viewport.scrollLeft) viewport.scrollLeft = x1;
  else if (x2 > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = x2 - viewport.clientWidth;
}
function moverActiva(dr, dc, extender) {
  if (extender) {
    sel.r2 = Math.max(0, Math.min(FILAS - 1, sel.r2 + dr));
    sel.c2 = Math.max(0, Math.min(COLS - 1, sel.c2 + dc));
    asegurarVisible(sel.r2, sel.c2); render();
  } else {
    seleccionar(activa.r + dr, activa.c + dc, false);
  }
}
function saltoCtrl(dr, dc) {
  // Salta al borde del bloque de datos, como Ctrl+flecha en Excel
  const dims = hf.getSheetDimensions(hojaActual);
  let r = activa.r, c = activa.c;
  const lleno = (rr, cc) => {
    if (rr < 0 || cc < 0 || rr >= FILAS || cc >= COLS) return false;
    const v = hf.getCellValue({ sheet: hojaActual, row: rr, col: cc });
    return v !== null && v !== undefined && v !== '';
  };
  const maxPasos = 100000;
  if (lleno(r, c) && lleno(r + dr, c + dc)) {
    while (lleno(r + dr, c + dc)) { r += dr; c += dc; }
  } else {
    r += dr; c += dc;
    let pasos = 0;
    while (!lleno(r, c) && r >= 0 && c >= 0 && r < FILAS && c < COLS && pasos++ < maxPasos) { r += dr; c += dc; }
    if (!lleno(r, c)) {
      r = dr > 0 ? Math.min(FILAS - 1, Math.max(activa.r, dims.height - 1)) : dr < 0 ? 0 : activa.r;
      c = dc > 0 ? Math.min(COLS - 1, Math.max(activa.c, dims.width - 1)) : dc < 0 ? 0 : activa.c;
      if (dr > 0) r = FILAS - 1; if (dc > 0) c = COLS - 1;
    }
  }
  seleccionar(Math.max(0, Math.min(FILAS - 1, r)), Math.max(0, Math.min(COLS - 1, c)), false);
}

// ---------- Edición ----------
function empezarEdicion(inicial, seleccionarTodo) {
  if (editando) return;
  editando = true;
  $('estadoModo').textContent = 'Introducir';
  const x = offsetsCol[activa.c], y = offY(activa.r);
  editor.style.display = 'block';
  editor.style.left = (x - 1) + 'px';
  editor.style.top = (y - 1) + 'px';
  editor.style.width = Math.max(anchoCol(activa.c), 60) + 'px';
  editor.style.height = altoFila(activa.r) + 'px';
  const est = getEstilo(activa.r, activa.c) || {};
  editor.style.fontFamily = est.ff ? est.ff : 'Calibri';
  if (inicial !== undefined && inicial !== null) editor.value = inicial;
  else {
    let s = ''; try { s = hf.getCellSerialized({ sheet: hojaActual, row: activa.r, col: activa.c }); } catch (e) { }
    editor.value = (s === null || s === undefined) ? '' : String(s);
  }
  editor.focus();
  if (seleccionarTodo) editor.select();
  else editor.setSelectionRange(editor.value.length, editor.value.length);
  entradaFormula.value = editor.value;
  renderSeleccion();
}

function confirmarEdicion(mover) {
  if (!editando && !editandoEnBarra) return;
  const texto = editando ? editor.value : entradaFormula.value;
  cerrarEditor();
  aplicarValor(activa.r, activa.c, texto);
  if (mover === 'abajo') moverActiva(1, 0, false);
  else if (mover === 'arriba') moverActiva(-1, 0, false);
  else if (mover === 'derecha') moverActiva(0, 1, false);
  else if (mover === 'izquierda') moverActiva(0, -1, false);
  else render();
}
function cancelarEdicion() {
  cerrarEditor();
  render();
  viewport.focus();
}
function cerrarEditor() {
  editando = false; editandoEnBarra = false;
  editor.style.display = 'none'; editor.value = '';
  $('estadoModo').textContent = 'Listo';
}
function aplicarValor(r, c, texto) {
  try {
    const v = (texto === '') ? null : texto;
    hf.setCellContents({ sheet: hojaActual, row: r, col: c }, [[v]]);
    marcarModificado();
  } catch (e) {
    alert('No se pudo introducir el valor:\n' + e.message);
  }
}

// Insertar referencia al hacer clic mientras se edita una fórmula
function puedeInsertarRef() {
  const activo = editando ? editor : (editandoEnBarra ? entradaFormula : null);
  if (!activo) return false;
  const v = activo.value;
  if (!v.startsWith('=')) return false;
  return /[=+\-*/^&(;:<>,]$/.test(v);
}
function insertarRef(r, c) {
  const activo = editando ? editor : entradaFormula;
  activo.value += dirCelda(r, c);
  activo.focus();
}

// ---------- Eventos de ratón en la cuadrícula ----------
let arrastrando = false;
let arrastrandoRelleno = false;
let rellenoDestino = null;

function celdaEnEvento(e) {
  const rect = viewport.getBoundingClientRect();
  const x = e.clientX - rect.left + viewport.scrollLeft;
  const y = e.clientY - rect.top + viewport.scrollTop;
  const r = filaEnY(Math.max(0, Math.min(offsetsFila[FILAS] - 1, y)));
  const c = colEnX(Math.max(0, Math.min(offsetsCol[COLS] - 1, x)));
  return { r, c };
}

viewport.addEventListener('mousedown', (e) => {
  if (e.target === asaEl) return;
  if (e.button === 2) return; // menú contextual
  const { r, c } = celdaEnEvento(e);
  if ((editando || editandoEnBarra) && puedeInsertarRef()) { e.preventDefault(); insertarRef(r, c); return; }
  if (editando || editandoEnBarra) confirmarEdicion(null);
  arrastrando = true;
  seleccionar(r, c, e.shiftKey);
  viewport.focus();
  e.preventDefault();
});

asaEl.addEventListener('mousedown', (e) => {
  arrastrandoRelleno = true;
  rellenoDestino = null;
  e.preventDefault();
  e.stopPropagation();
});

window.addEventListener('mousemove', (e) => {
  if (arrastrando) {
    const { r, c } = celdaEnEvento(e);
    sel.r2 = r; sel.c2 = c;
    render();
  } else if (arrastrandoRelleno) {
    const { r, c } = celdaEnEvento(e);
    const n = selNorm();
    // Solo hacia abajo o hacia la derecha (lo más habitual)
    if (r > n.r2) rellenoDestino = { tipo: 'abajo', hasta: r };
    else if (c > n.c2) rellenoDestino = { tipo: 'derecha', hasta: c };
    else rellenoDestino = null;
    dibujarPrevisualizacionRelleno();
  }
});

window.addEventListener('mouseup', () => {
  if (arrastrando) arrastrando = false;
  if (arrastrandoRelleno) {
    arrastrandoRelleno = false;
    if (rellenoDestino) ejecutarRelleno();
    rellenoDestino = null;
    render();
  }
});

function dibujarPrevisualizacionRelleno() {
  const n = selNorm();
  let r2 = n.r2, c2 = n.c2;
  if (rellenoDestino) {
    if (rellenoDestino.tipo === 'abajo') r2 = rellenoDestino.hasta;
    else c2 = rellenoDestino.hasta;
  }
  const x = offsetsCol[n.c1], y = offY(n.r1);
  selEl.style.left = x + 'px'; selEl.style.top = y + 'px';
  selEl.style.width = (offsetsCol[c2 + 1] - x - 1) + 'px';
  selEl.style.height = (offY(r2 + 1) - y - 1) + 'px';
}

function ejecutarRelleno() {
  const n = selNorm();
  const origen = {
    start: { sheet: hojaActual, row: n.r1, col: n.c1 },
    end: { sheet: hojaActual, row: n.r2, col: n.c2 }
  };
  const altoBloque = n.r2 - n.r1 + 1, anchoBloque = n.c2 - n.c1 + 1;
  try {
    if (rellenoDestino.tipo === 'abajo') {
      for (let r = n.r2 + 1; r <= rellenoDestino.hasta; r += altoBloque) {
        hf.copy(origen);
        hf.paste({ sheet: hojaActual, row: r, col: n.c1 });
      }
      sel.r2 = rellenoDestino.hasta;
      copiarEstilosRelleno(n, 'abajo', rellenoDestino.hasta);
    } else {
      for (let c = n.c2 + 1; c <= rellenoDestino.hasta; c += anchoBloque) {
        hf.copy(origen);
        hf.paste({ sheet: hojaActual, row: n.r1, col: c });
      }
      sel.c2 = rellenoDestino.hasta;
      copiarEstilosRelleno(n, 'derecha', rellenoDestino.hasta);
    }
    marcarModificado();
  } catch (e) { alert('No se pudo rellenar: ' + e.message); }
}
function copiarEstilosRelleno(n, tipo, hasta) {
  const m = meta();
  if (tipo === 'abajo') {
    const alto = n.r2 - n.r1 + 1;
    for (let r = n.r2 + 1; r <= hasta; r++)
      for (let c = n.c1; c <= n.c2; c++) {
        const src = m.estilos.get(claveEstilo(n.r1 + ((r - n.r1) % alto), c));
        if (src) m.estilos.set(claveEstilo(r, c), Object.assign({}, src)); else m.estilos.delete(claveEstilo(r, c));
      }
  } else {
    const ancho = n.c2 - n.c1 + 1;
    for (let c = n.c2 + 1; c <= hasta; c++)
      for (let r = n.r1; r <= n.r2; r++) {
        const src = m.estilos.get(claveEstilo(r, n.c1 + ((c - n.c1) % ancho)));
        if (src) m.estilos.set(claveEstilo(r, c), Object.assign({}, src)); else m.estilos.delete(claveEstilo(r, c));
      }
  }
}

viewport.addEventListener('dblclick', (e) => {
  const { r, c } = celdaEnEvento(e);
  seleccionar(r, c, false);
  empezarEdicion(undefined, false);
});

viewport.addEventListener('scroll', () => requestAnimationFrame(render));
window.addEventListener('resize', () => render());

// ---------- Cabeceras: selección de filas/columnas y redimensionar ----------
let redimCol = null;

$('cabColumnas').addEventListener('mousedown', (e) => {
  const t = e.target;
  if (t.classList.contains('redim-col')) {
    redimCol = { c: parseInt(t.dataset.c, 10), x0: e.clientX, w0: anchoCol(parseInt(t.dataset.c, 10)) };
    e.preventDefault();
    return;
  }
  if (t.classList.contains('cab-col')) {
    const c = parseInt(t.dataset.c, 10);
    sel = { r1: 0, c1: c, r2: FILAS - 1, c2: c };
    activa = { r: 0, c }; ancla = { r: 0, c };
    render();
  }
});
$('cabColumnas').addEventListener('dblclick', (e) => {
  // Autoajustar ancho de columna al contenido visible
  if (!e.target.classList.contains('redim-col')) return;
  const c = parseInt(e.target.dataset.c, 10);
  const dims = hf.getSheetDimensions(hojaActual);
  let max = 40;
  const lienzo = document.createElement('canvas').getContext('2d');
  lienzo.font = '13px Calibri';
  for (let r = 0; r < Math.min(dims.height, 1000); r++) {
    const t = textoCelda(r, c).texto;
    if (t) max = Math.max(max, lienzo.measureText(t).width + 14);
  }
  meta().anchos[c] = Math.min(400, Math.ceil(max));
  recalcularOffsets(); render(); marcarModificado();
});
window.addEventListener('mousemove', (e) => {
  if (redimCol) {
    meta().anchos[redimCol.c] = Math.max(28, redimCol.w0 + e.clientX - redimCol.x0);
    recalcularOffsets(); render();
  }
});
window.addEventListener('mouseup', () => { if (redimCol) { redimCol = null; marcarModificado(); } });

$('cabFilas').addEventListener('mousedown', (e) => {
  if (!e.target.classList.contains('cab-fila')) return;
  const r = parseInt(e.target.dataset.r, 10);
  sel = { r1: r, c1: 0, r2: r, c2: COLS - 1 };
  activa = { r, c: 0 }; ancla = { r, c: 0 };
  render();
});
$('esquina').addEventListener('mousedown', () => {
  sel = { r1: 0, c1: 0, r2: FILAS - 1, c2: COLS - 1 };
  render();
});

// ---------- Teclado ----------
document.addEventListener('keydown', (e) => {
  const activo = document.activeElement;
  const enInput = activo && (activo.tagName === 'INPUT' || activo.tagName === 'SELECT' ||
    activo.tagName === 'TEXTAREA' || activo.isContentEditable);
  const enEditor = activo === editor;
  const enBarra = activo === entradaFormula;

  // Diálogos abiertos: no interferir
  if (!$('dialogoFx').classList.contains('oculto') || !$('dialogoBuscar').classList.contains('oculto')) {
    if (e.key === 'Escape') { cerrarDialogos(); }
    return;
  }

  if (enEditor || enBarra) {
    if (e.key === 'Enter') { e.preventDefault(); confirmarEdicion(e.shiftKey ? 'arriba' : 'abajo'); viewport.focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); confirmarEdicion(e.shiftKey ? 'izquierda' : 'derecha'); viewport.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelarEdicion(); }
    return;
  }
  if (enInput) return; // cuadro de nombre, selects...

  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl) {
    switch (e.key.toLowerCase()) {
      case 'n': e.preventDefault(); alternarEstilo('b'); return;
      case 'k': e.preventDefault(); alternarEstilo('i'); return;
      case 's': e.preventDefault(); alternarEstilo('u'); return;
      case 'e': e.preventDefault(); sel = { r1: 0, c1: 0, r2: FILAS - 1, c2: COLS - 1 }; render(); return;
      case 'home': e.preventDefault(); seleccionar(0, 0, false); return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); saltoCtrl(1, 0); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); saltoCtrl(-1, 0); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); saltoCtrl(0, -1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); saltoCtrl(0, 1); return; }
    return;
  }

  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); moverActiva(1, 0, e.shiftKey); return;
    case 'ArrowUp': e.preventDefault(); moverActiva(-1, 0, e.shiftKey); return;
    case 'ArrowLeft': e.preventDefault(); moverActiva(0, -1, e.shiftKey); return;
    case 'ArrowRight': e.preventDefault(); moverActiva(0, 1, e.shiftKey); return;
    case 'Enter': e.preventDefault(); moverActiva(e.shiftKey ? -1 : 1, 0, false); return;
    case 'Tab': e.preventDefault(); moverActiva(0, e.shiftKey ? -1 : 1, false); return;
    case 'Home': e.preventDefault(); seleccionar(activa.r, 0, false); return;
    case 'PageDown': e.preventDefault(); moverActiva(Math.floor(viewport.clientHeight / ALTO_FILA), 0, e.shiftKey); return;
    case 'PageUp': e.preventDefault(); moverActiva(-Math.floor(viewport.clientHeight / ALTO_FILA), 0, e.shiftKey); return;
    case 'Delete': case 'Backspace': e.preventDefault(); borrarContenido(); return;
    case 'F2': e.preventDefault(); empezarEdicion(undefined, false); return;
    case 'Escape': return;
  }

  // Empezar a escribir directamente (como Excel)
  if (e.key.length === 1 && !e.altKey) {
    empezarEdicion(e.key, false);
    e.preventDefault();
  }
});

function borrarContenido() {
  const n = selNorm();
  const filasV = [];
  for (let r = n.r1; r <= n.r2; r++) filasV.push(new Array(n.c2 - n.c1 + 1).fill(null));
  try { hf.setCellContents({ sheet: hojaActual, row: n.r1, col: n.c1 }, filasV); marcarModificado(); } catch (e) { }
  render();
}

// ---------- Estilos / barra de herramientas ----------
function aplicarEstiloSel(cambios) {
  const n = selNorm();
  const r2 = Math.min(n.r2, FILAS - 1), c2 = Math.min(n.c2, COLS - 1);
  for (let r = n.r1; r <= r2; r++)
    for (let c = n.c1; c <= c2; c++) setEstilo(r, c, cambios);
  marcarModificado();
  render();
  viewport.focus();
}
function alternarEstilo(prop) {
  const est = getEstilo(activa.r, activa.c) || {};
  aplicarEstiloSel({ [prop]: est[prop] ? null : 1 });
}

$('btnNegrita').onclick = () => alternarEstilo('b');
$('btnCursiva').onclick = () => alternarEstilo('i');
$('btnSubrayado').onclick = () => alternarEstilo('u');
$('btnAjustar').onclick = () => alternarEstilo('wrap');
$('btnBordes').onclick = () => alternarEstilo('bd');
$('alignIzq').onclick = () => aplicarEstiloSel({ al: 'left' });
$('alignCentro').onclick = () => aplicarEstiloSel({ al: 'center' });
$('alignDer').onclick = () => aplicarEstiloSel({ al: 'right' });
$('btnSinFormato').onclick = () => {
  const n = selNorm();
  for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) meta().estilos.delete(claveEstilo(r, c));
  marcarModificado(); render();
};
$('selFuente').onchange = (e) => aplicarEstiloSel({ ff: e.target.value });
$('selTamano').onchange = (e) => aplicarEstiloSel({ fs: parseInt(e.target.value, 10) });
$('colorTexto').oninput = (e) => { $('iconoColorTexto').style.borderBottomColor = e.target.value; aplicarEstiloSel({ c: e.target.value }); };
$('colorFondo').oninput = (e) => { $('iconoColorFondo').style.borderBottomColor = e.target.value; aplicarEstiloSel({ bg: e.target.value }); };
$('selFormato').onchange = (e) => aplicarEstiloSel({ fmt: e.target.value });
$('btnMoneda').onclick = () => aplicarEstiloSel({ fmt: 'moneda' });
$('btnPorcentaje').onclick = () => aplicarEstiloSel({ fmt: 'porcentaje' });
$('btnMiles').onclick = () => aplicarEstiloSel({ fmt: 'numero' });
$('btnMasDec').onclick = () => {
  const est = getEstilo(activa.r, activa.c) || {};
  aplicarEstiloSel({ dec: Math.min(10, (est.dec !== undefined ? est.dec : 2) + 1) });
};
$('btnMenosDec').onclick = () => {
  const est = getEstilo(activa.r, activa.c) || {};
  aplicarEstiloSel({ dec: Math.max(0, (est.dec !== undefined ? est.dec : 2) - 1) });
};
$('btnDeshacer').onclick = () => deshacer();
$('btnRehacer').onclick = () => rehacer();
$('btnCortar').onclick = () => cortar();
$('btnCopiar').onclick = () => copiar();
$('btnPegar').onclick = () => pegar();
$('btnFx').onclick = () => abrirDialogoFx();
$('btnFx2').onclick = () => abrirDialogoFx();
$('btnInsFila').onclick = () => insertarFilas(selNorm().r1, 1);
$('btnInsCol').onclick = () => insertarColumnas(selNorm().c1, 1);
$('btnElimFila').onclick = () => eliminarFilas();
$('btnElimCol').onclick = () => eliminarColumnas();

$('btnAutosuma').onclick = () => autosuma();
function autosuma() {
  const r = activa.r, c = activa.c;
  const esNum = (rr, cc) => typeof hf.getCellValue({ sheet: hojaActual, row: rr, col: cc }) === 'number';
  let formula = '=SUMA()';
  if (r > 0 && esNum(r - 1, c)) {
    let r0 = r - 1;
    while (r0 > 0 && esNum(r0 - 1, c)) r0--;
    formula = `=SUMA(${dirCelda(r0, c)}:${dirCelda(r - 1, c)})`;
    aplicarValor(r, c, formula); moverActiva(1, 0, false); return;
  }
  if (c > 0 && esNum(r, c - 1)) {
    let c0 = c - 1;
    while (c0 > 0 && esNum(r, c0 - 1)) c0--;
    formula = `=SUMA(${dirCelda(r, c0)}:${dirCelda(r, c - 1)})`;
    aplicarValor(r, c, formula); moverActiva(0, 1, false); return;
  }
  empezarEdicion('=SUMA(', false);
}

// ---------- Deshacer / Rehacer ----------
function deshacer() {
  if (hayInputActivo()) { document.execCommand('undo'); return; }
  try { if (hf.isThereSomethingToUndo()) { hf.undo(); marcarModificado(); render(); } } catch (e) { }
}
function rehacer() {
  if (hayInputActivo()) { document.execCommand('redo'); return; }
  try { if (hf.isThereSomethingToRedo()) { hf.redo(); marcarModificado(); render(); } } catch (e) { }
}

// ---------- Portapapeles ----------
function rangoSel() {
  const n = selNorm();
  return {
    start: { sheet: hojaActual, row: n.r1, col: n.c1 },
    end: { sheet: hojaActual, row: Math.min(n.r2, FILAS - 1), col: Math.min(n.c2, COLS - 1) }
  };
}
function tsvDeSeleccion() {
  const n = selNorm();
  const filas = [];
  for (let r = n.r1; r <= n.r2; r++) {
    const cols = [];
    for (let c = n.c1; c <= n.c2; c++) {
      const v = hf.getCellValue({ sheet: hojaActual, row: r, col: c });
      if (v === null || v === undefined) cols.push('');
      else if (typeof v === 'object' && v.value !== undefined) cols.push(String(v.value));
      else cols.push(String(v));
    }
    filas.push(cols.join('\t'));
  }
  return filas.join('\n');
}
function copiarTextoInput(cortarlo) {
  const a = document.activeElement;
  if (a.value === undefined) { document.execCommand(cortarlo ? 'cut' : 'copy'); return; }
  const ini = a.selectionStart, fin = a.selectionEnd;
  if (ini === fin) return;
  clipboard.writeText(a.value.substring(ini, fin));
  if (cortarlo) {
    a.value = a.value.substring(0, ini) + a.value.substring(fin);
    a.setSelectionRange(ini, ini);
  }
}
function pegarTextoInput() {
  const a = document.activeElement;
  const t = clipboard.readText();
  if (!t) return;
  if (a.value === undefined) { document.execCommand('insertText', false, t); return; }
  const ini = a.selectionStart, fin = a.selectionEnd;
  a.value = a.value.substring(0, ini) + t + a.value.substring(fin);
  a.setSelectionRange(ini + t.length, ini + t.length);
  if (a === editor) entradaFormula.value = editor.value;
}
function copiar() {
  if (hayInputActivo()) { copiarTextoInput(false); return; }
  try {
    hf.copy(rangoSel());
    hayCopiaInterna = true;
    ultimoTSVCopiado = tsvDeSeleccion();
    clipboard.writeText(ultimoTSVCopiado);
  } catch (e) { }
}
function cortar() {
  if (hayInputActivo()) { copiarTextoInput(true); return; }
  try {
    hf.cut(rangoSel());
    hayCopiaInterna = true;
    ultimoTSVCopiado = tsvDeSeleccion();
    clipboard.writeText(ultimoTSVCopiado);
  } catch (e) { }
}
function pegar() {
  if (hayInputActivo()) { pegarTextoInput(); return; }
  const textoSistema = clipboard.readText();
  try {
    if (hayCopiaInterna && !hf.isClipboardEmpty() && textoSistema === ultimoTSVCopiado) {
      hf.paste({ sheet: hojaActual, row: selNorm().r1, col: selNorm().c1 });
      marcarModificado(); render();
      return;
    }
  } catch (e) { }
  // Pegar texto del sistema (TSV / CSV)
  if (!textoSistema) return;
  const filas = textoSistema.replace(/\r/g, '').split('\n');
  if (filas.length && filas[filas.length - 1] === '') filas.pop();
  const matriz = filas.map(f => f.split('\t').map(x => x === '' ? null : x));
  const n = selNorm();
  try {
    hf.setCellContents({ sheet: hojaActual, row: n.r1, col: n.c1 }, matriz);
    sel = { r1: n.r1, c1: n.c1, r2: Math.min(FILAS - 1, n.r1 + matriz.length - 1), c2: Math.min(COLS - 1, n.c1 + (matriz[0] ? matriz[0].length : 1) - 1) };
    marcarModificado(); render();
  } catch (e) { alert('No se pudo pegar: ' + e.message); }
}
function hayInputActivo() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
}

// ---------- Insertar / eliminar filas y columnas ----------
function desplazarEstilos(eje, indice, cantidad) {
  const m = meta();
  const nuevo = new Map();
  for (const [k, v] of m.estilos) {
    let [r, c] = k.split(',').map(Number);
    if (eje === 'fila') {
      if (r >= indice) r += cantidad;
      if (r < indice && cantidad < 0) { /* sin cambio */ }
      if (cantidad < 0 && r >= indice && r < indice - cantidad) continue; // eliminada
    } else {
      if (c >= indice) c += cantidad;
      if (cantidad < 0 && c >= indice && c < indice - cantidad) continue;
    }
    if (r >= 0 && c >= 0) nuevo.set(r + ',' + c, v);
  }
  m.estilos = nuevo;
}
function insertarFilas(donde, cuantas) {
  try {
    hf.addRows(hojaActual, [donde, cuantas]);
    desplazarEstilos('fila', donde, cuantas);
    marcarModificado(); render();
  } catch (e) { alert(e.message); }
}
function insertarColumnas(donde, cuantas) {
  try {
    hf.addColumns(hojaActual, [donde, cuantas]);
    desplazarEstilos('col', donde, cuantas);
    // desplazar anchos
    const m = meta(); const nuevos = {};
    for (const k of Object.keys(m.anchos)) {
      const c = parseInt(k, 10);
      nuevos[c >= donde ? c + cuantas : c] = m.anchos[k];
    }
    m.anchos = nuevos;
    recalcularOffsets(); marcarModificado(); render();
  } catch (e) { alert(e.message); }
}
function eliminarFilas() {
  const n = selNorm();
  const cuantas = n.r2 - n.r1 + 1;
  try {
    hf.removeRows(hojaActual, [n.r1, cuantas]);
    // eliminar estilos de las filas borradas y desplazar el resto
    const m = meta(); const nuevo = new Map();
    for (const [k, v] of m.estilos) {
      let [r, c] = k.split(',').map(Number);
      if (r >= n.r1 && r <= n.r2) continue;
      if (r > n.r2) r -= cuantas;
      nuevo.set(r + ',' + c, v);
    }
    m.estilos = nuevo;
    seleccionar(n.r1, activa.c, false);
    marcarModificado(); render();
  } catch (e) { alert(e.message); }
}
function eliminarColumnas() {
  const n = selNorm();
  const cuantas = n.c2 - n.c1 + 1;
  try {
    hf.removeColumns(hojaActual, [n.c1, cuantas]);
    const m = meta(); const nuevo = new Map(); const nuevosAnchos = {};
    for (const [k, v] of m.estilos) {
      let [r, c] = k.split(',').map(Number);
      if (c >= n.c1 && c <= n.c2) continue;
      if (c > n.c2) c -= cuantas;
      nuevo.set(r + ',' + c, v);
    }
    for (const k of Object.keys(m.anchos)) {
      const c = parseInt(k, 10);
      if (c >= n.c1 && c <= n.c2) continue;
      nuevosAnchos[c > n.c2 ? c - cuantas : c] = m.anchos[k];
    }
    m.estilos = nuevo; m.anchos = nuevosAnchos;
    recalcularOffsets();
    seleccionar(activa.r, n.c1, false);
    marcarModificado(); render();
  } catch (e) { alert(e.message); }
}

// ---------- Menú contextual ----------
const menuCtx = $('menuContextual');
viewport.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const { r, c } = celdaEnEvento(e);
  const n = selNorm();
  if (r < n.r1 || r > n.r2 || c < n.c1 || c > n.c2) seleccionar(r, c, false);
  menuCtx.classList.remove('oculto');
  menuCtx.style.left = Math.min(e.clientX, window.innerWidth - 240) + 'px';
  menuCtx.style.top = Math.min(e.clientY, window.innerHeight - 320) + 'px';
});
document.addEventListener('mousedown', (e) => {
  if (!menuCtx.contains(e.target)) menuCtx.classList.add('oculto');
});
menuCtx.addEventListener('click', (e) => {
  const item = e.target.closest('.mc-item');
  if (!item) return;
  menuCtx.classList.add('oculto');
  const n = selNorm();
  switch (item.dataset.accion) {
    case 'cortar': cortar(); break;
    case 'copiar': copiar(); break;
    case 'pegar': pegar(); break;
    case 'insFilaArriba': insertarFilas(n.r1, n.r2 - n.r1 + 1); break;
    case 'insFilaAbajo': insertarFilas(n.r2 + 1, n.r2 - n.r1 + 1); break;
    case 'insColIzq': insertarColumnas(n.c1, n.c2 - n.c1 + 1); break;
    case 'insColDer': insertarColumnas(n.c2 + 1, n.c2 - n.c1 + 1); break;
    case 'elimFilas': eliminarFilas(); break;
    case 'elimCols': eliminarColumnas(); break;
    case 'limpiarContenido': borrarContenido(); break;
    case 'limpiarFormato': $('btnSinFormato').onclick(); break;
  }
});

// ---------- Barra de fórmulas y cuadro de nombre ----------
entradaFormula.addEventListener('focus', () => { editandoEnBarra = true; $('estadoModo').textContent = 'Introducir'; });
entradaFormula.addEventListener('blur', () => {
  if (editandoEnBarra) { editandoEnBarra = false; $('estadoModo').textContent = 'Listo'; }
});
$('btnAceptarEdicion').onclick = () => { confirmarEdicion(null); viewport.focus(); };
$('btnCancelarEdicion').onclick = () => { cancelarEdicion(); actualizarBarraFormula(); };

cuadroNombre.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const ref = parseRef(cuadroNombre.value);
    if (ref) { seleccionar(ref.r, ref.c, false); viewport.focus(); }
    else cuadroNombre.value = dirCelda(activa.r, activa.c);
  }
});

editor.addEventListener('input', () => { entradaFormula.value = editor.value; });

// ---------- Hojas ----------
function renderHojas() {
  const cont = $('pestanasHojas');
  cont.innerHTML = '';
  for (const nombre of hf.getSheetNames()) {
    const id = hf.getSheetId(nombre);
    const div = document.createElement('div');
    div.className = 'pestana-hoja' + (id === hojaActual ? ' activa' : '');
    div.textContent = nombre;
    div.onclick = () => { if (id !== hojaActual) { hojaActual = id; seleccionar(0, 0, false); recalcularOffsets(); render(); renderHojas(); } };
    div.ondblclick = () => renombrarHoja(id, div);
    div.oncontextmenu = (e) => {
      e.preventDefault();
      if (hf.getSheetNames().length <= 1) return;
      if (confirm(`¿Eliminar la hoja "${nombre}"?`)) {
        hf.removeSheet(id);
        delete metaHojas[id];
        hojaActual = hf.getSheetId(hf.getSheetNames()[0]);
        seleccionar(0, 0, false); recalcularOffsets(); render(); renderHojas(); marcarModificado();
      }
    };
    cont.appendChild(div);
  }
}
function renombrarHoja(id, div) {
  const input = document.createElement('input');
  input.value = hf.getSheetName(id);
  input.style.width = '90px';
  div.textContent = ''; div.appendChild(input); input.focus(); input.select();
  const terminar = (aplicar) => {
    if (aplicar && input.value.trim()) {
      try { hf.renameSheet(id, input.value.trim()); marcarModificado(); } catch (e) { alert('Nombre no válido o duplicado.'); }
    }
    renderHojas();
  };
  input.onblur = () => terminar(true);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { input.onblur = null; terminar(true); }
    if (e.key === 'Escape') { input.onblur = null; terminar(false); }
    e.stopPropagation();
  };
}
function nuevaHoja() {
  let i = hf.getSheetNames().length + 1;
  while (hf.getSheetNames().includes('Hoja' + i)) i++;
  const nombre = hf.addSheet('Hoja' + i);
  hojaActual = hf.getSheetId(nombre);
  seleccionar(0, 0, false); recalcularOffsets(); render(); renderHojas(); marcarModificado();
}
$('btnNuevaHoja').onclick = nuevaHoja;

// ---------- Diálogo Insertar función ----------
let fxSeleccionada = null;
function abrirDialogoFx() {
  $('dialogoFx').classList.remove('oculto');
  const selCat = $('categoriaFx');
  if (selCat.options.length <= 1) {
    for (const cat of FX_CATEGORIAS) {
      const o = document.createElement('option'); o.value = cat; o.textContent = cat; selCat.appendChild(o);
    }
  }
  $('buscarFx').value = '';
  filtrarFx();
  $('buscarFx').focus();
}
function listaFunciones() {
  return hf.getRegisteredFunctionNames()
    .filter(n => n && !n.startsWith('HF.'))
    .sort((a, b) => a.localeCompare(b, 'es'));
}
function filtrarFx() {
  const q = $('buscarFx').value.trim().toUpperCase();
  const cat = $('categoriaFx').value;
  const cont = $('listaFx');
  cont.innerHTML = '';
  fxSeleccionada = null;
  $('descFx').innerHTML = 'Seleccione una función para ver su descripción.';
  for (const nombre of listaFunciones()) {
    const info = FX_INFO[nombre];
    const categoria = info ? info[0] : 'Otras';
    if (q && !nombre.toUpperCase().includes(q)) continue;
    if (cat && categoria !== cat) continue;
    const div = document.createElement('div');
    div.className = 'fx-item';
    div.textContent = nombre;
    div.onclick = () => {
      cont.querySelectorAll('.fx-item.sel').forEach(x => x.classList.remove('sel'));
      div.classList.add('sel');
      fxSeleccionada = nombre;
      $('descFx').innerHTML = `<b>${nombre}</b> — ${categoria}<br>${info ? info[1] : 'Función disponible en el motor de cálculo.'}`;
    };
    div.ondblclick = () => { fxSeleccionada = nombre; aceptarFx(); };
    cont.appendChild(div);
  }
}
function aceptarFx() {
  if (!fxSeleccionada) return;
  cerrarDialogos();
  const activo = editando ? editor : (editandoEnBarra ? entradaFormula : null);
  if (activo && activo.value.startsWith('=')) {
    activo.value += fxSeleccionada + '(';
    activo.focus();
  } else {
    empezarEdicion('=' + fxSeleccionada + '(', false);
  }
}
$('buscarFx').addEventListener('input', filtrarFx);
$('categoriaFx').addEventListener('change', filtrarFx);
$('aceptarFx').onclick = aceptarFx;
$('cancelarFx').onclick = () => cerrarDialogos();
$('cerrarFx').onclick = () => cerrarDialogos();

function cerrarDialogos() {
  $('dialogoFx').classList.add('oculto');
  $('dialogoBuscar').classList.add('oculto');
}

// ---------- Buscar ----------
let ultimaBusqueda = { r: -1, c: 0 };
function abrirBuscar() {
  $('dialogoBuscar').classList.remove('oculto');
  $('textoBuscar').focus(); $('textoBuscar').select();
}
function buscarSiguiente() {
  const q = $('textoBuscar').value.trim().toLowerCase();
  if (!q) return;
  const dims = hf.getSheetDimensions(hojaActual);
  const totalCeldas = dims.height * dims.width;
  let idx = (ultimaBusqueda.r >= 0) ? ultimaBusqueda.r * dims.width + ultimaBusqueda.c + 1 : 0;
  for (let paso = 0; paso < totalCeldas; paso++, idx++) {
    const i = idx % totalCeldas;
    const r = Math.floor(i / dims.width), c = i % dims.width;
    const info = textoCelda(r, c);
    if (info.texto && info.texto.toLowerCase().includes(q)) {
      ultimaBusqueda = { r, c };
      seleccionar(r, c, false);
      $('resultadoBuscar').textContent = `Encontrado en ${dirCelda(r, c)}`;
      return;
    }
  }
  $('resultadoBuscar').textContent = 'No se encontraron coincidencias.';
  ultimaBusqueda = { r: -1, c: 0 };
}
$('btnBuscarSig').onclick = buscarSiguiente;
$('textoBuscar').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarSiguiente(); });
$('cerrarBuscar').onclick = () => cerrarDialogos();
$('btnCerrarBuscar2').onclick = () => cerrarDialogos();

// ---------- Archivos ----------
const FILTRO_CALC = [{ name: 'Libro de Calcular', extensions: ['calc'] }];
const FILTRO_TODOS = [
  { name: 'Todos los compatibles', extensions: ['calc', 'xlsx', 'csv'] },
  { name: 'Libro de Calcular', extensions: ['calc'] },
  { name: 'Libro de Excel', extensions: ['xlsx'] },
  { name: 'CSV', extensions: ['csv'] }
];

function serializarLibro() {
  const hojas = [];
  for (const nombre of hf.getSheetNames()) {
    const id = hf.getSheetId(nombre);
    const m = metaHojas[id] || { estilos: new Map(), anchos: {} };
    hojas.push({
      nombre,
      datos: hf.getSheetSerialized(id),
      estilos: Object.fromEntries(m.estilos || new Map()),
      anchos: m.anchos || {},
      altos: m.altos || {},
      ocultas: m.ocultas || {},
      combinadas: m.combinadas || [],
      condicionales: m.condicionales || []
    });
  }
  return JSON.stringify({ app: 'Calcular', version: 2, hojaActiva: hf.getSheetName(hojaActual), hojas });
}
function cargarLibro(json) {
  const doc = JSON.parse(json);
  if (!doc.hojas || !doc.hojas.length) throw new Error('Archivo no válido.');
  const hojas = {};
  for (const h of doc.hojas) hojas[h.nombre] = h.datos || [];
  crearHF(hojas);
  metaHojas = {};
  for (const h of doc.hojas) {
    const id = hf.getSheetId(h.nombre);
    metaHojas[id] = {
      estilos: new Map(Object.entries(h.estilos || {})),
      anchos: h.anchos || {},
      altos: h.altos || {},
      ocultas: h.ocultas || {},
      combinadas: h.combinadas || [],
      condicionales: h.condicionales || []
    };
  }
  invalidarCacheCond();
  const act = doc.hojaActiva && hf.getSheetId(doc.hojaActiva) !== undefined ? hf.getSheetId(doc.hojaActiva) : hf.getSheetId(hf.getSheetNames()[0]);
  hojaActual = act;
  seleccionar(0, 0, false);
  recalcularOffsets(); render(); renderHojas();
}

async function accionNuevo() {
  if (modificado) {
    const r = await ipcRenderer.invoke('mensaje', {
      type: 'question', buttons: ['Guardar', 'No guardar', 'Cancelar'], defaultId: 0, cancelId: 2,
      title: 'Calcular', message: '¿Desea guardar los cambios del libro actual?'
    });
    if (r === 2) return;
    if (r === 0) { const ok = await accionGuardar(); if (!ok) return; }
  }
  crearHF(null);
  metaHojas = {};
  archivoActual = null;
  seleccionar(0, 0, false);
  recalcularOffsets(); render(); renderHojas();
  limpiarModificado();
}

async function accionAbrir() {
  const ruta = await ipcRenderer.invoke('dialogo-abrir', {
    title: 'Abrir', filters: FILTRO_TODOS, properties: ['openFile']
  });
  if (!ruta) return;
  await abrirRuta(ruta);
}

async function abrirRuta(ruta) {
  try {
    const ext = path.extname(ruta).toLowerCase();
    if (ext === '.calc') {
      cargarLibro(fs.readFileSync(ruta, 'utf8'));
      archivoActual = ruta;
    } else if (ext === '.csv') {
      importarCSVRuta(ruta);
      archivoActual = null;
    } else if (ext === '.xlsx') {
      await importarXLSX(ruta);
      archivoActual = null;
    } else {
      alert('Formato no compatible: ' + ext);
      return;
    }
    limpiarModificado();
    if (archivoActual === null) marcarModificado();
    actualizarTitulo();
  } catch (e) {
    alert('No se pudo abrir el archivo:\n' + e.message);
  }
}

async function accionGuardar() {
  if (!archivoActual || path.extname(archivoActual).toLowerCase() !== '.calc') return accionGuardarComo();
  try {
    fs.writeFileSync(archivoActual, serializarLibro(), 'utf8');
    limpiarModificado();
    return true;
  } catch (e) { alert('No se pudo guardar:\n' + e.message); return false; }
}

async function accionGuardarComo() {
  const ruta = await ipcRenderer.invoke('dialogo-guardar', {
    title: 'Guardar como',
    defaultPath: archivoActual || 'Libro1.calc',
    filters: [
      { name: 'Libro de Calcular', extensions: ['calc'] },
      { name: 'Libro de Excel (solo valores)', extensions: ['xlsx'] }
    ]
  });
  if (!ruta) return false;
  try {
    if (path.extname(ruta).toLowerCase() === '.xlsx') {
      await exportarXLSX(ruta);
      alert('Exportado a Excel (solo valores calculados; las fórmulas y formatos se guardan en formato .calc).');
      return true;
    }
    fs.writeFileSync(ruta, serializarLibro(), 'utf8');
    archivoActual = ruta;
    limpiarModificado();
    return true;
  } catch (e) { alert('No se pudo guardar:\n' + e.message); return false; }
}

// --- CSV ---
function importarCSVRuta(ruta) {
  const texto = fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '');
  const lineas = texto.replace(/\r/g, '').split('\n');
  if (lineas.length && lineas[lineas.length - 1] === '') lineas.pop();
  // detectar separador
  const primera = lineas[0] || '';
  const sep = (primera.match(/;/g) || []).length >= (primera.match(/,/g) || []).length ? ';' : ',';
  const matriz = lineas.map(l => parsearLineaCSV(l, sep).map(x => x === '' ? null : x));
  crearHF({ [path.basename(ruta, '.csv').substring(0, 30) || 'Hoja1']: matriz });
  metaHojas = {};
  seleccionar(0, 0, false);
  recalcularOffsets(); render(); renderHojas();
}
function parsearLineaCSV(linea, sep) {
  const out = []; let cur = ''; let dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (dentro) {
      if (ch === '"') { if (linea[i + 1] === '"') { cur += '"'; i++; } else dentro = false; }
      else cur += ch;
    } else {
      if (ch === '"') dentro = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
async function accionImportarCSV() {
  const ruta = await ipcRenderer.invoke('dialogo-abrir', {
    title: 'Importar CSV', filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['openFile']
  });
  if (!ruta) return;
  try { importarCSVRuta(ruta); archivoActual = null; marcarModificado(); } catch (e) { alert(e.message); }
}
async function accionExportarCSV() {
  const ruta = await ipcRenderer.invoke('dialogo-guardar', {
    title: 'Exportar CSV', defaultPath: hf.getSheetName(hojaActual) + '.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (!ruta) return;
  try {
    const dims = hf.getSheetDimensions(hojaActual);
    const lineas = [];
    for (let r = 0; r < dims.height; r++) {
      const cols = [];
      for (let c = 0; c < dims.width; c++) {
        const info = textoCelda(r, c);
        let t = info.texto;
        if (/[";\n]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"';
        cols.push(t);
      }
      lineas.push(cols.join(';'));
    }
    fs.writeFileSync(ruta, '﻿' + lineas.join('\r\n'), 'utf8');
  } catch (e) { alert('No se pudo exportar:\n' + e.message); }
}

// --- XLSX (valores) ---
async function importarXLSX(ruta) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ruta);
  const hojas = {};
  wb.eachSheet((ws) => {
    const matriz = [];
    ws.eachRow({ includeEmpty: true }, (fila, numFila) => {
      const filaArr = [];
      fila.eachCell({ includeEmpty: true }, (celda, numCol) => {
        let v = celda.value;
        if (v === null || v === undefined) { filaArr[numCol - 1] = null; return; }
        if (typeof v === 'object') {
          if (v.result !== undefined) v = v.result;           // fórmula -> resultado
          else if (v.richText) v = v.richText.map(t => t.text).join('');
          else if (v.text !== undefined) v = v.text;          // hipervínculo
          else if (v.error) { filaArr[numCol - 1] = null; return; }
        }
        if (v instanceof Date) {
          const dd = String(v.getUTCDate()).padStart(2, '0');
          const mm = String(v.getUTCMonth() + 1).padStart(2, '0');
          v = `${dd}/${mm}/${v.getUTCFullYear()}`;
        }
        if (typeof v === 'number') filaArr[numCol - 1] = v;
        else filaArr[numCol - 1] = String(v);
      });
      matriz[numFila - 1] = filaArr;
    });
    // normalizar huecos (filas y celdas sin valor)
    for (let i = 0; i < matriz.length; i++) {
      if (!matriz[i]) { matriz[i] = []; continue; }
      for (let j = 0; j < matriz[i].length; j++) if (matriz[i][j] === undefined) matriz[i][j] = null;
    }
    hojas[ws.name] = matriz;
  });
  if (!Object.keys(hojas).length) throw new Error('El archivo no contiene hojas.');
  crearHF(hojas);
  metaHojas = {};
  seleccionar(0, 0, false);
  recalcularOffsets(); render(); renderHojas();
}
async function exportarXLSX(ruta) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  for (const nombre of hf.getSheetNames()) {
    const id = hf.getSheetId(nombre);
    const ws = wb.addWorksheet(nombre);
    const dims = hf.getSheetDimensions(id);
    for (let r = 0; r < dims.height; r++) {
      for (let c = 0; c < dims.width; c++) {
        let v = hf.getCellValue({ sheet: id, row: r, col: c });
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'object' && v.value !== undefined) v = String(v.value);
        let tipo = '';
        try { tipo = hf.getCellValueDetailedType({ sheet: id, row: r, col: c }); } catch (e) { }
        if (typeof v === 'number' && (tipo === 'NUMBER_DATE' || tipo === 'NUMBER_DATETIME')) {
          ws.getCell(r + 1, c + 1).value = serialAFecha(v);
        } else {
          ws.getCell(r + 1, c + 1).value = v;
        }
      }
    }
  }
  await wb.xlsx.writeFile(ruta);
}

// ---------- Menú de la aplicación (IPC) ----------
ipcRenderer.on('menu', async (_e, accion) => {
  switch (accion) {
    case 'nuevo': accionNuevo(); break;
    case 'abrir': accionAbrir(); break;
    case 'guardar': accionGuardar(); break;
    case 'guardarComo': accionGuardarComo(); break;
    case 'guardarYSalir': { const ok = await accionGuardar(); if (ok) ipcRenderer.send('salir-forzado'); break; }
    case 'importarCSV': accionImportarCSV(); break;
    case 'exportarCSV': accionExportarCSV(); break;
    case 'deshacer': deshacer(); break;
    case 'rehacer': rehacer(); break;
    case 'cortar': cortar(); break;
    case 'copiar': copiar(); break;
    case 'pegar': pegar(); break;
    case 'buscar': abrirBuscar(); break;
    case 'insertarFuncion': abrirDialogoFx(); break;
    case 'insertarFila': insertarFilas(selNorm().r1, 1); break;
    case 'insertarColumna': insertarColumnas(selNorm().c1, 1); break;
    case 'nuevaHoja': nuevaHoja(); break;
  }
});

// ---------- Inicio ----------
viewport.tabIndex = 0;
crearHF(null);
recalcularOffsets();
seleccionar(0, 0, false);
renderHojas();
render();
actualizarTitulo();
viewport.focus();
