/* ============================================================
   EDITAR TARIFAS DE UN PROVEEDOR (mismo formato que "Nueva tarifa")
   1 · Proveedor → 2 · Residuos → 3 · Tarifa referencial (Valor general) → 4 · Detalle por empresa-sucursal,
   un bloque por empresa/sucursal. Cada fila es una tarifa vigente ya guardada y se edita en el lugar:
   tipo, monto, moneda, unidad; − la da de baja (se puede deshacer antes de guardar); "+ otro cobro"
   agrega una nueva. Las condiciones de cada bloque solo se aplican si se cambian (si las tarifas del
   bloque tienen valores distintos, el campo dice "varía" y no se toca a menos que se escriba algo).
   Todo se guarda en una sola operación (tarifa_lote: editar + baja + crear), con Historial.
   Depende de js/tarifas.js y js/nueva-tarifa.js (ntSel, ntSN, ntK).
   ============================================================ */
let ET = null; // { nombre, s, blks: [{ bk, ref, cliente, sucursal, t0, ids, init, cond, pdf }], filas: {id: {...}}, nuevas: [{ bk, residuo, ... }] }

const ET_VAR = "__var";
const ET_CONDS = ["fecha", "detalle", "estado_servicio", "motivo_precio", "fuente", "fuente_ref", "condicion_pago_dias", "vigente_hasta", "por_confirmar", "valor_agregado"];

function botonEditarTarifas(nombre) {
  return '<button class="ct-editar" onclick="event.stopPropagation();abrirEditarTarifas(' + esc(JSON.stringify(nombre)) + ')">Editar tarifas</button>';
}

/** destacar (opcional): ids de tarifas con alerta, que se marcan y se muestran con sus alertas. */
function abrirEditarTarifas(nombre, destacar) {
  const s = buscarProveedorClickUp(nombre);
  marcarVigentes(TARIFAS.filter(t => t.activo));
  const todas = s ? tarifasDeProveedor(s) : TARIFAS.filter(t => t.activo && norm(t.proveedor_nombre) === norm(nombre));
  const ts = todas.filter(t => t.vigente);
  if (!ts.length) { abrirNuevaTarifa({ proveedor_nombre: nombre }); return; }

  const porBk = {};
  ts.forEach(t => {
    const ref = esGeneral(t), bk = ref ? "REF" : "C" + norm(t.cliente) + "|" + norm(t.sucursal);
    (porBk[bk] = porBk[bk] || { bk, ref, cliente: t.cliente, sucursal: t.sucursal, ts: [] }).ts.push(t);
  });
  if (!porBk.REF) porBk.REF = { bk: "REF", ref: true, cliente: "", sucursal: "", ts: [] };
  const blks = Object.values(porBk).sort((a, b) => (b.ref - a.ref) || (String(a.cliente) + "|" + a.sucursal).localeCompare(String(b.cliente) + "|" + b.sucursal, "es"));
  const filas = {};
  blks.forEach(b => {
    b.ts.sort((x, y) => String(x.residuo).localeCompare(String(y.residuo), "es") || String(x.contenedor).localeCompare(String(y.contenedor), "es"));
    b.ids = b.ts.map(t => t.id);
    b.t0 = b.ts[0] || null;
    b.init = {};
    ET_CONDS.forEach(c => {
      const vals = [...new Set(b.ts.map(t => String(tget(t, c) || "")))];
      b.init[c] = !b.ts.length ? (c === "fecha" ? new Date().toISOString().slice(0, 10) : "") : vals.length === 1 ? vals[0] : null;
    });
    b.cond = Object.assign({}, b.init);
    b.pdf = null;
    b.ts.forEach(t => { filas[t.id] = { t, tipo: t.tipo, serv: t.tipo_servicio || "", cont: contenedorBase(t.contenedor), vol: volumenEf(t) ?? "", dest: tget(t, "destino"), monto: tget(t, "precio"), moneda: t.moneda || "CLP", unidad: tget(t, "unidad"), trat: tget(t, "tratamiento"), dm: siNo(t.incluye_destruccion_marca) === "si" ? "si" : "", baja: false }; });
    delete b.ts;
  });
  ET = { nombre: s ? s.name : nombre, s, blks, filas, nuevas: [], anteriores: todas.length - ts.length, destacar: new Set(destacar || []) };

  const cu = s ? (s.residuosCU || []).filter(Boolean) : [];
  abrirModal("editarTarifasModal",
    '<h3>Editar tarifas · ' + esc(ET.nombre) + '</h3><div class="muted small">Montos netos, sin IVA. Edita en el lugar las tarifas vigentes; <b>−</b> da de baja (queda en el Historial y se puede restaurar) y <b>+ otro cobro</b> agrega una nueva. Nada se guarda hasta presionar Guardar cambios.</div>' +
    '<datalist id="ntUnidadDL">' + (CATS.unidad || []).map(u => '<option value="' + esc(u) + '">').join('') + '</datalist>' +
    '<datalist id="ntResDL">' + (CATS.residuo || []).map(u => '<option value="' + esc(u) + '">').join('') + '</datalist>' +
    '<datalist id="ntContDL">' + (CATS.contenedor || []).map(u => '<option value="' + esc(u) + '">').join('') + '</datalist>' +
    '<datalist id="ntComunaDL">' + COMUNAS_LISTA.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
    datalistEmpresasDestino("ntDestEmpDL", ET.nombre) +

    '<div class="nt-paso"><div class="nt-tit"><span class="nt-num">1</span> Proveedor</div>' +
      '<div class="small nt-info">' + (s ? '<span class="ok-msg">✓ ' + esc(s.name) + '</span>' : '<span class="warn">No está en ClickUp</span>') +
      ' · ' + ts.length + ' tarifa(s) vigente(s)' + (ET.anteriores ? ' · ' + ET.anteriores + ' valor(es) anterior(es) no se muestran' : '') + '</div></div>' +

    '<div class="nt-paso"><div class="nt-tit"><span class="nt-num">2</span> Residuos</div><div id="e_res"></div>' +
      (cu.length ? '<div class="muted small">Residuos en ClickUp sin tarifa referencial: <span id="e_res_cu"></span></div>' : '') + '</div>' +

    '<div class="nt-paso"><div class="nt-tit"><span class="nt-num">3</span> Tarifa referencial por residuo</div>' +
      '<div class="muted small">Precio de lista del proveedor, sin cliente.</div><div id="e_ref"></div></div>' +

    '<div class="nt-paso nt-cli"><div class="nt-tit"><span class="nt-num">4</span> Detalle por empresa-sucursal</div><div id="e_cli"></div>' +
      '<button type="button" class="lnk" onclick="etNuevoCliente()">+ Agregar cliente o sucursal (abre Nueva tarifa)</button></div>' +

    '<div class="tf-acc"><span id="e_status" class="muted small"></span><button class="cbtn" id="e_guardar" onclick="etGuardar()">Guardar cambios</button></div>',
    () => { ET = null; });
  etRender();
  if (ET.destacar.size) {
    const n = document.querySelectorAll("#editarTarifasModal tr.et-alerta").length;
    const st = document.getElementById("e_status");
    if (st) st.textContent = n ? n + " tarifa(s) con alerta marcadas en amarillo: completa sus datos y guarda." : "Las tarifas con alerta no están vigentes: revísalas en la pestaña Tarifas.";
    const primera = document.querySelector("#editarTarifasModal tr.et-alerta");
    if (primera) setTimeout(() => primera.scrollIntoView({ block: "center" }), 50);
  }
}

/* ---------- lectura de lo escrito ---------- */
function etCapturar() {
  if (!ET) return;
  const leer = tr => ({ tipo: tr.querySelector(".nt-tipo").value, serv: selOtraValor(tr.querySelector(".nt-serv")), monto: tr.querySelector(".nt-monto").value.trim(),
    cont: selOtraValor(tr.querySelector(".nt-cont")), vol: tr.querySelector(".nt-vol").value.trim(), dest: destCeldaValor(tr.querySelector(".nt-dest")),
    moneda: tr.querySelector(".nt-moneda").value, unidad: selOtraValor(tr.querySelector(".nt-unidad")), ...tratCeldaValor(tr) });
  document.querySelectorAll("#editarTarifasModal tr[data-id]").forEach(tr => { const f = ET.filas[tr.dataset.id]; if (f && !f.baja) Object.assign(f, leer(tr)); });
  document.querySelectorAll("#editarTarifasModal tr[data-nueva]").forEach(tr => { const n = ET.nuevas[+tr.dataset.nueva]; if (n) Object.assign(n, leer(tr)); });
  document.querySelectorAll("#editarTarifasModal .nt-suc[data-bk]").forEach(div => {
    const b = ET.blks.find(x => x.bk === div.dataset.bk); if (!b) return;
    div.querySelectorAll("[data-c]").forEach(el => { b.cond[el.dataset.c] = el.value; });
  });
}

/* ---------- dibujo ---------- */
const etCab = '<tr><th>Residuo</th><th>Destino</th><th>Tipo</th><th>Servicio</th><th>Tratamiento</th><th>Contenedor</th><th>m³</th><th>Monto</th><th>Moneda</th><th>Unidad</th><th></th></tr>';
function etFila(attr, residuo, v, sub, acciones, clase) {
  const dis = v.baja ? ' disabled' : '';
  return '<tr ' + attr + (clase ? ' class="' + clase + '"' : '') + '><td><b>' + resTag(residuo) + '</b>' + (sub ? '<div class="muted small">' + sub + '</div>' : '') + '</td>' +
    '<td>' + destinoCeldaHtml(v.dest || "", "etResumen()") + '</td>' +
    '<td><select class="nt-tipo"' + dis + ' onchange="etResumen()"><option value="cobra"' + (v.tipo !== "paga" ? ' selected' : '') + '>Cobra</option><option value="paga"' + (v.tipo === "paga" ? ' selected' : '') + '>Paga</option></select></td>' +
    '<td>' + ntServSel("nt-serv", v.serv || "", dis + ' onchange="etResumen()"') + '</td>' +
    '<td>' + tratCeldaHtml(residuo, v, "etResumen()") + '</td>' +
    '<td>' + contSel(v.cont || "", dis + ' onchange="etResumen()"', "Sin contenedor") + '</td>' +
    '<td><input class="nt-vol" inputmode="decimal" placeholder="m³"' + dis + ' value="' + esc(v.vol ?? "") + '" oninput="etResumen()"></td>' +
    '<td><input class="nt-monto" inputmode="decimal" placeholder="Monto"' + dis + ' value="' + esc(v.monto || "") + '" oninput="etResumen()"></td>' +
    '<td><select class="nt-moneda"' + dis + ' onchange="etResumen()">' + (CATS.moneda || ["CLP", "UF"]).map(m => '<option' + (m === (v.moneda || "CLP") ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select></td>' +
    '<td>' + ntUnidadSel(v.unidad || "", dis + ' oninput="etResumen()"') + '</td>' +
    '<td class="et-acc">' + acciones + '</td></tr>';
}
function etCondHtml(b) {
  const txt = (c, label, extra, cls) => {
    const varia = b.init[c] === null;
    return '<label' + (cls ? ' class="' + cls + '"' : '') + '>' + label + (varia ? ' <span class="muted small">(varía)</span>' : '') +
      (c === "detalle" ? '<textarea data-c="detalle" rows="2"' + (varia ? ' placeholder="Varía según la tarifa · escribe para cambiarlo en todas"' : '') + ' oninput="etResumen()">' + esc(b.cond[c] || "") + '</textarea>'
        : '<input data-c="' + c + '" ' + (extra || "") + ' value="' + esc(b.cond[c] || "") + '"' + (varia ? ' placeholder="Varía · escribe para cambiar todas"' : '') + ' oninput="etResumen()">') + '</label>';
  };
  const selc = (c, label, opts) => {
    const varia = b.init[c] === null, val = b.cond[c] == null ? ET_VAR : b.cond[c];
    return '<label>' + label + '<select data-c="' + c + '" onchange="etResumen()">' + (varia ? '<option value="' + ET_VAR + '"' + (val === ET_VAR ? ' selected' : '') + '>(varía)</option>' : '') +
      opts.map(([v, t]) => '<option value="' + esc(v) + '"' + (v === val ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></label>';
  };
  const estados = (CATS.estado_servicio || []).filter(e => norm(e) !== "VALORGENERAL").map(e => [e, e]);
  return '<div class="nt-suc-cond">' +
    txt("fecha", "Fecha", 'type="date"') +
    (b.ref ? '' : selc("estado_servicio", "Estado del servicio", estados)) +
    selc("motivo_precio", "Motivo del precio", [["", "— elegir —"]].concat(MOTIVOS_PRECIO.map(x => [x, x]))) +
    selc("fuente", "Tipo de fuente", [["", "— elegir —"]].concat(fuentesLista().map(x => [x, x]))) +
    txt("fuente_ref", "Referencia de la fuente", 'placeholder="Ej: Cotización N° 123"') +
    txt("condicion_pago_dias", "Pago (días)", 'inputmode="numeric"') +
    txt("vigente_hasta", "Vigente hasta", 'type="date"') +
    selc("por_confirmar", "Dato por confirmar", [["", "No"], ["si", "Sí"]]) +
    txt("detalle", "Detalle del cobro", "", "nt-ancho") +
    txt("valor_agregado", "Valor agregado", 'placeholder="CO₂ evitado, material recuperado, trazabilidad…"', "nt-ancho") +
  '</div>';
}
function etPdfHtml(b) {
  const urls = [...new Set(b.ids.map(id => tget(ET.filas[id].t, "pdf_url")).filter(Boolean))];
  return '<div class="nt-adj-box"><div class="nt-adj-tit">PDF respaldo</div>' +
    (urls.length ? urls.map((u, i) => '<a href="' + esc(u) + '" target="_blank" rel="noopener">📄 PDF' + (urls.length > 1 ? " " + (i + 1) : "") + '</a> ').join('') : '<span class="muted small">sin PDF</span> ') +
    (b.pdf ? '<span class="nt-adj-file">📄 ' + esc(b.pdf.name) + ' <span class="muted small">(reemplaza en todas las de este bloque)</span></span> <button type="button" class="lnk" onclick="etPdf(\'' + esc(b.bk) + '\',null)">Quitar</button>'
      : '<label class="lnk et-pdf">' + (urls.length ? 'Reemplazar PDF' : '+ Agregar PDF') + '<input type="file" accept="application/pdf" hidden onchange="etPdf(\'' + esc(b.bk) + '\',this)"></label>') +
  '</div>';
}
function etBloqueHtml(b) {
  const filasRes = {};
  const lineas = [];
  b.ids.forEach(id => {
    const f = ET.filas[id], t = f.t;
    // si una condición varía en el bloque, cada fila muestra la suya
    const sub = [b.init.detalle === null && tget(t, "detalle") ? "Detalle: " + tget(t, "detalle") : "", t.alertas && t.alertas.length && !ET.destacar.has(id) ? "⚠ " + t.alertas[0] : ""].filter(Boolean).map(esc).join(" · ");
    const acc = f.baja
      ? '<button type="button" class="lnk small" title="Deshacer" onclick="etBaja(\'' + esc(id) + '\',false)">↺ deshacer</button>'
      : '<button type="button" class="ico-btn danger" title="Eliminar esta tarifa" onclick="etBaja(\'' + esc(id) + '\',true)">−</button>';
    lineas.push({ r: t.residuo || "(sin residuo)", html: etFila('data-id="' + esc(id) + '"', t.residuo || "(sin residuo)", f, (f.baja ? '<span class="warn">se eliminará</span>' + (sub ? " · " : "") : "") + sub, acc, f.baja ? "et-baja" : ET.destacar.has(id) ? "et-alerta" : "") +
      (ET.destacar.has(id) && !f.baja && t.alertas && t.alertas.length ? '<tr class="et-alerta-txt"><td colspan="11">' + t.alertas.map(a => '⚠ ' + esc(a)).join('<br>') + '</td></tr>' : '') });
  });
  ET.nuevas.forEach((n, i) => {
    if (n.bk !== b.bk) return;
    lineas.push({ r: n.residuo, html: etFila('data-nueva="' + i + '"', n.residuo, n, '<span class="ok-msg">nueva</span>', '<button type="button" class="ico-btn danger" title="Quitar" onclick="etQuitarNueva(' + i + ')">−</button>', "nt-linea") });
  });
  lineas.sort((a, b2) => String(a.r).localeCompare(String(b2.r), "es"));
  // "+ otro cobro" una vez por residuo, en su primera línea
  const vistos = new Set();
  const html = lineas.map(l => {
    if (vistos.has(norm(l.r))) return l.html;
    vistos.add(norm(l.r));
    return l.html.replace('</b>', '</b><div><button type="button" class="lnk small" onclick="etAgregar(\'' + esc(b.bk) + '\',' + esc(JSON.stringify(l.r)) + ')">+ otro cobro</button></div>');
  }).join('');
  const d = b.ref ? null : sucursalInfo(b.cliente, b.sucursal);
  const lugar = b.ref ? '' : d && (d.direccion || d.comuna) ? '<span class="muted">' + esc([d.direccion, d.comuna].filter(Boolean).join(", ")) + '</span>'
    : b.t0 && (tget(b.t0, "direccion") || tget(b.t0, "comuna")) ? '<span class="muted">' + esc([tget(b.t0, "direccion"), tget(b.t0, "comuna")].filter(Boolean).join(", ")) + '</span>' : '<span class="muted">sin dirección registrada</span>';
  return '<div class="nt-suc" data-bk="' + esc(b.bk) + '">' +
    (b.ref ? '' : '<div class="nt-suc-h"><b>📍 ' + esc([b.cliente, b.sucursal].filter(Boolean).join(" · ") || "Cliente") + '</b> ' + lugar + '</div>') +
    etCondHtml(b) + etPdfHtml(b) +
    '<div class="tscroll"><table class="ttar nt-tab">' + etCab + (html || '<tr><td colspan="6" class="muted small">Sin tarifas referenciales: agrega un residuo abajo.</td></tr>') + '</table></div>' +
    '<div class="msel-escribir"><input list="ntResDL" placeholder="Agregar residuo y presiona Enter" onkeydown="if(event.key===\'Enter\'){event.preventDefault();etAgregar(\'' + esc(b.bk) + '\',this.value)}">' +
      '<button type="button" class="lnk" onclick="etAgregar(\'' + esc(b.bk) + '\',this.previousElementSibling.value)">Agregar</button></div>' +
  '</div>';
}
function etRender() {
  if (!ET) return;
  etCapturar();
  const ref = ET.blks.find(b => b.ref), cli = ET.blks.filter(b => !b.ref);
  document.getElementById("e_ref").innerHTML = etBloqueHtml(ref);
  document.getElementById("e_cli").innerHTML = cli.length ? cli.map(etBloqueHtml).join('') : '<div class="muted small nt-vacio">Este proveedor no tiene tarifas por cliente.</div>';
  // paso 2: residuos con tarifa (resumen) y los de ClickUp que aún no tienen referencial
  const res = unicosOrdenados(Object.values(ET.filas).filter(f => !f.baja).map(f => f.t.residuo).concat(ET.nuevas.map(n => n.residuo)).filter(Boolean));
  document.getElementById("e_res").innerHTML = '<div class="msel-chips">' + (res.length ? res.map(r => '<span class="mchip">' + esc(r) + '</span>').join('') : '<span class="muted small">Sin residuos</span>') + '</div>';
  const cuBox = document.getElementById("e_res_cu");
  if (cuBox) {
    const conRef = new Set(ref.ids.filter(id => !ET.filas[id].baja).map(id => norm(ET.filas[id].t.residuo)).concat(ET.nuevas.filter(n => n.bk === "REF").map(n => norm(n.residuo))));
    const faltan = (ET.s.residuosCU || []).filter(r => r && !conRef.has(norm(r)));
    cuBox.innerHTML = faltan.length ? faltan.map(r => '<button type="button" class="lnk" onclick="etAgregar(\'REF\',' + esc(JSON.stringify(r)) + ')">+ ' + esc(r) + '</button>').join(' ') : 'ninguno';
  }
  etResumen();
}

/* ---------- acciones ---------- */
function etBaja(id, on) { etCapturar(); ET.filas[id].baja = on; etRender(); }
function etAgregar(bk, residuo) {
  const v = String(residuo || "").trim(); if (!v) return;
  etCapturar();
  const canon = (CATS.residuo || []).find(o => o.toLowerCase() === v.toLowerCase()) || v;
  // parte con la unidad y el tipo de una línea del mismo residuo en el bloque, si hay
  const b = ET.blks.find(x => x.bk === bk);
  const hermana = b.ids.map(id => ET.filas[id]).find(f => norm(f.t.residuo) === norm(canon));
  ET.nuevas.push({ bk, residuo: canon, tipo: hermana ? hermana.tipo : "cobra", serv: hermana ? hermana.serv : "", cont: hermana ? hermana.cont : "", vol: hermana ? hermana.vol : "", dest: hermana ? hermana.dest : "", monto: "", moneda: hermana ? hermana.moneda : "CLP", unidad: hermana ? hermana.unidad : "", trat: hermana ? hermana.trat : "", dm: hermana ? hermana.dm : "" });
  etRender();
}
function etQuitarNueva(i) { etCapturar(); ET.nuevas.splice(i, 1); etRender(); }
function etPdf(bk, el) {
  etCapturar();
  const b = ET.blks.find(x => x.bk === bk);
  const f = el && el.files && el.files[0];
  if (f && f.size > 10 * 1024 * 1024) { alert("El PDF supera 10 MB."); return; }
  b.pdf = f || null;
  etRender();
}
function etNuevoCliente() {
  etCapturar();
  let a; try { a = etArmar(); } catch (e) { a = null; }
  if (a && a.total && !confirm("Tienes cambios sin guardar en esta ventana. ¿Abrir Nueva tarifa igual? Los cambios se pierden.")) return;
  const nombre = ET.nombre;
  cerrarModal("editarTarifasModal");
  abrirNuevaTarifa({ proveedor_nombre: nombre, abrirCliente: true, estado_servicio: "Activo" });
}

/* ---------- armado y guardado ---------- */
/** Condiciones que el usuario cambió en un bloque: { campo: valor }. */
function etCondCambiadas(b) {
  const out = {};
  ET_CONDS.forEach(c => {
    if (b.ref && c === "estado_servicio") return;
    const cur = b.cond[c] == null ? "" : String(b.cond[c]);
    if (b.init[c] === null) { if (cur !== "" && cur !== ET_VAR) out[c] = cur; }
    else if (cur !== b.init[c]) out[c] = cur;
  });
  return out;
}
function etArmar() {
  etCapturar();
  const num = (txt, donde) => { if (txt === "") return ""; const n = numDe(txt); if (n == null) throw new Error("Revisa el monto de " + donde + "."); return n; };
  const editar = [], eliminar = [], crear = []; // "−" elimina (f.baja = marcada para eliminar)
  ET.blks.forEach(b => {
    const cond = etCondCambiadas(b);
    const donde = b.ref ? "la referencial" : [b.cliente, b.sucursal].filter(Boolean).join(" · ");
    if (cond.fecha === "" ) throw new Error("La fecha no puede quedar vacía (" + donde + ").");
    b.ids.forEach(id => {
      const f = ET.filas[id], t = f.t;
      if (f.baja) { eliminar.push(id); return; }
      const c = Object.assign({}, cond);
      const monto = num(f.monto, (t.residuo || "residuo") + " en " + donde);
      if (monto === "" ? t.precio_num != null : monto !== t.precio_num) c.precio = monto;
      if (f.moneda !== (t.moneda || "CLP")) c.moneda = f.moneda;
      if (f.unidad !== tget(t, "unidad")) c.unidad = f.unidad;
      if (f.tipo !== t.tipo) c.tipo_transaccion = f.tipo;
      if (f.serv && f.serv !== t.tipo_servicio) c.tipo_servicio = f.serv;
      if (norm(f.cont) !== norm(contenedorBase(t.contenedor))) c.contenedor = f.cont;
      if ((f.dest || "") !== tget(t, "destino")) { c.destino = f.dest || ""; c.comuna_destino = comunaDeDestino(f.dest); }
      // tratamiento y destrucción de marca: solo en cobros con disposición o compra (Q11)
      const servF = f.serv || t.tipo_servicio, trF = conTratamiento(servF) ? (f.trat || "") : "", dmF = conTratamiento(servF) ? (f.dm || "") : "";
      if (trF !== tget(t, "tratamiento")) c.tratamiento = trF;
      if (dmF !== (siNo(t.incluye_destruccion_marca) === "si" ? "si" : "")) c.incluye_destruccion_marca = dmF;
      const volN = f.vol === "" ? "" : numDe(f.vol);
      if (volN === null) throw new Error("Revisa el volumen de " + (t.residuo || "residuo") + " en " + donde + ".");
      if (volN !== (volumenEf(t) ?? "")) c.volumen_m3 = volN;
      if (c.comuna_destino) c.comuna_destino = comunaCanonica(c.comuna_destino);
      if ("condicion_pago_dias" in c && c.condicion_pago_dias !== "") { const n = numDe(c.condicion_pago_dias); if (n == null) throw new Error("Revisa los días de pago en " + donde + "."); c.condicion_pago_dias = n; }
      if ("volumen_m3" in c && c.volumen_m3 !== "") { const n = numDe(c.volumen_m3); if (n == null) throw new Error("Revisa el volumen en " + donde + "."); c.volumen_m3 = n; }
      if (b.pdf) c._pdf = b.bk;
      if (Object.keys(c).length) editar.push({ id, cambios: c });
    });
    ET.nuevas.filter(n => n.bk === b.bk).forEach(n => {
      const monto = num(n.monto, n.residuo + " (nuevo) en " + donde);
      if (monto === "") return;
      const t0 = b.t0 || {};
      const val = c => { const v = b.cond[c]; return v == null || v === ET_VAR ? tget(t0, c) : v; };
      crear.push({
        proveedor_id: ET.s ? ET.s.id : "", proveedor_nombre: ET.nombre, residuo: n.residuo,
        tipo_transaccion: n.tipo, tipo_servicio: n.serv || tget(t0, "tipo_servicio") || "", precio: monto, moneda: n.moneda || "CLP", unidad: n.unidad || "",
        contenedor: n.cont || "", volumen_m3: n.vol === "" || n.vol == null ? "" : numDe(n.vol) ?? "",
        motivo_precio: val("motivo_precio") || "", fuente: val("fuente") || "", fuente_ref: val("fuente_ref") || "",
        destino: n.dest || "", comuna_destino: comunaDeDestino(n.dest), condicion_pago_dias: numDe(val("condicion_pago_dias")) ?? pagoDiasPorDefecto(b.ref ? "" : b.cliente),
        tratamiento: conTratamiento(n.serv) ? n.trat || "" : "", incluye_destruccion_marca: conTratamiento(n.serv) ? n.dm || "" : "",
        vigente_hasta: val("vigente_hasta") || "", por_confirmar: val("por_confirmar") || "", valor_agregado: val("valor_agregado") || "",
        fecha: val("fecha") || new Date().toISOString().slice(0, 10), detalle: val("detalle") || "",
        estado_servicio: b.ref ? "Valor general" : (val("estado_servicio") || "Activo"),
        cliente: b.ref ? "" : b.cliente, sucursal: b.ref ? "" : b.sucursal, estado_cliente: b.ref ? "" : tget(t0, "estado_cliente"),
        direccion: b.ref ? "" : tget(t0, "direccion"), comuna: b.ref ? "" : tget(t0, "comuna"), region: b.ref ? "" : tget(t0, "region"),
        cantidad_min: "", cantidad_max: "", pdf_url: b.pdf ? "" : (tget(t0, "pdf_url") || ""), _pdf: b.pdf ? b.bk : ""
      });
    });
  });
  const faltan = crear.map(d => ({ d, f: faltantesMinimos(d) })).find(x => x.f.length);
  if (faltan) throw new Error("Cobro nuevo: " + textoFaltantes(faltan.d, faltan.f) + " Complétalo en las condiciones del bloque.");
  return { editar, eliminar, crear, total: editar.length + eliminar.length + crear.length };
}
function etResumen() {
  const st = document.getElementById("e_status"); if (!st || !ET) return;
  try {
    const a = etArmar();
    st.textContent = a.total ? [a.editar.length ? a.editar.length + " se editarán" : "", a.eliminar.length ? a.eliminar.length + " se eliminarán" : "", a.crear.length ? a.crear.length + " se crearán" : ""].filter(Boolean).join(" · ") + "." : "Sin cambios.";
  } catch (e) { st.textContent = e.message; }
}
async function etGuardar() {
  const st = document.getElementById("e_status"), btn = document.getElementById("e_guardar");
  try {
    const a = etArmar();
    if (!a.total) throw new Error("No hay cambios que guardar.");
    if (a.total > 300) throw new Error("Son " + a.total + " cambios; el máximo es 300 por vez.");
    if (!confirm("Se guardarán los cambios de " + ET.nombre + ":\n" + [a.editar.length ? "· " + a.editar.length + " tarifa(s) editada(s)" : "", a.eliminar.length ? "· " + a.eliminar.length + " eliminada(s) (no se pueden restaurar)" : "", a.crear.length ? "· " + a.crear.length + " nueva(s)" : ""].filter(Boolean).join("\n") + "\n\nCada cambio queda en el Historial. ¿Continuar?")) return;
    if (!sesionActiva()) await iniciarSesion();
    btn.disabled = true;
    st.textContent = "Guardando…";
    // PDF nuevos (uno por bloque)
    const urls = {};
    for (const b of ET.blks) if (b.pdf) urls[b.bk] = await ntSubirPdf(b.pdf);
    a.editar.forEach(e => { if (e.cambios._pdf) { e.cambios.pdf_url = urls[e.cambios._pdf]; delete e.cambios._pdf; } });
    a.crear.forEach(d => { if (d._pdf) d.pdf_url = urls[d._pdf]; delete d._pdf; });
    // valores nuevos (unidad, contenedor, residuo…) pasan al catálogo y a los filtros
    for (const d of a.crear) await asegurarCatalogos(d);
    for (const e of a.editar) await asegurarCatalogos(e.cambios);
    const r = await api("tarifa_lote", { lote: a }, true);
    a.eliminar.forEach(id => { PENDIENTES[id] = { eliminada: true, t: Date.now() }; });
    await refrescarTrasGuardar(r.tarifas);
    st.textContent = "Listo: " + [r.editadas ? r.editadas + " editada(s)" : "", r.eliminadas ? r.eliminadas + " eliminada(s)" : "", r.creadas ? r.creadas + " nueva(s)" : ""].filter(Boolean).join(", ") + ".";
    setTimeout(() => cerrarModal("editarTarifasModal"), 800);
  } catch (e) {
    st.textContent = "Error: " + e.message;
  } finally { if (btn) btn.disabled = false; }
}
