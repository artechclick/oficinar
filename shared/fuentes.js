// ===== Oficinar - fuentes del sistema y autocorrección (compartido) =====

// Lista base por si el sistema no permite consultar las fuentes instaladas
const FUENTES_BASE = ['Calibri', 'Arial', 'Segoe UI', 'Times New Roman', 'Georgia', 'Verdana', 'Tahoma',
  'Trebuchet MS', 'Courier New', 'Consolas', 'Garamond', 'Palatino Linotype', 'Book Antiqua',
  'Comic Sans MS', 'Impact', 'Lucida Sans', 'Cambria', 'Candara', 'Franklin Gothic Medium',
  'Century Gothic', 'Bahnschrift', 'Segoe Print', 'Segoe Script', 'Sitka Text'];

// Rellena uno o varios <select> con todas las fuentes instaladas en el equipo.
// queryLocalFonts exige un gesto del usuario: si falla al inicio, se reintenta en el primer clic.
async function poblarFuentesSistema(selects, seleccionada) {
  const lista = Array.isArray(selects) ? selects : [selects];

  const aplicar = (familias) => {
    familias.sort((a, b) => a.localeCompare(b, 'es'));
    for (const sel of lista) {
      if (!sel) continue;
      const previa = seleccionada || sel.value;
      sel.innerHTML = familias.map(f =>
        `<option style="font-family:'${f.replace(/'/g, '')}'">${f}</option>`).join('');
      if (previa && familias.includes(previa)) sel.value = previa;
      else if (familias.includes('Calibri')) sel.value = 'Calibri';
      else if (familias.includes('Segoe UI')) sel.value = 'Segoe UI';
    }
  };

  const consultar = async () => {
    const fuentes = await window.queryLocalFonts();
    const set = new Set();
    for (const f of fuentes) set.add(f.family);
    if (set.size > 4) { aplicar([...set]); return true; }
    return false;
  };

  aplicar([...FUENTES_BASE]);
  if (typeof window.queryLocalFonts !== 'function') return;
  try {
    await consultar();
  } catch (e) {
    // Requiere activación del usuario: reintentar en la primera interacción
    const reintento = () => { consultar().catch(() => {}); };
    window.addEventListener('pointerdown', reintento, { once: true });
  }
}

// ---------- Autocorrección en español ----------
const AUTOCORRECCIONES = {
  'qeu': 'que', 'quue': 'que', 'qe': 'que', 'pq': 'porque', 'xq': 'porque',
  'teh': 'the', 'dle': 'del', 'lso': 'los', 'lsa': 'las', 'esat': 'esta', 'estan': 'están',
  'aqui': 'aquí', 'asi': 'así', 'mas': 'más', 'dia': 'día', 'dias': 'días',
  'tambien': 'también', 'despues': 'después', 'facil': 'fácil', 'dificil': 'difícil',
  'rapido': 'rápido', 'ultimo': 'último', 'numero': 'número', 'telefono': 'teléfono',
  'informacion': 'información', 'atencion': 'atención', 'direccion': 'dirección',
  'educacion': 'educación', 'administracion': 'administración', 'comunicacion': 'comunicación',
  'presentacion': 'presentación', 'organizacion': 'organización', 'produccion': 'producción',
  'solucion': 'solución', 'reunion': 'reunión', 'razon': 'razón', 'corazon': 'corazón',
  'anos': 'años', 'nino': 'niño', 'ninos': 'niños', 'manana': 'mañana', 'espanol': 'español',
  'compania': 'compañía', 'senor': 'señor', 'senora': 'señora',
  'ademas': 'además', 'quizas': 'quizás',
  'segun': 'según', 'traves': 'través', 'proximo': 'próximo', 'practica': 'práctica',
  'pagina': 'página', 'paginas': 'páginas', 'codigo': 'código', 'grafico': 'gráfico',
  'analisis': 'análisis', 'articulo': 'artículo', 'capitulo': 'capítulo', 'titulo': 'título',
  'musica': 'música', 'publico': 'público', 'medico': 'médico', 'unico': 'único',
  'economia': 'economía', 'energia': 'energía', 'tecnologia': 'tecnología', 'categoria': 'categoría'
};

// Corrige la palabra que se acaba de terminar de escribir en un elemento contenteditable.
// Devuelve true si corrigió algo. Mantiene mayúscula inicial si la palabra la tenía.
function autocorregirUltimaPalabra(opciones) {
  const conf = Object.assign({ capitalizar: true }, opciones);
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const nodo = sel.anchorNode;
  if (!nodo || nodo.nodeType !== 3) return false;
  const texto = nodo.textContent;
  const pos = sel.anchorOffset;
  // La palabra terminada está justo antes del separador que se acaba de escribir
  const antes = texto.slice(0, pos).replace(/[\s .,;:!?]+$/, '');
  const m = /([\p{L}]+)$/u.exec(antes);
  let cambio = false;

  if (m) {
    const palabra = m[1];
    const clave = palabra.toLowerCase();
    let reemplazo = AUTOCORRECCIONES[clave];
    if (reemplazo && palabra !== reemplazo) {
      if (palabra[0] === palabra[0].toUpperCase()) {
        reemplazo = reemplazo[0].toUpperCase() + reemplazo.slice(1);
      }
      const ini = antes.length - palabra.length;
      nodo.textContent = texto.slice(0, ini) + reemplazo + texto.slice(ini + palabra.length);
      const nuevaPos = pos + (reemplazo.length - palabra.length);
      const r = document.createRange();
      r.setStart(nodo, Math.min(nuevaPos, nodo.textContent.length));
      r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
      cambio = true;
    }
  }

  // Mayúscula al inicio de oración: ". palabra" -> ". Palabra"
  if (conf.capitalizar) {
    const t = nodo.textContent;
    const cursorActual = cambio ? nuevaPos : pos;
    const antes2 = t.slice(0, cursorActual);
    const m2 = /(^|[.!?]\s+)([a-záéíóúñ])([\p{L}]*)([\s ]*)$/u.exec(antes2);
    if (m2 && m2[2]) {
      const idx = antes2.length - m2[4].length - m2[3].length - 1;
      nodo.textContent = t.slice(0, idx) + m2[2].toUpperCase() + t.slice(idx + 1);
      const r = document.createRange();
      r.setStart(nodo, Math.min(cursorActual, nodo.textContent.length)); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
      cambio = true;
    }
  }
  return cambio;
}

// Conecta la autocorrección a un elemento contenteditable (se dispara con espacio, Enter o puntuación)
function conectarAutocorreccion(elemento, estaActiva) {
  elemento.addEventListener('keydown', (e) => {
    if (typeof estaActiva === 'function' && !estaActiva()) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === '.' || e.key === ',' || e.key === ';') {
      // Corregir lo escrito hasta ahora (antes de insertar el separador)
      setTimeout(() => autocorregirUltimaPalabra({ capitalizar: true }), 0);
    }
  });
}
