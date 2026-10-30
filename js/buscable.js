/* ============================================================
   FILTROS BUSCABLES
   Cada <select> de los filtros (Proveedores, Tarifas, Comparar, Historial, Gestores SINADER)
   se muestra como un campo donde se escribe y se elige de la lista filtrada.
   El <select> original sigue en la página (oculto): el resto del código lee su .value y
   escucha su "change" igual que antes. También se toman los selects que se dibujan después.
   ============================================================ */
const CBX_ZONAS = "#viewProv .controls, #tarFiltros, #viewSin .controls, #tarComparar, #tarHistorial";
const cbxNorm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/* Si el código cambia el valor por programa (sel.value = …), el campo visible se actualiza. */
(function () {
  for (const prop of ["value", "selectedIndex"]) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    Object.defineProperty(HTMLSelectElement.prototype, prop, {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set(v) { d.set.call(this, v); if (this._cbxSync) this._cbxSync(); }
    });
  }
})();

function cbxTextoSel(sel) {
  const o = sel.options[sel.selectedIndex];
  return o ? o.textContent : "";
}

function cbxMejorar(sel) {
  if (sel._cbxSync || sel.multiple) return;
  const caja = document.createElement("div");
  caja.className = "cbx";
  const inp = document.createElement("input");
  inp.type = "text"; inp.autocomplete = "off"; inp.spellcheck = false;
  inp.setAttribute("role", "combobox"); inp.setAttribute("aria-expanded", "false");
  if (sel.getAttribute("aria-label")) inp.setAttribute("aria-label", sel.getAttribute("aria-label"));
  const lista = document.createElement("ul");
  lista.className = "cbx-lista"; lista.setAttribute("role", "listbox"); lista.hidden = true;
  caja.append(inp, lista);
  sel.after(caja);
  sel.classList.add("cbx-oculto");
  sel.tabIndex = -1;
  // la etiqueta <label> que envolvía o apuntaba al select ahora enfoca el campo
  if (sel.id) { inp.id = sel.id + "_cbx"; const lbl = document.querySelector('label[for="' + sel.id + '"]'); if (lbl) lbl.htmlFor = inp.id; }

  let activo = -1, visibles = [];
  const sync = () => { if (document.activeElement !== inp) inp.value = cbxTextoSel(sel); inp.placeholder = cbxTextoSel(sel) || "Escribe para buscar"; };
  sel._cbxSync = sync;

  const pintar = filtro => {
    const f = cbxNorm(filtro);
    visibles = [...sel.options].filter(o => !o.disabled && (!f || cbxNorm(o.textContent).includes(f)));
    activo = visibles.findIndex(o => o.value === sel.value);
    lista.innerHTML = visibles.length
      ? visibles.map((o, i) => '<li role="option" data-i="' + i + '"' + (o.value === sel.value ? ' aria-selected="true"' : '') + (i === activo ? ' class="on"' : '') + '>' + esc(o.textContent) + '</li>').join('')
      : '<li class="cbx-vacio">Sin resultados</li>';
    lista.hidden = false; inp.setAttribute("aria-expanded", "true");
    const on = lista.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" });
  };
  const cerrar = () => { lista.hidden = true; inp.setAttribute("aria-expanded", "false"); };
  const elegir = o => {
    cerrar();
    const cambia = o.value !== sel.value;
    sel.value = o.value;
    inp.value = cbxTextoSel(sel);
    inp.blur();
    if (cambia) sel.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const mover = d => {
    if (!visibles.length) return;
    activo = (activo + d + visibles.length) % visibles.length;
    lista.querySelectorAll("li").forEach((li, i) => li.classList.toggle("on", i === activo));
    const on = lista.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" });
  };

  inp.addEventListener("focus", () => { inp.select(); pintar(""); });
  inp.addEventListener("input", () => pintar(inp.value));
  inp.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (lista.hidden) pintar(""); else mover(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); mover(-1); }
    else if (e.key === "Enter") { e.preventDefault(); const o = visibles[activo] || visibles[0]; if (o && !lista.hidden) elegir(o); }
    else if (e.key === "Escape") { cerrar(); inp.value = cbxTextoSel(sel); inp.blur(); }
  });
  // mousedown (no click) para elegir antes de que el campo pierda el foco
  lista.addEventListener("mousedown", e => {
    const li = e.target.closest("li[data-i]"); e.preventDefault();
    if (li) elegir(visibles[+li.dataset.i]);
  });
  inp.addEventListener("blur", () => { cerrar(); inp.value = cbxTextoSel(sel); });
  // si se reconstruyen las opciones (cascadas región → comuna, etc.), se actualiza el texto
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, characterData: true });
  sel.addEventListener("change", sync);
  sync();
}

function cbxMejorarEn(raiz) {
  if (!raiz || !raiz.querySelectorAll) return;
  if (raiz.matches && raiz.matches("select") && raiz.closest(CBX_ZONAS)) cbxMejorar(raiz);
  raiz.querySelectorAll("select").forEach(s => { if (s.closest(CBX_ZONAS)) cbxMejorar(s); });
}

document.addEventListener("DOMContentLoaded", () => {
  cbxMejorarEn(document.body);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(cbxMejorarEn))).observe(document.body, { childList: true, subtree: true });
});
