// ===== Oficinar - cinta de herramientas responsive =====
// Cuando los grupos de la cinta no caben en el ancho de la ventana, los últimos
// se recogen en un botón "⋯ Más" que los despliega en un panel flotante.
// Es genérico: funciona en las 4 apps porque comparten la estructura
// #cinta > .cinta-contenido > .grupo
(function () {
  function iniciar() {
    const cinta = document.getElementById('cinta');
    if (!cinta) return;
    const contenido = cinta.querySelector('.cinta-contenido');
    if (!contenido) return;

    // El contenedor no hace scroll ni envuelve: los grupos que no caben se recogen
    contenido.style.overflow = 'hidden';
    contenido.style.flexWrap = 'nowrap';

    // Botón "Más" (se muestra solo cuando hay grupos ocultos)
    const btnMas = document.createElement('button');
    btnMas.className = 'cinta-mas oculto-cinta';
    btnMas.type = 'button';
    btnMas.title = 'Más herramientas';
    btnMas.innerHTML = '<span>&#9776;</span><small>Más</small>';
    contenido.parentElement.appendChild(btnMas);

    // Panel flotante que aloja los grupos desbordados
    const panel = document.createElement('div');
    panel.className = 'cinta-mas-panel oculto-cinta';
    document.body.appendChild(panel);

    let abierto = false;
    function cerrar() { abierto = false; panel.classList.add('oculto-cinta'); btnMas.classList.remove('activo-cinta'); }
    function alternar() {
      abierto = !abierto;
      panel.classList.toggle('oculto-cinta', !abierto);
      btnMas.classList.toggle('activo-cinta', abierto);
      if (abierto) {
        const r = btnMas.getBoundingClientRect();
        panel.style.top = (r.bottom + 2) + 'px';
        panel.style.right = Math.max(6, window.innerWidth - r.right) + 'px';
      }
    }
    btnMas.addEventListener('click', (e) => { e.stopPropagation(); alternar(); });
    document.addEventListener('mousedown', (e) => {
      if (abierto && !panel.contains(e.target) && e.target !== btnMas && !btnMas.contains(e.target)) cerrar();
    });

    // Suma el ancho real de los grupos que están en la cinta (offsetWidth es fiable
    // aunque haya overflow; scrollWidth NO lo es con overflow:hidden/visible)
    const GAP = 5;
    function anchoNecesario() {
      let w = 0;
      contenido.querySelectorAll(':scope > .grupo').forEach(g => { w += g.offsetWidth + GAP; });
      return w;
    }
    const grupos = () => [...contenido.querySelectorAll(':scope > .grupo')];

    // Ajuste: mueve grupos entre la cinta y el panel según el ancho disponible
    let ajustando = false;
    function ajustar() {
      if (ajustando) return;
      ajustando = true;
      cerrar();

      // 1) Devolver todos los grupos a la cinta
      [...panel.querySelectorAll(':scope > .grupo')].forEach(g => contenido.appendChild(g));

      const disponible = contenido.clientWidth || cinta.clientWidth;

      // 2) ¿Cabe todo sin el botón Más?
      if (anchoNecesario() <= disponible + 1) {
        btnMas.classList.add('oculto-cinta');
        ajustando = false;
        return;
      }

      // 3) Desbordamiento: mostrar el botón (reserva ancho) y recoger los grupos finales
      btnMas.classList.remove('oculto-cinta');
      const margen = btnMas.offsetWidth + 10;
      let guardia = 0;
      while (anchoNecesario() > disponible - margen && grupos().length > 1 && guardia++ < 100) {
        const lista = grupos();
        panel.insertBefore(lista[lista.length - 1], panel.firstChild);
      }
      ajustando = false;
    }

    // Reajustar en cada cambio de tamaño (con rebote)
    let t = null;
    const programar = () => { clearTimeout(t); t = setTimeout(ajustar, 80); };
    window.addEventListener('resize', programar);
    if (window.ResizeObserver) new ResizeObserver(programar).observe(cinta);

    // Primer ajuste tras el layout inicial
    requestAnimationFrame(() => requestAnimationFrame(ajustar));
    // Reajustar cuando el documento termina de cargar fuentes/imagenes
    window.addEventListener('load', ajustar);
    setTimeout(ajustar, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
