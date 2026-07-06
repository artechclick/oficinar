// ===== Calcular - funciones adicionales y corrección inteligente de fórmulas =====
// Registra en HyperFormula las funciones de Excel en español que el motor no trae
// (MODA, PROMEDIO.SI.CONJUNTO, JERARQUIA, PRONOSTICO, INDIRECTO, UNICOS, ORDENAR...)
// y expone corregirFormula() para arreglar fórmulas escritas con nombres en inglés
// o con coma como separador de argumentos.
// Debe cargarse DESPUÉS de funciones.js (amplía FX_INFO) y ANTES de renderer.js
// (el plugin tiene que estar registrado antes de crear el motor).
(function (global) {
  'use strict';

  const HFX = require('hyperformula');
  const { HyperFormula, FunctionPlugin, FunctionArgumentType, SimpleRangeValue, ArraySize, CellError, ErrorType, EmptyValue } = HFX;
  const idiomaES = require('hyperformula/commonjs/i18n/languages/esES.js').default;

  // Registrar el idioma antes que el plugin (renderer.js ya no lo re-registra)
  try { HyperFormula.getLanguage('esES'); } catch (e) { HyperFormula.registerLanguage('esES', idiomaES); }

  // ---------- Utilidades comunes ----------
  function aplanar(args) {
    // Convierte una mezcla de escalares y rangos en una lista plana de valores
    const out = [];
    for (const a of args) {
      if (a instanceof SimpleRangeValue) {
        for (const v of a.valuesFromTopLeftCorner()) out.push(v);
      } else out.push(a);
    }
    return out;
  }
  function soloNumeros(args) {
    return aplanar(args).filter(v => typeof v === 'number');
  }
  function numeroDe(txt) {
    // Acepta "5", "5,5" y "5.5"
    const s = String(txt).trim();
    if (!/^[-+]?\d+(?:[.,]\d+)?$/.test(s)) return null;
    return parseFloat(s.replace(',', '.'));
  }
  // Criterios estilo Excel: 10, ">5", "<>0", "texto", "ab*", "?x"
  function hacerCriterio(c) {
    if (typeof c === 'number') return v => typeof v === 'number' && v === c;
    if (typeof c === 'boolean') return v => v === c;
    const s = String(c ?? '');
    const m = /^(<=|>=|<>|=|<|>)([\s\S]*)$/.exec(s);
    const op = m ? m[1] : '=';
    const resto = m ? m[2] : s;
    const num = numeroDe(resto);
    if (num !== null) {
      switch (op) {
        case '>': return v => typeof v === 'number' && v > num;
        case '<': return v => typeof v === 'number' && v < num;
        case '>=': return v => typeof v === 'number' && v >= num;
        case '<=': return v => typeof v === 'number' && v <= num;
        case '<>': return v => v !== num;
        default: return v => v === num;
      }
    }
    const t = resto.toLowerCase();
    const texto = v => String(v == null ? '' : v).toLowerCase();
    if (op === '<>') return v => texto(v) !== t;
    if (op === '>' || op === '<' || op === '>=' || op === '<=') {
      return v => {
        const cmp = texto(v).localeCompare(t, 'es');
        return op === '>' ? cmp > 0 : op === '<' ? cmp < 0 : op === '>=' ? cmp >= 0 : cmp <= 0;
      };
    }
    if (/[*?]/.test(t)) {
      const re = new RegExp('^' + t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
      return v => re.test(String(v == null ? '' : v));
    }
    return v => texto(v) === t;
  }
  const fmtES = (dec, miles) => new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: miles
  });
  function pendienteIntercepto(ys, xs) {
    if (ys.length !== xs.length || ys.length < 2) return null;
    const n = ys.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const den = n * sxx - sx * sx;
    if (den === 0) return null;
    const b = (n * sxy - sx * sy) / den;
    return { b, a: (sy - b * sx) / n };
  }
  function filasDeRango(rango) {
    // Matriz de valores (los vacíos como null)
    return rango.data.map(fila => fila.map(v => (v === null || v === undefined || v === EmptyValue) ? null : v));
  }

  // ---------- Plugin ----------
  class FuncionesExtra extends FunctionPlugin {
    moda(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('MODA'), (...args) => {
        const nums = soloNumeros(args);
        const cnt = new Map();
        let mejor = null, max = 1;
        for (const x of nums) {
          const c = (cnt.get(x) || 0) + 1;
          cnt.set(x, c);
          if (c > max || (c === max && mejor !== null && c > 1 && x < mejor)) { max = c; mejor = x; }
        }
        return mejor === null ? new CellError(ErrorType.NA) : mejor;
      });
    }

    promedioSiConjunto(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('PROMEDIO.SI.CONJUNTO'), (rangoProm, ...resto) => {
        if (!(rangoProm instanceof SimpleRangeValue)) rangoProm = SimpleRangeValue.fromScalar(rangoProm);
        if (resto.length < 2 || resto.length % 2 !== 0) return new CellError(ErrorType.NA);
        const valores = filasDeRango(rangoProm);
        const criterios = [];
        for (let i = 0; i < resto.length; i += 2) {
          let rc = resto[i];
          if (!(rc instanceof SimpleRangeValue)) rc = SimpleRangeValue.fromScalar(rc);
          const datos = filasDeRango(rc);
          if (datos.length !== valores.length || datos[0].length !== valores[0].length) return new CellError(ErrorType.VALUE);
          criterios.push({ datos, pasa: hacerCriterio(resto[i + 1]) });
        }
        let suma = 0, n = 0;
        for (let r = 0; r < valores.length; r++) {
          for (let c = 0; c < valores[r].length; c++) {
            if (!criterios.every(cr => cr.pasa(cr.datos[r][c]))) continue;
            if (typeof valores[r][c] === 'number') { suma += valores[r][c]; n++; }
          }
        }
        return n === 0 ? new CellError(ErrorType.DIV_BY_ZERO) : suma / n;
      });
    }

    jerarquia(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('JERARQUIA'), (num, rango, orden) => {
        if (typeof num !== 'number') return new CellError(ErrorType.VALUE);
        const nums = rango instanceof SimpleRangeValue ? soloNumeros([rango]) : [rango];
        if (!nums.includes(num)) return new CellError(ErrorType.NA);
        const asc = !!orden;
        const mejores = nums.filter(v => asc ? v < num : v > num).length;
        return mejores + 1;
      });
    }

    pronostico(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('PRONOSTICO'), (x, ysR, xsR) => {
        const ys = soloNumeros([ysR]), xs = soloNumeros([xsR]);
        const t = pendienteIntercepto(ys, xs);
        if (!t) return new CellError(ErrorType.DIV_BY_ZERO);
        return t.a + t.b * x;
      });
    }

    interseccionEje(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('INTERSECCION.EJE'), (ysR, xsR) => {
        const ys = soloNumeros([ysR]), xs = soloNumeros([xsR]);
        const t = pendienteIntercepto(ys, xs);
        return t ? t.a : new CellError(ErrorType.DIV_BY_ZERO);
      });
    }

    concat(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('CONCAT'), (...args) => {
        let out = '';
        for (const v of aplanar(args)) {
          if (v === null || v === undefined) continue;
          if (typeof v === 'boolean') out += v ? 'VERDADERO' : 'FALSO';
          else if (typeof v === 'number') out += String(v).replace('.', ',');
          else out += String(v);
        }
        return out;
      });
    }

    moneda(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('MONEDA'), (num, dec) => {
        const d = dec === undefined ? 2 : Math.max(0, Math.trunc(dec));
        return '$ ' + fmtES(d, true).format(num);
      });
    }

    decimalFijo(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('DECIMAL'), (num, dec, sinMiles) => {
        const d = dec === undefined ? 2 : Math.max(0, Math.trunc(dec));
        return fmtES(d, !sinMiles).format(num);
      });
    }

    textoAntes(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('TEXTOANTES'), (texto, delim, inst) => {
        return this._parteTexto(String(texto ?? ''), String(delim ?? ''), inst === undefined ? 1 : Math.trunc(inst), true);
      });
    }
    textoDespues(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('TEXTODESPUES'), (texto, delim, inst) => {
        return this._parteTexto(String(texto ?? ''), String(delim ?? ''), inst === undefined ? 1 : Math.trunc(inst), false);
      });
    }
    _parteTexto(texto, delim, inst, antes) {
      if (!delim || inst === 0) return new CellError(ErrorType.VALUE);
      const posiciones = [];
      let p = texto.indexOf(delim);
      while (p !== -1) { posiciones.push(p); p = texto.indexOf(delim, p + delim.length); }
      const idx = inst > 0 ? inst - 1 : posiciones.length + inst;
      if (idx < 0 || idx >= posiciones.length) return new CellError(ErrorType.NA);
      return antes ? texto.slice(0, posiciones[idx]) : texto.slice(posiciones[idx] + delim.length);
    }

    indirecto(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('INDIRECTO'), (ref) => {
        const s = String(ref ?? '').trim();
        const m = /^(?:'([^']+)'!|([^'!]+)!)?\$?([A-Za-z]{1,3})\$?([0-9]{1,7})(?::\$?([A-Za-z]{1,3})\$?([0-9]{1,7}))?$/.exec(s);
        if (!m) return new CellError(ErrorType.REF);
        let hoja = state.formulaAddress.sheet;
        const nombreHoja = m[1] || m[2];
        if (nombreHoja) {
          const id = this.dependencyGraph.sheetMapping.getSheetId(nombreHoja);
          if (id === undefined) return new CellError(ErrorType.REF);
          hoja = id;
        }
        const col = (t) => { let c = 0; for (const ch of t.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; };
        const leer = (r, c) => {
          const v = this.dependencyGraph.getCellValue({ sheet: hoja, row: r, col: c });
          return (v === null || v === undefined || v === EmptyValue) ? null : v;
        };
        const r1 = parseInt(m[4], 10) - 1, c1 = col(m[3]);
        if (!m[5]) {
          const v = leer(r1, c1);
          return v === null ? 0 : v;
        }
        const r2 = parseInt(m[6], 10) - 1, c2 = col(m[5]);
        const filas = [];
        for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
          const fila = [];
          for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) fila.push(leer(r, c));
          filas.push(fila);
        }
        return SimpleRangeValue.onlyValues(filas);
      });
    }

    unicos(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('UNICOS'), (rango) => {
        if (!(rango instanceof SimpleRangeValue)) return rango;
        const vistos = new Set();
        const filas = [];
        for (const fila of filasDeRango(rango)) {
          const k = JSON.stringify(fila);
          if (!vistos.has(k)) { vistos.add(k); filas.push(fila); }
        }
        return filas.length ? SimpleRangeValue.onlyValues(filas) : new CellError(ErrorType.NA);
      });
    }

    ordenar(ast, state) {
      return this.runFunction(ast.args, state, this.metadata('ORDENAR'), (rango, colIdx, asc) => {
        if (!(rango instanceof SimpleRangeValue)) return rango;
        const filas = filasDeRango(rango);
        const c = Math.min(Math.max((colIdx === undefined ? 1 : Math.trunc(colIdx)) - 1, 0), (filas[0] || []).length - 1);
        const subir = asc === undefined ? true : !!asc;
        const orden = filas.slice().sort((a, b) => {
          const x = a[c], y = b[c];
          if (x === null && y === null) return 0;
          if (x === null) return 1;   // vacíos al final
          if (y === null) return -1;
          let cmp;
          if (typeof x === 'number' && typeof y === 'number') cmp = x - y;
          else cmp = String(x).localeCompare(String(y), 'es', { numeric: true, sensitivity: 'base' });
          return subir ? cmp : -cmp;
        });
        return SimpleRangeValue.onlyValues(orden);
      });
    }

    // Tamaño del resultado de las funciones matriciales: el del rango de entrada
    _tamanoDeEntrada(ast, state) {
      if (!ast.args.length) return ArraySize.error();
      try {
        const t = this.arraySizeForAst(ast.args[0], state);
        return new ArraySize(Math.max(t.width, 1), Math.max(t.height, 1));
      } catch (e) {
        return ArraySize.scalar();
      }
    }
    tamanoUnicos(ast, state) { return this._tamanoDeEntrada(ast, state); }
    tamanoOrdenar(ast, state) { return this._tamanoDeEntrada(ast, state); }
  }

  const P = FunctionArgumentType;
  FuncionesExtra.implementedFunctions = {
    'MODA': { method: 'moda', parameters: [{ argumentType: P.ANY }], repeatLastArgs: 1 },
    'MODA.UNO': { method: 'moda', parameters: [{ argumentType: P.ANY }], repeatLastArgs: 1 },
    'PROMEDIO.SI.CONJUNTO': {
      method: 'promedioSiConjunto',
      parameters: [{ argumentType: P.ANY }, { argumentType: P.ANY }, { argumentType: P.NOERROR }],
      repeatLastArgs: 2
    },
    'JERARQUIA': {
      method: 'jerarquia',
      parameters: [{ argumentType: P.NUMBER }, { argumentType: P.ANY }, { argumentType: P.NUMBER, optionalArg: true, defaultValue: 0 }]
    },
    'JERARQUIA.EQV': {
      method: 'jerarquia',
      parameters: [{ argumentType: P.NUMBER }, { argumentType: P.ANY }, { argumentType: P.NUMBER, optionalArg: true, defaultValue: 0 }]
    },
    'PRONOSTICO': {
      method: 'pronostico',
      parameters: [{ argumentType: P.NUMBER }, { argumentType: P.ANY }, { argumentType: P.ANY }]
    },
    'PRONOSTICO.LINEAL': {
      method: 'pronostico',
      parameters: [{ argumentType: P.NUMBER }, { argumentType: P.ANY }, { argumentType: P.ANY }]
    },
    'INTERSECCION.EJE': {
      method: 'interseccionEje',
      parameters: [{ argumentType: P.ANY }, { argumentType: P.ANY }]
    },
    'CONCAT': { method: 'concat', parameters: [{ argumentType: P.ANY }], repeatLastArgs: 1 },
    'MONEDA': {
      method: 'moneda',
      parameters: [{ argumentType: P.NUMBER }, { argumentType: P.NUMBER, optionalArg: true }]
    },
    'DECIMAL': {
      method: 'decimalFijo',
      parameters: [{ argumentType: P.NUMBER }, { argumentType: P.NUMBER, optionalArg: true }, { argumentType: P.BOOLEAN, optionalArg: true }]
    },
    'TEXTOANTES': {
      method: 'textoAntes',
      parameters: [{ argumentType: P.STRING }, { argumentType: P.STRING }, { argumentType: P.NUMBER, optionalArg: true }]
    },
    'TEXTODESPUES': {
      method: 'textoDespues',
      parameters: [{ argumentType: P.STRING }, { argumentType: P.STRING }, { argumentType: P.NUMBER, optionalArg: true }]
    },
    'INDIRECTO': { method: 'indirecto', parameters: [{ argumentType: P.STRING }], isVolatile: true },
    'UNICOS': { method: 'unicos', sizeOfResultArrayMethod: 'tamanoUnicos', parameters: [{ argumentType: P.RANGE }] },
    'ORDENAR': {
      method: 'ordenar',
      sizeOfResultArrayMethod: 'tamanoOrdenar',
      parameters: [{ argumentType: P.RANGE }, { argumentType: P.NUMBER, optionalArg: true }, { argumentType: P.BOOLEAN, optionalArg: true }]
    }
  };

  FuncionesExtra.translations = {
    esES: {
      'MODA': 'MODA', 'MODA.UNO': 'MODA.UNO', 'PROMEDIO.SI.CONJUNTO': 'PROMEDIO.SI.CONJUNTO',
      'JERARQUIA': 'JERARQUIA', 'JERARQUIA.EQV': 'JERARQUIA.EQV',
      'PRONOSTICO': 'PRONOSTICO', 'PRONOSTICO.LINEAL': 'PRONOSTICO.LINEAL',
      'INTERSECCION.EJE': 'INTERSECCION.EJE', 'CONCAT': 'CONCAT',
      'MONEDA': 'MONEDA', 'DECIMAL': 'DECIMAL',
      'TEXTOANTES': 'TEXTOANTES', 'TEXTODESPUES': 'TEXTODESPUES',
      'INDIRECTO': 'INDIRECTO', 'UNICOS': 'UNICOS', 'ORDENAR': 'ORDENAR'
    },
    enGB: {
      'MODA': 'MODE', 'MODA.UNO': 'MODE.SNGL', 'PROMEDIO.SI.CONJUNTO': 'AVERAGEIFS',
      'JERARQUIA': 'RANK', 'JERARQUIA.EQV': 'RANK.EQ',
      'PRONOSTICO': 'FORECAST', 'PRONOSTICO.LINEAL': 'FORECAST.LINEAR',
      'INTERSECCION.EJE': 'INTERCEPT', 'CONCAT': 'CONCAT',
      'MONEDA': 'DOLLAR', 'DECIMAL': 'FIXED',
      'TEXTOANTES': 'TEXTBEFORE', 'TEXTODESPUES': 'TEXTAFTER',
      'INDIRECTO': 'INDIRECT', 'UNICOS': 'UNIQUE', 'ORDENAR': 'SORT'
    }
  };

  HyperFormula.registerFunctionPlugin(FuncionesExtra, FuncionesExtra.translations);

  // ---------- Corrección inteligente de fórmulas ----------
  // Mapa inglés -> español a partir del propio archivo de idioma del motor,
  // más las traducciones del plugin y alias antiguos/regionales de Excel.
  const MAPA_NOMBRES = (() => {
    const m = {};
    for (const [en, es] of Object.entries(idiomaES.functions)) {
      if (en !== es) m[en.toUpperCase()] = es;
    }
    for (const [canon, en] of Object.entries(FuncionesExtra.translations.enGB)) {
      const es = FuncionesExtra.translations.esES[canon];
      if (en !== es) m[en.toUpperCase()] = es;
    }
    Object.assign(m, {
      'SIFECHA': 'DATEDIF',        // nombre español de DATEDIF
      'CONSULTAV': 'BUSCARV',      // Excel 2010 en español
      'CONSULTAH': 'BUSCARH',
      'ENCADENAR': 'CONCATENAR',
      'PROMEDIO.SI.CONJUNTOS': 'PROMEDIO.SI.CONJUNTO',
      'DESVSTD': 'DESVEST',
      'MODO': 'MODA'
    });
    return m;
  })();

  // Divide la fórmula en tramos fuera/dentro de comillas para no tocar los textos
  function transformarFueraDeCadenas(formula, fn) {
    return formula.replace(/("(?:[^"]|"")*")|([^"]+)/g, (_m, cadena, resto) => cadena !== undefined ? cadena : fn(resto));
  }

  function traducirNombres(formula) {
    return transformarFueraDeCadenas(formula, tramo =>
      tramo
        .replace(/([A-ZÑÁÉÍÓÚa-zñáéíóú][A-ZÑÁÉÍÓÚa-zñáéíóú0-9_.]*)(\s*\()/g, (m0, nombre, par) => {
          const es = MAPA_NOMBRES[nombre.toUpperCase()];
          return es ? es + par : m0;
        })
        // Literales lógicos en inglés escritos sin paréntesis
        .replace(/\b(TRUE|FALSE)\b(?!\s*\()/gi, m0 => m0.toUpperCase() === 'TRUE' ? 'VERDADERO()' : 'FALSO()')
    );
  }

  function cambiarSeparadores(formula) {
    // Solo si no usa ya ';': las comas pasan a ser separadores de argumentos
    let fuera = '';
    transformarFueraDeCadenas(formula, t => { fuera += t; return t; });
    if (fuera.includes(';') || !fuera.includes(',')) return formula;
    return transformarFueraDeCadenas(formula, tramo => tramo.replace(/,/g, ';'));
  }

  function cambiarDecimales(formula) {
    // Decimales al estilo inglés (3.7) -> coma decimal (3,7)
    return transformarFueraDeCadenas(formula, tramo => tramo.replace(/(\d)\.(\d)/g, '$1,$2'));
  }

  // Genera variantes de una fórmula fallida, de la más probable a la menos
  function corregirFormula(formula) {
    const variantes = [];
    const agregar = (f) => { if (f !== formula && !variantes.includes(f)) variantes.push(f); };
    const traducida = traducirNombres(formula);
    agregar(traducida);
    agregar(cambiarSeparadores(formula));
    agregar(cambiarSeparadores(traducida));
    agregar(cambiarDecimales(traducida));
    agregar(cambiarDecimales(cambiarSeparadores(traducida)));
    agregar(cambiarDecimales(cambiarSeparadores(formula)));
    return variantes;
  }

  // ---------- Descripciones para el diálogo "Insertar función" ----------
  // FX_INFO es un const de funciones.js compartido en el ámbito global de scripts
  const tablaFx = typeof FX_INFO !== 'undefined' ? FX_INFO : global.FX_INFO;
  if (tablaFx) {
    Object.assign(tablaFx, {
      'MODA': ['Estadística', 'Devuelve el valor más frecuente de un conjunto de datos.'],
      'MODA.UNO': ['Estadística', 'Devuelve el valor más frecuente de un conjunto de datos.'],
      'PROMEDIO.SI.CONJUNTO': ['Estadística', 'Devuelve el promedio de las celdas que cumplen varios criterios. =PROMEDIO.SI.CONJUNTO(rango_promedio; rango1; criterio1; ...)'],
      'JERARQUIA': ['Estadística', 'Devuelve la jerarquía (posición) de un número dentro de una lista. =JERARQUIA(número; rango; [orden])'],
      'JERARQUIA.EQV': ['Estadística', 'Devuelve la jerarquía de un número dentro de una lista de números.'],
      'PRONOSTICO': ['Estadística', 'Predice un valor futuro mediante regresión lineal. =PRONOSTICO(x; conocido_y; conocido_x)'],
      'PRONOSTICO.LINEAL': ['Estadística', 'Predice un valor futuro mediante regresión lineal.'],
      'INTERSECCION.EJE': ['Estadística', 'Devuelve la intersección de la línea de regresión lineal con el eje Y.'],
      'CONCAT': ['Texto', 'Concatena texto de varios valores o rangos.'],
      'MONEDA': ['Texto', 'Convierte un número en texto con formato de moneda. =MONEDA(número; [decimales])'],
      'DECIMAL': ['Texto', 'Da formato a un número como texto con decimales fijos. =DECIMAL(número; [decimales]; [sin_separador])'],
      'TEXTOANTES': ['Texto', 'Devuelve el texto anterior a un delimitador. =TEXTOANTES(texto; delimitador; [instancia])'],
      'TEXTODESPUES': ['Texto', 'Devuelve el texto posterior a un delimitador. =TEXTODESPUES(texto; delimitador; [instancia])'],
      'INDIRECTO': ['Búsqueda y referencia', 'Devuelve el valor de la referencia indicada por un texto. =INDIRECTO("B3") o =SUMA(INDIRECTO("A1:A10"))'],
      'UNICOS': ['Búsqueda y referencia', 'Devuelve los valores únicos de un rango (función de matriz).'],
      'ORDENAR': ['Búsqueda y referencia', 'Ordena el contenido de un rango. =ORDENAR(rango; [columna]; [ascendente])']
    });
  }

  const API = { corregirFormula, traducirNombres, cambiarSeparadores };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.FORMULAS_EXTRA = API;
})(typeof window !== 'undefined' ? window : globalThis);
