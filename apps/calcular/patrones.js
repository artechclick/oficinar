// ===== Calcular - predicción inteligente de patrones para el asa de relleno =====
// Módulo puro (sin dependencias de Electron ni del DOM) para poder probarlo en Node.
// Entrada: lista de celdas de origen en el orden del arrastre, cada una como
//   { ser: valor serializado (string | number | null), val: valor calculado, tipo: tipo detallado de HF }
// Salida: { tipo: 'formula' }                      -> copiar fórmulas con referencias relativas
//         { tipo: 'serie', valor(k) }              -> valor previsto para el paso k = 1, 2, 3...
//         { tipo: 'copia' }                        -> repetir cíclicamente el bloque original
(function (global) {
  'use strict';

  const quitarAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => quitarAcentos(String(s).trim().toLowerCase());

  // Listas conocidas: [nombres canónicos con acentos]; se comparan sin acentos
  const LISTAS = [
    ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
    ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
    ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
    ['primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo'],
    ['1er trimestre', '2do trimestre', '3er trimestre', '4to trimestre'],
    ['t1', 't2', 't3', 't4'],
    ['trimestre 1', 'trimestre 2', 'trimestre 3', 'trimestre 4']
  ].map(lista => ({ canon: lista, claves: lista.map(norm) }));

  // Aplica el patrón de mayúsculas del texto original al texto nuevo
  function aplicarCaso(original, nuevo) {
    if (original === original.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(original)) return nuevo.toUpperCase();
    if (original[0] === original[0].toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(original[0])) {
      return nuevo.charAt(0).toUpperCase() + nuevo.slice(1);
    }
    return nuevo;
  }

  // ---- Fechas: serial de hoja de cálculo <-> fecha ----
  const MS_DIA = 86400000;
  const EPOCA = Date.UTC(1899, 11, 30);
  const serialADate = (n) => new Date(EPOCA + Math.round(n) * MS_DIA);
  const dateASerial = (d) => Math.round((d.getTime() - EPOCA) / MS_DIA);
  function fechaTexto(serial) {
    const d = serialADate(serial);
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
  function horaTexto(frac) {
    let seg = Math.round(((frac % 1) + 1) % 1 * 86400);
    const h = Math.floor(seg / 3600) % 24; seg %= 3600;
    const m = Math.floor(seg / 60), s = seg % 60;
    return s === 0
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  function sumarMeses(serial, meses, diaBase) {
    const d = serialADate(serial);
    const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + meses;
    const anio = Math.floor(total / 12), mes = total % 12;
    const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
    return dateASerial(new Date(Date.UTC(anio, mes, Math.min(diaBase, ultimoDia))));
  }

  // ---- Regresión lineal por mínimos cuadrados sobre índices 0..n-1 ----
  // Para diferencias constantes coincide con la progresión aritmética exacta.
  function tendencia(nums) {
    const n = nums.length;
    if (n === 1) return { a: nums[0], b: 0 };
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += nums[i]; sxx += i * i; sxy += i * nums[i]; }
    const den = n * sxx - sx * sx;
    const b = den === 0 ? 0 : (n * sxy - sx * sy) / den;
    const a = (sy - b * sx) / n;
    return { a, b };
  }
  const enTendencia = (t, i) => t.a + t.b * i;
  // Redondeo suave para evitar residuos de coma flotante (2,3000000000000004 -> 2,3)
  function redondear(x) {
    const r = Math.round(x * 1e10) / 1e10;
    return Object.is(r, -0) ? 0 : r;
  }

  // ---- Texto con número (prefijo + número + sufijo): "Item 1", "5%", "$ 10,50" ----
  const RE_TEXTO_NUM = /^(.*?)(-?\d+(?:[.,]\d+)?)(\D*)$/;
  function analizarTextoNum(s) {
    const m = RE_TEXTO_NUM.exec(s);
    if (!m) return null;
    const usaComa = m[2].includes(',');
    const num = parseFloat(m[2].replace(',', '.'));
    const decimales = (m[2].split(/[.,]/)[1] || '').length;
    return { pre: m[1], num, post: m[3], usaComa, decimales, enteroConCeros: /^0\d/.test(m[2]) ? m[2].replace(/[.,].*$/, '').length : 0 };
  }
  function formatearTextoNum(base, valor) {
    const v = redondear(valor);
    let s = base.decimales > 0 ? v.toFixed(base.decimales) : String(Math.round(v));
    if (base.enteroConCeros) {
      const neg = s.startsWith('-');
      const abs = neg ? s.slice(1) : s;
      const [ent, dec] = abs.split('.');
      s = (neg ? '-' : '') + ent.padStart(base.enteroConCeros, '0') + (dec ? '.' + dec : '');
    }
    if (base.usaComa) s = s.replace('.', ',');
    return base.pre + s + base.post;
  }

  function esFormula(it) { return typeof it.ser === 'string' && it.ser.trim().startsWith('='); }
  function esVacia(it) { return it.ser === null || it.ser === undefined || it.ser === ''; }

  function predecirPatron(items) {
    if (!items || !items.length) return { tipo: 'copia' };
    if (items.every(esVacia)) return { tipo: 'serie', valor: () => null };
    // Cualquier fórmula en la línea: copiar el bloque con referencias relativas
    if (items.some(esFormula)) return { tipo: 'formula' };

    const llenas = items.filter(it => !esVacia(it));
    const n = llenas.length;

    // --- Fechas ---
    if (llenas.every(it => typeof it.val === 'number' && (it.tipo === 'NUMBER_DATE' || it.tipo === 'NUMBER_DATETIME'))) {
      const seriales = llenas.map(it => Math.round(it.val));
      if (n === 1) {
        // Una sola fecha: avanza de día en día (comportamiento de Excel)
        return { tipo: 'serie', valor: (k) => fechaTexto(seriales[0] + k) };
      }
      // ¿Serie mensual? mismo día del mes y salto constante de meses
      const fechas = seriales.map(serialADate);
      const dias = fechas.map(d => d.getUTCDate());
      const mesesAbs = fechas.map(d => d.getUTCFullYear() * 12 + d.getUTCMonth());
      const saltoMes = mesesAbs[1] - mesesAbs[0];
      const diaBase = Math.max(...dias);
      const esMensual = saltoMes !== 0 && mesesAbs.every((m, i) => i === 0 || m - mesesAbs[i - 1] === saltoMes) &&
        fechas.every(d => {
          const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
          return d.getUTCDate() === Math.min(diaBase, ultimo);
        });
      if (esMensual) {
        return { tipo: 'serie', valor: (k) => fechaTexto(sumarMeses(seriales[0], saltoMes * (n - 1 + k), diaBase)) };
      }
      const t = tendencia(seriales);
      return { tipo: 'serie', valor: (k) => fechaTexto(Math.round(enTendencia(t, n - 1 + k))) };
    }

    // --- Horas ---
    if (llenas.every(it => typeof it.val === 'number' && it.tipo === 'NUMBER_TIME')) {
      const t = n === 1 ? { a: llenas[0].val, b: 1 / 24 } : tendencia(llenas.map(it => it.val));
      return { tipo: 'serie', valor: (k) => horaTexto(enTendencia(t, n - 1 + k)) };
    }

    // --- Números puros ---
    if (llenas.every(it => typeof it.val === 'number')) {
      const nums = llenas.map(it => it.val);
      if (n === 1) return { tipo: 'copia' }; // un solo número: copiar (como Excel sin Ctrl)
      const t = tendencia(nums);
      // Porcentajes escritos como "5%": conservar el formato
      if (llenas.every(it => it.tipo === 'NUMBER_PERCENT' && typeof it.ser === 'string')) {
        const base = analizarTextoNum(String(llenas[0].ser).trim());
        if (base) {
          const tPct = tendencia(llenas.map(it => analizarTextoNum(String(it.ser).trim()).num));
          return { tipo: 'serie', valor: (k) => formatearTextoNum(base, enTendencia(tPct, n - 1 + k)) };
        }
      }
      return { tipo: 'serie', valor: (k) => redondear(enTendencia(t, n - 1 + k)) };
    }

    // Desde aquí trabajamos con los textos serializados
    const textos = llenas.map(it => String(it.ser).trim());

    // --- Listas conocidas (meses, días, trimestres...) ---
    for (const lista of LISTAS) {
      const idx = textos.map(t => lista.claves.indexOf(norm(t)));
      if (idx.some(i => i < 0)) continue;
      const L = lista.canon.length;
      let paso = 1;
      if (n > 1) {
        paso = ((idx[1] - idx[0]) % L + L) % L;
        if (paso === 0) paso = L; // mismo elemento repetido: no es serie de lista
        const coherente = idx.every((v, i) => i === 0 || ((v - idx[i - 1]) % L + L) % L === paso % L);
        if (!coherente || paso === L) continue;
      }
      const primero = textos[0];
      return {
        tipo: 'serie',
        valor: (k) => aplicarCaso(primero, lista.canon[(((idx[n - 1] + paso * k) % L) + L) % L])
      };
    }

    // --- Texto con número (prefijo/sufijo común) ---
    const partes = textos.map(analizarTextoNum);
    if (partes.every(p => p) &&
        partes.every(p => p.pre === partes[0].pre && p.post === partes[0].post) &&
        (partes[0].pre !== '' || partes[0].post !== '')) {
      const base = partes.reduce((a, b) => (b.decimales > a.decimales ? b : a), partes[0]);
      const t = n === 1 ? { a: partes[0].num, b: 1 } : tendencia(partes.map(p => p.num));
      return { tipo: 'serie', valor: (k) => formatearTextoNum(base, enTendencia(t, n - 1 + k)) };
    }

    // --- Sin patrón reconocible: repetir el bloque cíclicamente ---
    return { tipo: 'copia' };
  }

  const API = { predecirPatron };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.PATRONES = API;
})(typeof window !== 'undefined' ? window : globalThis);
