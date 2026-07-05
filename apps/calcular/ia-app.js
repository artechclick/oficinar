// ===== Calcular - integración con el Asistente IA de Oficinar =====
// Usa las variables/funciones globales de renderer.js: hf, hojaActual, activa, aplicarValor, render, dirCelda

window.IA_APP = {
  nombre: 'Calcular (hoja de cálculo)',
  etiquetaInsertar: 'Insertar en la hoja',
  instrucciones:
    'El documento es una hoja de cálculo. Cuando generes tablas o datos para insertar, ' +
    'responde en formato TSV (columnas separadas por tabulaciones, filas por saltos de línea), sin markdown ni ``` . ' +
    'Las fórmulas usan nombres en español y ";" como separador de argumentos, por ejemplo =SUMA(A1:A10).',

  obtenerContexto() {
    try {
      const nombre = hf.getSheetName(hojaActual);
      const valores = hf.getSheetValues(hojaActual) || [];
      const lineas = [];
      const maxFilas = Math.min(valores.length, 500);
      for (let r = 0; r < maxFilas; r++) {
        const fila = valores[r] || [];
        lineas.push(fila.map(v => (v === null || v === undefined) ? '' : String(v)).join('\t'));
      }
      let csv = lineas.join('\n').replace(/[\t\n ]+$/g, '');
      if (valores.length > maxFilas) csv += `\n[... ${valores.length - maxFilas} filas más ...]`;
      return `Hoja activa: "${nombre}". Celda activa: ${dirCelda(activa.r, activa.c)}.\nContenido (TSV):\n${csv}`;
    } catch (e) {
      return '';
    }
  },

  insertar(texto) {
    // Limpiar posibles bloques de código de la respuesta
    let t = texto.replace(/^```[a-z]*\n?/gm, '').replace(/```/g, '').replace(/\r/g, '').trim();
    if (!t) return;
    const filas = t.split('\n').map(l => l.split('\t'));
    const r0 = activa.r, c0 = activa.c;
    for (let i = 0; i < filas.length && r0 + i < FILAS; i++) {
      for (let j = 0; j < filas[i].length && c0 + j < COLS; j++) {
        aplicarValor(r0 + i, c0 + j, filas[i][j]);
      }
    }
    render();
  },

  // Acciones que la IA puede ejecutar directamente en la hoja
  acciones: {
    establecer_celda: {
      descripcion: 'Escribe un valor o fórmula en una celda. Parámetros: {"celda": "B3", "valor": "=SUMA(A1:A10)"}',
      fn: (p) => {
        const ref = parseRef(String(p.celda || ''));
        if (!ref) throw new Error('Celda no válida: ' + p.celda);
        aplicarValor(ref.r, ref.c, String(p.valor ?? ''));
        render();
        return `Escribí ${p.valor} en ${p.celda}`;
      }
    },
    ir_a_celda: {
      descripcion: 'Selecciona una celda. Parámetros: {"celda": "B3"}',
      fn: (p) => {
        const ref = parseRef(String(p.celda || ''));
        if (!ref) throw new Error('Celda no válida: ' + p.celda);
        seleccionar(ref.r, ref.c, false);
        return `Seleccioné ${p.celda}`;
      }
    },
    nueva_hoja: {
      descripcion: 'Crea una hoja nueva en el libro. Sin parámetros.',
      fn: () => { nuevaHoja(); return 'Hoja nueva creada'; }
    }
  }
};

// Botón de la cinta
document.getElementById('btnIA').addEventListener('click', () => window.IA.alternar());
