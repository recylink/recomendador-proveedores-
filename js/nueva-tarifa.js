/* ============================================================
   NUEVA TARIFA (flujo por pasos)
   1 · Proveedor → 2 · Residuos → 3 · Tarifa referencial por residuo (monto, moneda, unidad)
   + condiciones comunes → 4 · (opcional) detalle por cliente: empresa + varias sucursales;
   cada sucursal tiene su bloque con sus condiciones y su tabla de precios por residuo.
   La fecha y el PDF de respaldo pueden ser comunes o por sucursal.
   Editar una tarifa, editar en bloque y "Pegar desde Claude" siguen usando abrirFormTarifa.
   Depende de js/tarifas.js (helpers de formulario, catálogos, api) e index.html (SUPPLIERS).
   ============================================================ */
let NT = null; // { ref: {k}, cli: {sk|k}, cliTocado: {sk|k}, cond: {sk: {...}}, pdf: {sk: File} }

const ntK = r => norm(r);
const ntSK = s => "S" + norm(s || "(sin sucursal)");
const ntVal = id => ((document.getElementById(id) || {}).value || "").trim();
const ntSN = [["si", "Sí"], ["no", "No"]];
const ntSel = (cls, opts, val) => '<select class="' + cls + '">' + opts.map(([v, t]) => '<option value="' + v + '"' + (v === val ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>';

/**
 * pre (opcional): { proveedor_nombre, residuos: [], ref: { residuo: { monto, moneda, unidad } }, abrirCliente, estado_servicio, cliente }
 */
function abrirNuevaTarifa(pre) {
  pre = pre || {};
  NT = { ref: {}, cli: {}, cliTocado: {}, cond: {}, adj: {}, sucQuita: {}, sucAgrega: {} }; // adj: { REF | sk: [{ file, res: [claves de residuo] }] }
  Object.keys(pre.ref || {}).forEach(r => { NT.ref[ntK(r)] = Object.assign({ moneda: "CLP" }, pre.ref[r]); });
  const estadosCli = (CATS.estado_servicio || []).filter(e => norm(e) !== "VALORGENERAL");
  const hoy = new Date().toISOString().slice(0, 10);
  abrirModal("nuevaTarifaModal",
    '<h3>Nueva tarifa</h3><div class="muted small">Montos netos, sin IVA. Primero el proveedor y sus residuos; después el valor de referencia de cada uno y, si quieres, lo que se cobra en cada sucursal de un cliente.</div>' +
    '<datalist id="ntUnidadDL">' + (CATS.unidad || []).map(u => '<option value="' + esc(u) + '">').join('') + '</datalist>' +
    '<datalist id="ntResDL">' + (CATS.residuo || []).map(u => '<option value="' + esc(u) + '">').join('') + '</datalist>' +
    '<datalist id="ntContDL">' + (CATS.contenedor || []).map(u => '<option value="' + esc(u) + '">').join('') + '</datalist>' +
    '<datalist id="ntComunaDL">' + (typeof COMUNAS_LISTA !== "undefined" ? COMUNAS_LISTA : []).map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>' +

    '<div class="nt-paso"><div class="nt-tit"><span class="nt-num">1</span> Proveedor</div>' +
      inp("n_prov", pre.proveedor_nombre || "", 'list="provDL" autocomplete="off" placeholder="Nombre del proveedor" oninput="ntProvCambio()"') +
      '<div id="n_prov_info" class="small nt-info"></div></div>' +

    '<div class="nt-paso"><div class="nt-tit"><span class="nt-num">2</span> Residuos</div>' +
      mselHtml("n_res", { opciones: CATS.residuo || [], valores: (pre.residuos || []).filter(Boolean), otro: true, placeholder: "+ residuo", onChange: ntRender }) + '</div>' +

    '<div class="nt-paso"><div class="nt-tit"><span class="nt-num">3</span> Tarifa referencial por residuo</div>' +
      '<div class="muted small">Precio de lista del proveedor, sin cliente. Deja el monto vacío en los residuos que no quieras fijar.</div>' +
      '<div id="n_ref"></div>' +
      '<details class="nt-cond"><summary>Condiciones (aplican a la referencial y son la base de cada sucursal)</summary><div class="tf-grid">' +
        campo("n_tipo", "Tipo de transacción", sel("n_tipo", [["cobra", "Cobra: el cliente paga al proveedor"], ["paga", "Paga: el proveedor paga al cliente"]], "cobra")) +
        campo("n_conts", "Contenedor(es) / vehículo(s)", mselHtml("n_conts", { opciones: CATS.contenedor || [], valores: [], otro: true, placeholder: "+ contenedor" })) +
        campo("n_transp", "¿Incluye transporte?", sel("n_transp", ntSN, "si")) +
        campo("n_disp", "¿Incluye disposición?", sel("n_disp", ntSN, "si")) +
        campo("n_fecha", "Fecha de la tarifa", '<input id="n_fecha" type="date" value="' + hoy + '">') +
        campo("n_detalle", "Detalle del cobro (por qué cobra eso, condiciones)", '<textarea id="n_detalle" rows="2"></textarea>', "span2") +
      '</div></details>' +
      '<div class="nt-adj-box"><div class="nt-adj-tit">PDF respaldo de la referencial <span class="muted small">· también sirve para las sucursales que no tengan uno propio para ese residuo</span></div><div id="n_adj_REF"></div></div></div>' +

    '<details class="nt-paso nt-cli" id="n_cli_det"' + (pre.abrirCliente ? ' open' : '') + ' ontoggle="ntResumen()"><summary class="nt-tit"><span class="nt-num">4</span> Detalle por cliente <span class="muted small">(opcional · carga masiva por sucursales)</span></summary>' +
      '<div class="tf-grid">' +
        campo("n_emp", "Empresa", inp("n_emp", pre.cliente || "", 'list="clienteDL" autocomplete="off" placeholder="Ej: COPEC" oninput="ntEmpresaCambio()"')) +
        campo("n_estado", "Estado del servicio", sel("n_estado", estadosCli, pre.estado_servicio && norm(pre.estado_servicio) !== "VALORGENERAL" ? pre.estado_servicio : "Activo")) +
        campo("n_estcli", "Estado del cliente", sel("n_estcli", CATS.estado_cliente || ["activo"], "activo")) +
        '<div class="tf-campo"><label>&nbsp;</label><label class="chk nt-chk"><input type="checkbox" id="n_fpsuc" onchange="ntRender()"> Fecha por sucursal</label></div>' +
        campo("n_sucs", "Sucursales <span class=\"muted\">· cada una con sus condiciones y precios</span>", mselHtml("n_sucs", { opciones: sucursalesDe(pre.cliente || ""), valores: [], otro: true, placeholder: "+ sucursal", onChange: ntRender }), "span2") +
      '</div>' +
      '<div id="n_cli"></div>' +
    '</details>' +

    '<div class="tf-acc"><span id="n_status" class="muted small"></span><button class="cbtn" id="n_guardar" onclick="ntGuardar()">Guardar</button></div>',
    () => { NT = null; });
  ntProvCambio();
  ntRender();
}

/* ---------- reacciones ---------- */
function ntProvCambio() {
  const box = document.getElementById("n_prov_info"); if (!box) return;
  const nombre = ntVal("n_prov");
  const s = nombre ? buscarProveedorClickUp(nombre) : null;
  if (!nombre) { box.innerHTML = ""; return; }
  if (!s) { box.innerHTML = '<span class="warn">No está en ClickUp: se guardará solo con el nombre (luego puedes crear su ficha).</span>'; return; }
  const cu = (s.residuosCU || []).filter(Boolean);
  box.innerHTML = '<span class="ok-msg">✓ ' + esc(s.name) + '</span>' +
    (cu.length ? ' · residuos en ClickUp: ' + esc(cu.slice(0, 8).join(", ")) + (cu.length > 8 ? '…' : '') +
      ' <button class="lnk" type="button" onclick="ntUsarResiduosCU()">Usar estos residuos</button>' : ' · sin residuos cargados en ClickUp');
}
function ntUsarResiduosCU() {
  const s = buscarProveedorClickUp(ntVal("n_prov")); if (!s) return;
  (s.residuosCU || []).forEach(r => { if (!MSEL.n_res.valores.some(v => ntK(v) === ntK(r))) MSEL.n_res.valores.push(r); });
  mselRender("n_res"); ntRender();
}
function ntEmpresaCambio() { mselOpciones("n_sucs", sucursalesDe(ntVal("n_emp"))); ntRender(); }

/** Condiciones comunes (paso 3): base de cada sucursal. */
function ntComunes() {
  const conts = mselValores("n_conts");
  return { cont: conts[0] || "", transp: ntVal("n_transp") || "si", disp: ntVal("n_disp") || "si", detalle: ntVal("n_detalle"), fecha: ntVal("n_fecha"), dir: "", comuna: "" };
}

/** Guarda lo escrito (tablas y condiciones por sucursal) antes de redibujar. */
function ntCapturar() {
  if (!NT) return;
  document.querySelectorAll("#n_ref tr[data-k]").forEach(tr => {
    NT.ref[tr.dataset.k] = { monto: tr.querySelector(".nt-monto").value.trim(), moneda: tr.querySelector(".nt-moneda").value, unidad: tr.querySelector(".nt-unidad").value.trim() };
  });
  document.querySelectorAll("#n_cli tr[data-k]").forEach(tr => {
    NT.cli[tr.dataset.k] = { monto: tr.querySelector(".nt-monto").value.trim(), moneda: tr.querySelector(".nt-moneda").value, unidad: tr.querySelector(".nt-unidad").value.trim() };
  });
  document.querySelectorAll("#n_cli .nt-suc[data-sk]").forEach(b => {
    const q = c => b.querySelector(c);
    NT.cond[b.dataset.sk] = {
      cont: q(".nt-c-cont").value.trim(), transp: q(".nt-c-transp").value, disp: q(".nt-c-disp").value, detalle: q(".nt-c-det").value.trim(),
      fecha: q(".nt-c-fecha") ? q(".nt-c-fecha").value : (NT.cond[b.dataset.sk] || {}).fecha,
      dir: q(".nt-c-dir") ? q(".nt-c-dir").value.trim() : "", comuna: q(".nt-c-comuna") ? q(".nt-c-comuna").value.trim() : ""
    };
  });
}
function ntFila(r, v, cual, key, ayuda) {
  return '<tr data-k="' + esc(key) + '"><td><b>' + esc(r) + '</b>' + (ayuda ? '<div class="muted small">' + ayuda + '</div>' : '') + '</td>' +
    '<td><input class="nt-monto" inputmode="decimal" placeholder="Monto" value="' + esc(v.monto || "") + '" oninput="ntEditado(\'' + cual + '\',\'' + esc(key) + '\')"></td>' +
    '<td><select class="nt-moneda" onchange="ntEditado(\'' + cual + '\',\'' + esc(key) + '\')">' + (CATS.moneda || ["CLP", "UF"]).map(m => '<option' + (m === (v.moneda || "CLP") ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select></td>' +
    '<td><input class="nt-unidad" list="ntUnidadDL" placeholder="Unidad" value="' + esc(v.unidad || "") + '" oninput="ntEditado(\'' + cual + '\',\'' + esc(key) + '\')"></td></tr>';
}
/** Lo escrito en el referencial se copia a cada sucursal mientras esa celda no se haya tocado. */
function ntEditado(cual, key) {
  ntCapturar();
  if (cual === "cli") NT.cliTocado[key] = true;
  if (cual === "ref") {
    document.querySelectorAll('#n_cli tr[data-k$="|' + CSS.escape(key) + '"]').forEach(tr => {
      if (NT.cliTocado[tr.dataset.k]) return;
      const v = NT.ref[key] || {};
      tr.querySelector(".nt-monto").value = v.monto || ""; tr.querySelector(".nt-moneda").value = v.moneda || "CLP"; tr.querySelector(".nt-unidad").value = v.unidad || "";
      NT.cli[tr.dataset.k] = Object.assign({}, v);
    });
  }
  ntResumen();
}
/** Copia condiciones y precios de la primera sucursal a otra. */
function ntCopiarPrimera(sk) {
  ntCapturar();
  const sucs = mselValores("n_sucs"); if (!sucs.length) return;
  const sk0 = ntSK(sucs[0]);
  const c0 = NT.cond[sk0] || {};
  NT.cond[sk] = Object.assign({}, c0, { dir: (NT.cond[sk] || {}).dir || "", comuna: (NT.cond[sk] || {}).comuna || "" });
  NT.sucQuita[sk] = (NT.sucQuita[sk0] || []).slice();
  NT.sucAgrega[sk] = (NT.sucAgrega[sk0] || []).slice();
  ntResSuc(sk0).forEach(r => {
    const k = ntK(r), a = sk0 + "|" + k, b = sk + "|" + k;
    NT.cli[b] = Object.assign({}, NT.cliTocado[a] ? NT.cli[a] : (NT.ref[k] || {})); NT.cliTocado[b] = true;
  });
  ntRender();
}

function ntRender() {
  if (!NT) return;
  ntCapturar();
  const residuos = mselValores("n_res");
  const prov = ntVal("n_prov");
  const s = prov ? buscarProveedorClickUp(prov) : null;
  const actuales = {};
  if (s) referenciales(tarifasDeProveedor(s)).forEach(f => { if (f.conPrecio) actuales[ntK(f.residuo)] = f; });
  const cab = '<tr><th>Residuo</th><th>Monto</th><th>Moneda</th><th>Unidad</th></tr>';
  const vacio = '<div class="muted small nt-vacio">Elige al menos un residuo en el paso 2.</div>';
  document.getElementById("n_ref").innerHTML = residuos.length ? '<div class="tscroll"><table class="ttar nt-tab">' + cab + residuos.map(r => {
    const a = actuales[ntK(r)];
    const v = NT.ref[ntK(r)] || { unidad: a ? a.unidad || "" : "" };
    return ntFila(r, v, "ref", ntK(r), a ? 'actual: ' + esc((a.ref != null ? fmtCLP(a.ref) : fmtNum(a.refUF, 2) + " UF") + (a.unidad ? " / " + a.unidad : "") + " · " + a.nota) : "");
  }).join('') + '</table></div>' : vacio;

  // 4 · un bloque por sucursal (o uno "sin sucursal" si no se eligió ninguna)
  const emp = ntVal("n_emp"), sucs = mselValores("n_sucs"), porSuc = !!(document.getElementById("n_fpsuc") || {}).checked;
  const com = ntComunes();
  const bloques = (sucs.length ? sucs : [""]).map((su, i) => {
    const sk = ntSK(su);
    const resSuc = ntResSuc(sk);
    const c = NT.cond[sk] || (NT.cond[sk] = Object.assign({}, com));
    const d = su ? sucursalInfo(emp, su) : null;
    const conDir = d && (d.direccion || d.comuna);
    const lugar = su ? (conDir ? '<span class="muted">' + esc([d.direccion, d.comuna].filter(Boolean).join(", ")) + '</span>' : '<span class="warn">sin dirección registrada</span>') : '<span class="muted">sin sucursal (a nivel de empresa)</span>';
    return '<div class="nt-suc" data-sk="' + esc(sk) + '">' +
      '<div class="nt-suc-h"><b>📍 ' + esc(su || emp || "Cliente") + '</b> ' + lugar +
        (i > 0 ? ' <button type="button" class="lnk" onclick="ntCopiarPrimera(\'' + esc(sk) + '\')">Igual a ' + esc(sucs[0]) + '</button>' : '') + '</div>' +
      '<div class="nt-suc-cond">' +
        '<label>Contenedor<input class="nt-c-cont" list="ntContDL" value="' + esc(c.cont || "") + '" placeholder="Contenedor"></label>' +
        '<label>Transporte' + ntSel("nt-c-transp", ntSN, c.transp || "si") + '</label>' +
        '<label>Disposición' + ntSel("nt-c-disp", ntSN, c.disp || "si") + '</label>' +
        (porSuc ? '<label>Fecha<input class="nt-c-fecha" type="date" value="' + esc(c.fecha || com.fecha) + '"></label>' +
          '' : '') +
        (su && !conDir ? '<label class="nt-ancho">Dirección<input class="nt-c-dir" value="' + esc(c.dir || "") + '" placeholder="Calle, número"></label><label>Comuna<input class="nt-c-comuna" list="ntComunaDL" value="' + esc(c.comuna || "") + '" placeholder="Comuna" oninput="ntRegionDeComuna(this)"></label>' +
          '<label>Región<input class="nt-c-region" readonly tabindex="-1" value="' + esc(regionDeComuna(c.comuna || "") || "") + '" placeholder="Se completa con la comuna"></label>' : '') +
        '<label class="nt-ancho">Detalle del cobro<textarea class="nt-c-det" rows="2">' + esc(c.detalle || "") + '</textarea></label>' +
      '</div>' +
      ntSucResHtml(sk, resSuc) +
      '<div class="nt-adj-box"><div class="nt-adj-tit">PDF respaldo de esta sucursal</div>' + ntAdjHtml(sk, resSuc) + '</div>' +
      (resSuc.length ? '<div class="tscroll"><table class="ttar nt-tab">' + cab + resSuc.map(r => {
        const key = sk + "|" + ntK(r);
        return ntFila(r, NT.cliTocado[key] ? NT.cli[key] : (NT.ref[ntK(r)] || NT.cli[key] || {}), "cli", key, "");
      }).join('') + '</table></div>' : vacio) +
    '</div>';
  });
  document.getElementById("n_cli").innerHTML = emp || sucs.length ? bloques.join('') : '<div class="muted small nt-vacio">Escribe la empresa y elige sus sucursales.</div>';
  document.getElementById("n_adj_REF").innerHTML = ntAdjHtml("REF", residuos);
  ntResumen();
}
/** La región se deduce de la comuna (sucursales sin dirección registrada, p. ej. de un prospecto). */
function ntRegionDeComuna(el) {
  const r = el.closest(".nt-suc").querySelector(".nt-c-region");
  if (r) r.value = regionDeComuna(typeof comunaCanonica === "function" ? comunaCanonica(el.value) : el.value) || "";
}

/* ---------- residuos propios de cada sucursal ---------- */
function ntResSuc(sk) {
  const quita = NT.sucQuita[sk] || [];
  const lista = mselValores("n_res").filter(r => quita.indexOf(ntK(r)) === -1);
  (NT.sucAgrega[sk] || []).forEach(r => { if (!lista.some(x => ntK(x) === ntK(r)) && quita.indexOf(ntK(r)) === -1) lista.push(r); });
  return lista;
}
function ntSucResQuitar(sk, k) {
  ntCapturar();
  (NT.sucQuita[sk] = NT.sucQuita[sk] || []).push(k);
  NT.sucAgrega[sk] = (NT.sucAgrega[sk] || []).filter(r => ntK(r) !== k);
  ntRender();
}
function ntSucResAgregar(sk, valor) {
  const v = String(valor || "").trim(); if (!v) return;
  ntCapturar();
  const canon = (CATS.residuo || []).find(o => o.toLowerCase() === v.toLowerCase()) || v;
  NT.sucQuita[sk] = (NT.sucQuita[sk] || []).filter(k => k !== ntK(canon));
  if (!mselValores("n_res").some(r => ntK(r) === ntK(canon)) && !(NT.sucAgrega[sk] || []).some(r => ntK(r) === ntK(canon))) (NT.sucAgrega[sk] = NT.sucAgrega[sk] || []).push(canon);
  ntRender();
  const inp = document.querySelector('#n_cli .nt-suc[data-sk="' + CSS.escape(sk) + '"] .nt-sres input'); if (inp) inp.focus();
}
function ntSucResHtml(sk, lista) {
  const quitados = (NT.sucQuita[sk] || []).length;
  return '<div class="nt-sres"><span class="nt-adj-tit">Residuos en esta sucursal</span>' +
    '<div class="msel-chips">' + lista.map(r => '<span class="mchip">' + esc(r) +
      '<button type="button" onclick="ntSucResQuitar(\'' + esc(sk) + '\',\'' + ntK(r) + '\')" aria-label="Quitar ' + esc(r) + '">×</button></span>').join('') + '</div>' +
    '<div class="msel-escribir"><input list="ntResDL" placeholder="Agregar residuo solo a esta sucursal y presiona Enter" onkeydown="if(event.key===\'Enter\'){event.preventDefault();ntSucResAgregar(\'' + esc(sk) + '\',this.value)}">' +
      '<button type="button" class="lnk" onclick="ntSucResAgregar(\'' + esc(sk) + '\',this.previousElementSibling.value)">Agregar</button></div>' +
    (quitados ? '<button type="button" class="lnk small" onclick="ntCapturar();NT.sucQuita[\'' + esc(sk) + '\']=[];ntRender()">Volver a incluir los ' + quitados + ' quitado(s)</button>' : '') +
  '</div>';
}

/* ---------- PDF de respaldo: uno o varios, cada uno marcado con los residuos que cubre ---------- */
function ntAdjHtml(sk, residuos) {
  const lista = NT.adj[sk] || [];
  const filas = lista.map((a, i) =>
    '<div class="nt-adj">' +
      (a.file ? '<span class="nt-adj-file">📄 ' + esc(a.file.name) + '</span>' : '<input type="file" accept="application/pdf" onchange="ntAdjArchivo(\'' + sk + '\',' + i + ',this)">') +
      '<span class="nt-adj-res"><span class="muted small">Aplica a:</span>' + (residuos.length ? residuos.map(r => {
        const k = ntK(r);
        return '<label class="nt-adj-chk"><input type="checkbox"' + (a.res.indexOf(k) !== -1 ? ' checked' : '') + ' onchange="ntAdjRes(\'' + sk + '\',' + i + ',\'' + k + '\',this.checked)"> ' + esc(r) + '</label>';
      }).join('') : '<span class="muted small">elige residuos en el paso 2</span>') + '</span>' +
      '<button type="button" class="ico-btn danger" title="Quitar este PDF" onclick="ntAdjQuitar(\'' + sk + '\',' + i + ')">−</button>' +
    '</div>').join('');
  return filas + '<button type="button" class="lnk" onclick="ntAdjAgregar(\'' + sk + '\')">+ Agregar PDF</button>';
}
function ntAdjAgregar(sk) {
  ntCapturar();
  const ya = (NT.adj[sk] || []).flatMap(a => a.res);
  // el primero cubre todos los residuos; los siguientes parten con los que aún no tienen PDF
  const res = mselValores("n_res").map(ntK).filter(k => !(NT.adj[sk] || []).length || ya.indexOf(k) === -1);
  (NT.adj[sk] = NT.adj[sk] || []).push({ file: null, res });
  ntRender();
}
function ntAdjArchivo(sk, i, el) {
  const a = (NT.adj[sk] || [])[i]; if (!a) return;
  const f = el.files && el.files[0];
  if (f && f.size > 10 * 1024 * 1024) { alert("El PDF supera 10 MB."); el.value = ""; return; }
  a.file = f || null; ntCapturar(); ntRender();
}
function ntAdjRes(sk, i, k, on) {
  const a = (NT.adj[sk] || [])[i]; if (!a) return;
  a.res = a.res.filter(x => x !== k); if (on) a.res.push(k);
  ntResumen();
}
function ntAdjQuitar(sk, i) { ntCapturar(); (NT.adj[sk] || []).splice(i, 1); ntRender(); }
/** PDF que respalda un residuo: el de la sucursal si lo tiene; si no, el de la referencial. Devuelve "sk:i" o "". */
function ntAdjPara(sk, k) {
  for (const s of [sk, "REF"]) {
    const i = (NT.adj[s] || []).findIndex(a => a.file && a.res.indexOf(k) !== -1);
    if (i !== -1) return s + ":" + i;
  }
  return "";
}

/* ---------- armado y guardado ---------- */
function ntArmar() {
  ntCapturar();
  const nombre = ntVal("n_prov");
  if (!nombre) throw new Error("Falta el proveedor.");
  const residuos = mselValores("n_res");
  if (!residuos.length) throw new Error("Elige al menos un residuo.");
  const sup = buscarProveedorClickUp(nombre);
  const num = (txt, donde) => { if (txt === "") return ""; const n = numDe(txt); if (n == null) throw new Error("Revisa el monto de " + donde + "."); return n; };
  const com = ntComunes();
  const base = {
    proveedor_id: sup ? sup.id : "", proveedor_nombre: sup ? sup.name : nombre,
    tipo_transaccion: ntVal("n_tipo") || "cobra", fuente: "", cantidad_min: "", cantidad_max: "", pdf_url: ""
  };
  const conts = mselValores("n_conts"); const cs = conts.length ? conts : [""];
  const lista = [], nuevasSucursales = [];
  // 3 · referenciales: una por residuo con monto (× contenedor), con las condiciones comunes
  residuos.forEach(r => {
    const v = NT.ref[ntK(r)] || {}; const monto = num(v.monto || "", r + " (referencial)");
    if (monto === "") return;
    cs.forEach(co => lista.push(Object.assign({}, base, { residuo: r, contenedor: co, precio: monto, moneda: v.moneda || "CLP", unidad: v.unidad || "",
      incluye_transporte: com.transp, incluye_disposicion: com.disp, fecha: com.fecha, detalle: com.detalle, _pdf: ntAdjPara("REF", ntK(r)),
      estado_servicio: "Valor general", cliente: "", estado_cliente: "", sucursal: "", direccion: "", comuna: "", region: "" })));
  });
  const nRef = lista.length;
  // 4 · por cliente: un bloque por sucursal, con sus condiciones y sus precios
  const det = document.getElementById("n_cli_det");
  const emp = ntVal("n_emp"), sucs = mselValores("n_sucs"), porSuc = !!(document.getElementById("n_fpsuc") || {}).checked;
  let sinMonto = 0;
  if (det && det.open && emp) {
    const estado = ntVal("n_estado") || "Activo", estCli = ntVal("n_estcli");
    if (norm(estado) === "ACTIVO" && !sucs.length) throw new Error("Un servicio Activo necesita al menos una sucursal.");
    (sucs.length ? sucs : [""]).forEach(su => {
      const sk = ntSK(su), c = NT.cond[sk] || com;
      const d = su ? sucursalInfo(emp, su) : null;
      const lugar = d && (d.direccion || d.comuna) ? { direccion: d.direccion, comuna: d.comuna, region: d.region }
                                                  : (cm => ({ direccion: c.dir || "", comuna: cm, region: regionDeComuna(cm) }))(c.comuna ? comunaCanonica(c.comuna) : "");
      if (su && (!d || !d.enLista)) nuevasSucursales.push(Object.assign({ empresa: emp, sucursal: su }, lugar));
      ntResSuc(sk).forEach(r => {
        const key = sk + "|" + ntK(r);
        const v = NT.cliTocado[key] ? (NT.cli[key] || {}) : (NT.ref[ntK(r)] || NT.cli[key] || {});
        const monto = num(v.monto || "", r + (su ? " en " + su : " (cliente)"));
        if (monto === "") { sinMonto++; return; }
        lista.push(Object.assign({}, base, lugar, { residuo: r, contenedor: c.cont || "", precio: monto, moneda: v.moneda || "CLP", unidad: v.unidad || "",
          incluye_transporte: c.transp || "si", incluye_disposicion: c.disp || "si", detalle: c.detalle || "",
          fecha: porSuc ? (c.fecha || com.fecha) : com.fecha, _pdf: ntAdjPara(sk, ntK(r)),
          sucursal: su, estado_servicio: estado, cliente: emp, estado_cliente: estCli }));
      });
    });
  }
  return { lista, nRef, nCli: lista.length - nRef, sinMonto, enClickUp: !!sup, nuevasSucursales };
}
function ntResumen() {
  const st = document.getElementById("n_status"); if (!st || !NT) return;
  try {
    const a = ntArmar();
    st.textContent = a.lista.length ? "Se crearán " + a.lista.length + " tarifa(s): " + a.nRef + " referencial(es)" + (a.nCli ? " + " + a.nCli + " por cliente" : "") + "." + (a.sinMonto ? " " + a.sinMonto + " residuo(s) sin monto en sucursales se omiten." : "") +
      (a.lista.length ? " " + a.lista.filter(d => d._pdf).length + " con PDF respaldo." : "") : "Ingresa al menos un monto.";
  } catch (e) { st.textContent = /Falta el proveedor|al menos un residuo/.test(e.message) ? "Completa el proveedor y elige sus residuos." : e.message; }
}
async function ntSubirPdf(file) {
  if (!file) return "";
  if (file.size > 10 * 1024 * 1024) throw new Error("El PDF " + file.name + " supera 10 MB.");
  const r = await api("subir_pdf", { nombre: file.name, base64: await leerArchivoBase64(file) }, true);
  return r.url;
}
async function ntGuardar() {
  const st = document.getElementById("n_status"), btn = document.getElementById("n_guardar");
  try {
    const a = ntArmar();
    if (!a.lista.length) throw new Error("Ingresa al menos un monto (referencial o por sucursal).");
    if (a.lista.length > 200) throw new Error("Son " + a.lista.length + " tarifas; el máximo por carga es 200. Divide la carga.");
    if (!a.enClickUp && !confirm("“" + a.lista[0].proveedor_nombre + "” no está en ClickUp. ¿Guardar igual solo con el nombre?")) return;
    if (a.lista.length > 1 && !confirm("Se crearán " + a.lista.length + " tarifas (" + a.nRef + " referenciales" + (a.nCli ? " y " + a.nCli + " por cliente" : "") + "). ¿Continuar?")) return;
    btn.disabled = true; st.textContent = "Guardando…";
    if (!sesionActiva()) await iniciarSesion();
    for (const d of a.lista) await asegurarCatalogos(d); // valores nuevos (residuo, unidad, contenedor…) pasan al catálogo y a los filtros
    // PDF de respaldo: uno común y, si se eligió, uno por sucursal
    const urls = {};
    for (const ref of [...new Set(a.lista.map(d => d._pdf).filter(Boolean))]) {
      const [sk, i] = ref.split(":"); urls[ref] = await ntSubirPdf(NT.adj[sk][+i].file);
    }
    a.lista.forEach(d => { d.pdf_url = urls[d._pdf] || ""; delete d._pdf; });
    const r = await api("tarifa_crear_lote", { tarifas: a.lista }, true);
    await refrescarTrasGuardar(r.tarifas);
    await registrarSucursales(a.nuevasSucursales);
    st.textContent = r.ids.length + " tarifa(s) guardada(s).";
    setTimeout(() => cerrarModal("nuevaTarifaModal"), 600);
  } catch (e) {
    st.textContent = "Error: " + e.message;
  } finally { if (btn) btn.disabled = false; }
}
