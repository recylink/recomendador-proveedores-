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
  NT = { ref: {}, cli: {}, cliTocado: {}, nRef: {}, nCli: {}, cond: {}, adj: {}, sucQuita: {}, sucAgrega: {}, dest: {}, destTocado: {} }; // dest[k | sk|k]: destino por residuo // ref[k#i], cli[sk|k#i]: líneas de cobro por residuo // adj: { REF | sk: [{ file, res: [claves de residuo] }] }
  Object.keys(pre.ref || {}).forEach(r => { NT.ref[ntK(r) + "#0"] = Object.assign({ moneda: "CLP", tipo: "cobra" }, pre.ref[r]); });
  const estadosCli = (CATS.estado_servicio || []).filter(e => norm(e) !== "VALORGENERAL");
  const hoy = new Date().toISOString().slice(0, 10);
  abrirModal("nuevaTarifaModal",
    '<h3>Nueva tarifa</h3><div class="muted small">Montos netos, sin IVA. Primero el proveedor y sus residuos; después el valor de referencia de cada uno y, si quieres, lo que se cobra en cada sucursal de un cliente.</div>' +
    '<datalist id="ntUnidadDL">' + (CATS.unidad || []).map(u => '<option value="' + esc(u) + '">').join('') + '</datalist>' +
    '<datalist id="ntResDL">' + (CATS.residuo || []).map(u => '<option value="' + esc(u) + '">').join('') + '</datalist>' +
    '<datalist id="ntContDL">' + (CATS.contenedor || []).map(u => '<option value="' + esc(u) + '">').join('') + '</datalist>' +
    '<datalist id="ntComunaDL">' + (typeof COMUNAS_LISTA !== "undefined" ? COMUNAS_LISTA : []).map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
    '<span id="ntDestEmpBox">' + datalistEmpresasDestino("ntDestEmpDL", pre.proveedor_nombre || "") + '</span>' +

    '<div class="nt-paso"><div class="nt-tit"><span class="nt-num">1</span> Proveedor</div>' +
      inp("n_prov", pre.proveedor_nombre || "", 'list="provDL" autocomplete="off" placeholder="Nombre del proveedor" oninput="ntProvCambio()"') +
      '<div id="n_prov_info" class="small nt-info"></div></div>' +

    '<div class="nt-paso"><div class="nt-tit"><span class="nt-num">2</span> Residuos</div>' +
      mselHtml("n_res", { opciones: CATS.residuo || [], valores: (pre.residuos || []).filter(Boolean), otro: true, placeholder: "+ residuo", onChange: ntRender }) + '</div>' +

    '<div class="nt-paso"><div class="nt-tit"><span class="nt-num">3</span> Tarifa referencial por residuo</div>' +
      '<div class="muted small">Precio de lista del proveedor, sin cliente. Cada residuo tiene su destino y puede tener varios cobros (<b>+ otro cobro</b>), cada uno con su servicio, contenedor y volumen: p. ej. retiro en Batea 30 m³ y retiro en Tolva 20 m³. Deja el monto vacío en lo que no quieras fijar.</div>' +
      '<div id="n_ref"></div>' +
      '<details class="nt-cond" open><summary>Condiciones (aplican a la referencial y son la base de cada sucursal) · * obligatorias</summary><div class="tf-grid">' +
        campo("n_fecha", "Fecha de la tarifa referencial *", '<input id="n_fecha" type="date" value="' + hoy + '">') +
        campo("n_motivo", "Motivo del precio *", sel("n_motivo", [["", "— elegir —"]].concat(MOTIVOS_PRECIO.map(x => [x, x])), "")) +
        campo("n_fuente", "Tipo de fuente *", selOtraHtml('id="n_fuente"', fuentesLista(), "", "— elegir —")) +
        campo("n_fuente_ref", "Referencia de la fuente <span class=\"muted\">· opcional</span>", inp("n_fuente_ref", "", 'placeholder="Ej: Cotización N° 123 del 15-10-2026"')) +
        campo("n_pago", "Condición de pago (días) <span class=\"muted\">· si lo dejas vacío: 120 días para Euro Constructora, 30 para el resto</span>", inp("n_pago", "", 'inputmode="numeric"')) +
        campo("n_ref_comuna", "Comuna de origen de la referencial", inp("n_ref_comuna", "", 'list="ntComunaDL" autocomplete="off" placeholder="Si aplica a una comuna"')) +
        campo("n_ref_region", "…o región de origen", sel("n_ref_region", [["", "— elegir —"]].concat(Object.keys(REGIONES_COMUNAS).map(x => [x, x])), "")) +
        campo("n_vigente", "Vigente hasta <span class=\"muted\">· opcional</span>", '<input id="n_vigente" type="date">') +
        campo("n_carga", "Carga mínima – máxima <span class=\"muted\">· opcional</span>", '<div class="tf-dos">' + inp("n_carga_min", "", 'inputmode="decimal" placeholder="mín"') + inp("n_carga_max", "", 'inputmode="decimal" placeholder="máx"') + cargaUnidadSel("n_carga_unidad", "") + '</div>') +
        campo("n_por_confirmar", "Dato por confirmar", '<label class="chk"><input type="checkbox" id="n_por_confirmar"> falta confirmar algún dato (baja la confianza)</label>') +
        campo("n_detalle", "Detalle del cobro (por qué cobra eso, condiciones)", '<textarea id="n_detalle" rows="2"></textarea>', "span2") +
        campo("n_valor_agregado", "Valor agregado <span class=\"muted\">· CO₂ evitado, material recuperado, trazabilidad…</span>", '<textarea id="n_valor_agregado" rows="2"></textarea>', "span2") +
      '</div></details>' +
      '<div class="nt-adj-box"><div class="nt-adj-tit">PDF respaldo de la referencial <span class="muted small">· también sirve para las sucursales que no tengan uno propio para ese residuo</span></div><div id="n_adj_REF"></div></div></div>' +

    '<details class="nt-paso nt-cli" id="n_cli_det"' + (pre.abrirCliente ? ' open' : '') + ' ontoggle="ntResumen()"><summary class="nt-tit"><span class="nt-num">4</span> Detalle por empresa-sucursal <span class="muted small">(opcional · carga masiva por sucursales)</span></summary>' +
      '<div class="tf-grid">' +
        campo("n_emp", "Empresa", inp("n_emp", pre.cliente || "", 'list="clienteDL" autocomplete="off" placeholder="Ej: COPEC" oninput="ntEmpresaCambio()"')) +
        campo("n_estado", "Estado del servicio", sel("n_estado", estadosCli, pre.estado_servicio && norm(pre.estado_servicio) !== "VALORGENERAL" ? pre.estado_servicio : "Activo")) +
        campo("n_estcli", "Estado del cliente", sel("n_estcli", CATS.estado_cliente || ["activo"], "activo")) +
        campo("n_fecha_cli", "Fecha de la tarifa (fecha del costo) *", '<input id="n_fecha_cli" type="date" value="' + hoy + '" oninput="ntRender()">' +
          '<label class="chk nt-chk"><input type="checkbox" id="n_fpsuc" onchange="ntRender()"> Una fecha distinta por sucursal</label>') +
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
  const dl = document.getElementById("ntDestEmpBox"); if (dl) dl.innerHTML = datalistEmpresasDestino("ntDestEmpDL", nombre);
  const s = nombre ? buscarProveedorClickUp(nombre) : null;
  if (!nombre) { box.innerHTML = ""; return; }
  const existentes = ntTarifasExistentesHtml(nombre, s);
  if (!s) { box.innerHTML = '<span class="warn">No está en ClickUp: al guardar se te pedirá crear su ficha.</span>' + existentes; return; }
  const cu = (s.residuosCU || []).filter(Boolean);
  box.innerHTML = '<span class="ok-msg">✓ ' + esc(s.name) + '</span>' +
    (cu.length ? ' · residuos en ClickUp: ' + esc(cu.slice(0, 8).join(", ")) + (cu.length > 8 ? '…' : '') +
      ' <button class="lnk" type="button" onclick="ntUsarResiduosCU()">Usar estos residuos</button>' : ' · sin residuos cargados en ClickUp') + existentes;
}
/** Tarifas activas que el proveedor ya tiene: referencial por residuo y lo cobrado a cada cliente/sucursal. */
function ntTarifasExistentesHtml(nombre, s) {
  const ts = s ? tarifasDeProveedor(s) : TARIFAS.filter(t => t.activo && norm(t.proveedor_nombre) === norm(nombre));
  if (!ts.length) return '<div class="muted small nt-exist-vacio">Este proveedor aún no tiene tarifas registradas.</div>';
  const vig = ts.filter(t => t.vigente);
  const refs = referenciales(ts).filter(f => f.conPrecio);
  const orden = t => [esGeneral(t) ? "0" : "1", t.residuo, t.cliente, t.sucursal].map(v => String(v || "")).join("|");
  const filas = vig.slice().sort((a, b) => orden(a).localeCompare(orden(b), "es"));
  const max = 40;
  return '<details class="nt-exist" open><summary>Tarifas ya registradas de este proveedor: <b>' + vig.length + '</b> vigente(s)' +
      (refs.length ? ' · referencial: ' + esc(refs.slice(0, 4).map(f => f.residuo + " " + (f.ref != null ? fmtCLP(f.ref) : fmtNum(f.refUF, 2) + " UF") + (f.unidad ? "/" + f.unidad : "")).join(" · ")) + (refs.length > 4 ? " …" : "") : '') + '</summary>' +
    '<div class="tscroll"><table class="ttar nt-exist-tab"><tr><th>Residuo</th><th>Tipo</th><th>Precio</th><th>Empresa / sucursal</th><th>Fecha</th></tr>' +
    filas.slice(0, max).map(t => '<tr><td>' + esc(t.residuo || "-") + '</td><td>' + (t.tipo === "paga" ? '<span class="pill p-paga">paga</span>' : 'cobra') + '</td>' +
      '<td class="num">' + precioHtml(t) + '</td>' +
      '<td>' + (esGeneral(t) ? '<span class="pill es-valorgeneral">Valor general</span>' : esc([t.cliente, t.sucursal].filter(Boolean).join(" · ") || "-")) + '</td>' +
      '<td class="small">' + esc(t.fecha || "-") + '</td></tr>').join('') +
    '</table></div>' + (filas.length > max ? '<div class="muted small">Se muestran ' + max + ' de ' + filas.length + '. Revisa el resto en la pestaña Tarifas.</div>' : '') +
  '</details>';
}
function ntUsarResiduosCU() {
  const s = buscarProveedorClickUp(ntVal("n_prov")); if (!s) return;
  (s.residuosCU || []).forEach(r => { if (!MSEL.n_res.valores.some(v => ntK(v) === ntK(r))) MSEL.n_res.valores.push(r); });
  mselRender("n_res"); ntRender();
}
function ntEmpresaCambio() { mselOpciones("n_sucs", sucursalesDe(ntVal("n_emp"))); ntRender(); }

/** Condiciones comunes (paso 3): base de cada sucursal. */
function ntComunes() {
  return { detalle: ntVal("n_detalle"), fecha: ntVal("n_fecha"), dir: "", comuna: "",
    motivo_precio: ntVal("n_motivo"), fuente: selOtraValor("n_fuente"), fuente_ref: ntVal("n_fuente_ref"),
    pago: ntVal("n_pago"), vigente_hasta: ntVal("n_vigente"), valor_agregado: ntVal("n_valor_agregado"),
    por_confirmar: (document.getElementById("n_por_confirmar") || {}).checked ? "si" : "",
    carga_min: ntVal("n_carga_min"), carga_max: ntVal("n_carga_max"), carga_unidad: ntVal("n_carga_unidad"),
    ref_comuna: ntVal("n_ref_comuna") ? comunaCanonica(ntVal("n_ref_comuna")) : "", ref_region: ntVal("n_ref_region") };
}

/** Guarda lo escrito (tablas y condiciones por sucursal) antes de redibujar. */
function ntCapturar() {
  if (!NT) return;
  const leer = tr => ({ tipo: tr.querySelector(".nt-tipo").value, serv: selOtraValor(tr.querySelector(".nt-serv")),
    cont: selOtraValor(tr.querySelector(".nt-cont")), vol: tr.querySelector(".nt-vol").value.trim(),
    monto: tr.querySelector(".nt-monto").value.trim(), moneda: tr.querySelector(".nt-moneda").value, unidad: selOtraValor(tr.querySelector(".nt-unidad")), ...tratCeldaValor(tr) });
  document.querySelectorAll("#n_ref tr[data-k]").forEach(tr => { NT.ref[tr.dataset.k] = leer(tr); });
  document.querySelectorAll("#n_cli tr[data-k]").forEach(tr => { NT.cli[tr.dataset.k] = leer(tr); });
  document.querySelectorAll("#nuevaTarifaModal tr[data-k] .nt-dest").forEach(c => { NT.dest[c.closest("tr").dataset.k.replace(/#\d+$/, "")] = destCeldaValor(c); });
  document.querySelectorAll("#n_cli .nt-suc[data-sk]").forEach(b => {
    const q = c => b.querySelector(c);
    NT.cond[b.dataset.sk] = {
      detalle: q(".nt-c-det").value.trim(),
      fecha: q(".nt-c-fecha") ? q(".nt-c-fecha").value : (NT.cond[b.dataset.sk] || {}).fecha,
      dir: q(".nt-c-dir") ? q(".nt-c-dir").value.trim() : "", comuna: q(".nt-c-comuna") ? q(".nt-c-comuna").value.trim() : ""
    };
  });
}
/** Cantidad de líneas de cobro: referencial por residuo; en cada sucursal sigue a la referencial salvo que se cambie ahí. */
const ntNRef = k => NT.nRef[k] || 1;
const ntNCli = (base, k) => NT.nCli[base] != null ? NT.nCli[base] : ntNRef(k);
const ntCab = '<tr><th>Residuo</th><th>Destino</th><th>Tipo</th><th>Servicio *</th><th>Tratamiento</th><th>Contenedor</th><th>m³</th><th>Monto</th><th>Moneda</th><th>Unidad</th><th></th></tr>';
/** Servicio de un cobro (obligatorio). */
function ntServSel(cls, val, attrs) { return selOtraHtml('class="' + cls + '"' + (attrs || ''), tiposServicio(), val, "— elegir —"); }
/** Destino de un residuo: el de la sucursal si se cambió ahí; si no, el de la referencial. */
const ntDestDe = (b, k) => NT.destTocado[b] ? NT.dest[b] || "" : NT.dest[k] || NT.dest[b] || "";
function ntDestEditado(cual, base) {
  ntCapturar();
  if (cual === "cli") { NT.destTocado[base] = true; return; }
  document.querySelectorAll('#n_cli tr[data-k$="|' + CSS.escape(base) + '#0"]').forEach(tr => {
    const b = tr.dataset.k.replace(/#0$/, "");
    if (NT.destTocado[b]) return;
    destCeldaPoner(tr.querySelector(".nt-dest"), NT.dest[base] || ""); NT.dest[b] = NT.dest[base] || "";
  });
}
/** Unidad de un cobro: lista del catálogo + "Otra…". */
function ntUnidadSel(val, attrs) { return selOtraHtml('class="nt-unidad"' + (attrs || ''), unidadesLista(), val, "Unidad"); }
/** Una línea de cobro. base = k (referencial) o sk|k (sucursal); key = base#i. */
function ntFila(r, i, v, cual, base, ayuda) {
  const key = base + "#" + i, ed = "ntEditado('" + cual + "','" + esc(key) + "')";
  return '<tr data-k="' + esc(key) + '"' + (i ? ' class="nt-linea"' : '') + '><td>' +
      (i ? '<span class="muted small">↳ otro cobro</span>' : '<b>' + esc(r) + '</b>' + (ayuda ? '<div class="muted small">' + ayuda + '</div>' : '') +
        '<div><button type="button" class="lnk small" onclick="ntAgregarLinea(\'' + cual + '\',\'' + esc(base) + '\')">+ otro cobro</button></div>') + '</td>' +
    '<td>' + (i ? '<span class="muted small">el de arriba</span>' : destinoCeldaHtml(cual === "ref" ? NT.dest[base] || "" : ntDestDe(base, base.split("|")[1]), "ntDestEditado(\'" + cual + "\',\'" + esc(base) + "\')")) + '</td>' +
    '<td><select class="nt-tipo" onchange="' + ed + '"><option value="cobra"' + (v.tipo !== "paga" ? ' selected' : '') + '>Cobra</option><option value="paga"' + (v.tipo === "paga" ? ' selected' : '') + '>Paga</option></select></td>' +
    '<td>' + ntServSel("nt-serv", v.serv || "", ' onchange="' + ed + '"') + '</td>' +
    '<td>' + tratCeldaHtml(r, v, ed) + '</td>' +
    '<td>' + contSel(v.cont || "", ' onchange="' + ed + '"', "Sin contenedor") + '</td>' +
    '<td><input class="nt-vol" inputmode="decimal" placeholder="m³" value="' + esc(v.vol || "") + '" oninput="' + ed + '"></td>' +
    '<td><input class="nt-monto" inputmode="decimal" placeholder="Monto" value="' + esc(v.monto || "") + '" oninput="' + ed + '"></td>' +
    '<td><select class="nt-moneda" onchange="' + ed + '">' + (CATS.moneda || ["CLP", "UF"]).map(m => '<option' + (m === (v.moneda || "CLP") ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select></td>' +
    '<td>' + ntUnidadSel(v.unidad || "", ' oninput="' + ed + '"') + '</td>' +
    '<td>' + (i ? '<button type="button" class="ico-btn danger" title="Quitar este cobro" onclick="ntQuitarLinea(\'' + cual + '\',\'' + esc(base) + '\',' + i + ')">−</button>' : '') + '</td></tr>';
}
/** Lo escrito en la referencial se copia a cada sucursal mientras esa línea no se haya tocado. */
function ntEditado(cual, key) {
  ntCapturar();
  if (cual === "cli") NT.cliTocado[key] = true;
  if (cual === "ref") {
    document.querySelectorAll('#n_cli tr[data-k$="|' + CSS.escape(key) + '"]').forEach(tr => {
      if (NT.cliTocado[tr.dataset.k]) return;
      const v = NT.ref[key] || {};
      tr.querySelector(".nt-tipo").value = v.tipo || "cobra"; selOtraPoner(tr.querySelector(".nt-serv"), v.serv || "");
      selOtraPoner(tr.querySelector(".nt-cont"), v.cont || ""); tr.querySelector(".nt-vol").value = v.vol || "";
      tr.querySelector(".nt-monto").value = v.monto || ""; tr.querySelector(".nt-moneda").value = v.moneda || "CLP"; selOtraPoner(tr.querySelector(".nt-unidad"), v.unidad || "");
      tratCeldaPoner(tr, v);
      NT.cli[tr.dataset.k] = Object.assign({}, v);
    });
  }
  ntResumen();
}
function ntAgregarLinea(cual, base) {
  ntCapturar();
  if (cual === "ref") NT.nRef[base] = ntNRef(base) + 1;
  else { const k = base.split("|")[1]; NT.nCli[base] = ntNCli(base, k) + 1; }
  ntRender();
}
/** Quita la línea i y corre las siguientes un lugar. */
function ntQuitarLinea(cual, base, i) {
  ntCapturar();
  const datos = cual === "ref" ? NT.ref : NT.cli;
  const k = cual === "ref" ? base : base.split("|")[1];
  const n = cual === "ref" ? ntNRef(base) : ntNCli(base, k);
  for (let j = i; j < n - 1; j++) {
    datos[base + "#" + j] = datos[base + "#" + (j + 1)];
    if (cual === "cli") NT.cliTocado[base + "#" + j] = NT.cliTocado[base + "#" + (j + 1)];
  }
  delete datos[base + "#" + (n - 1)]; delete NT.cliTocado[base + "#" + (n - 1)];
  if (cual === "ref") NT.nRef[base] = n - 1; else NT.nCli[base] = n - 1;
  ntRender();
}
/** Copia condiciones, residuos y cobros de la primera sucursal a otra. */
function ntCopiarPrimera(sk) {
  ntCapturar();
  const sucs = mselValores("n_sucs"); if (!sucs.length) return;
  const sk0 = ntSK(sucs[0]);
  const c0 = NT.cond[sk0] || {};
  NT.cond[sk] = Object.assign({}, c0, { dir: (NT.cond[sk] || {}).dir || "", comuna: (NT.cond[sk] || {}).comuna || "" });
  NT.sucQuita[sk] = (NT.sucQuita[sk0] || []).slice();
  NT.sucAgrega[sk] = (NT.sucAgrega[sk0] || []).slice();
  ntResSuc(sk0).forEach(r => {
    const k = ntK(r), a0 = sk0 + "|" + k, b0 = sk + "|" + k, n = ntNCli(a0, k);
    NT.nCli[b0] = n;
    for (let i = 0; i < n; i++) {
      const a = a0 + "#" + i, b = b0 + "#" + i;
      NT.cli[b] = Object.assign({}, NT.cliTocado[a] ? NT.cli[a] : (NT.ref[k + "#" + i] || NT.cli[a] || {})); NT.cliTocado[b] = true;
    }
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
  const cab = ntCab;
  const vacio = '<div class="muted small nt-vacio">Elige al menos un residuo en el paso 2.</div>';
  document.getElementById("n_ref").innerHTML = residuos.length ? '<div class="tscroll"><table class="ttar nt-tab">' + cab + residuos.map(r => {
    const k = ntK(r), a = actuales[k], filas = [];
    for (let i = 0; i < ntNRef(k); i++) {
      const v = NT.ref[k + "#" + i] || (i === 0 && a ? { unidad: a.unidad || "", tipo: a.paga ? "paga" : "cobra" } : { tipo: "cobra" });
      filas.push(ntFila(r, i, v, "ref", k, i === 0 && a ? 'actual: ' + esc((a.ref != null ? fmtCLP(a.ref) : fmtNum(a.refUF, 2) + " UF") + (a.unidad ? " / " + a.unidad : "") + " · " + a.nota) : ""));
    }
    return filas.join('');
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
        (porSuc ? '<label>Fecha<input class="nt-c-fecha" type="date" value="' + esc(c.fecha || ntVal("n_fecha_cli") || com.fecha) + '"></label>' +
          '' : '') +
        (su && !conDir ? '<label class="nt-ancho">Dirección<input class="nt-c-dir" value="' + esc(c.dir || "") + '" placeholder="Calle, número"></label><label>Comuna<input class="nt-c-comuna" list="ntComunaDL" value="' + esc(c.comuna || "") + '" placeholder="Comuna" oninput="ntRegionDeComuna(this)"></label>' +
          '<label>Región<input class="nt-c-region" readonly tabindex="-1" value="' + esc(regionDeComuna(c.comuna || "") || "") + '" placeholder="Se completa con la comuna"></label>' : '') +
        '<label class="nt-ancho">Detalle del cobro<textarea class="nt-c-det" rows="2">' + esc(c.detalle || "") + '</textarea></label>' +
      '</div>' +
      ntSucResHtml(sk, resSuc) +
      '<div class="nt-adj-box"><div class="nt-adj-tit">PDF respaldo de esta sucursal</div>' + ntAdjHtml(sk, resSuc) + '</div>' +
      (resSuc.length ? '<div class="tscroll"><table class="ttar nt-tab">' + cab + resSuc.map(r => {
        const k = ntK(r), base = sk + "|" + k, filas = [];
        for (let i = 0; i < ntNCli(base, k); i++) {
          const key = base + "#" + i;
          filas.push(ntFila(r, i, NT.cliTocado[key] ? NT.cli[key] : (NT.ref[k + "#" + i] || NT.cli[key] || { tipo: "cobra" }), "cli", base, ""));
        }
        return filas.join('');
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
  const vol = txt => { if (!txt) return ""; const n = numDe(txt); if (n == null) throw new Error("Revisa el volumen: " + txt); return n; };
  const base = {
    proveedor_id: sup ? sup.id : "", proveedor_nombre: sup ? sup.name : nombre,
    cantidad_min: vol(com.carga_min), cantidad_max: vol(com.carga_max), carga_unidad: com.carga_unidad, pdf_url: "",
    motivo_precio: com.motivo_precio, fuente: com.fuente, fuente_ref: com.fuente_ref,
    vigente_hasta: com.vigente_hasta, por_confirmar: com.por_confirmar, valor_agregado: com.valor_agregado
  };
  // tratamiento y destrucción de marca solo en los cobros con disposición o compra (Q11)
  const trat = v => conTratamiento(v.serv) ? { tratamiento: v.trat || "", incluye_destruccion_marca: v.dm || "" } : { tratamiento: "", incluye_destruccion_marca: "" };
  const pagoPara = cli => com.pago !== "" ? vol(com.pago) : pagoDiasPorDefecto(cli);
  const lista = [], nuevasSucursales = [];
  // 3 · referenciales: una por residuo con monto (× contenedor), con las condiciones comunes
  residuos.forEach(r => { const k = ntK(r); for (let i = 0; i < ntNRef(k); i++) {
    const v = NT.ref[k + "#" + i] || {}; const monto = num(v.monto || "", r + " (referencial)");
    if (monto === "") continue;
    const dest = NT.dest[k] || "";
    lista.push(Object.assign({}, base, { residuo: r, contenedor: v.cont || "", precio: monto, moneda: v.moneda || "CLP", unidad: v.unidad || "",
      tipo_transaccion: v.tipo === "paga" ? "paga" : "cobra", tipo_servicio: v.serv || "", volumen_m3: vol(v.vol || ""),
      destino: dest, comuna_destino: comunaDeDestino(dest), ...trat(v),
      fecha: com.fecha, detalle: com.detalle, _pdf: ntAdjPara("REF", ntK(r)),
      estado_servicio: "Valor general", cliente: "", estado_cliente: "", sucursal: "", direccion: "",
      comuna: com.ref_comuna, region: com.ref_comuna ? regionDeComuna(com.ref_comuna) : com.ref_region, condicion_pago_dias: pagoPara("") }));
  } });
  const nRef = lista.length;
  // 4 · por cliente: un bloque por sucursal, con sus condiciones y sus precios
  const det = document.getElementById("n_cli_det");
  const emp = ntVal("n_emp"), sucs = mselValores("n_sucs"), porSuc = !!(document.getElementById("n_fpsuc") || {}).checked;
  const fechaCli = ntVal("n_fecha_cli") || com.fecha;
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
      ntResSuc(sk).forEach(r => { const k = ntK(r), b = sk + "|" + k; for (let i = 0; i < ntNCli(b, k); i++) {
        const key = b + "#" + i;
        const v = NT.cliTocado[key] ? (NT.cli[key] || {}) : (NT.ref[k + "#" + i] || NT.cli[key] || {});
        const monto = num(v.monto || "", r + (su ? " en " + su : " (cliente)"));
        if (monto === "") { sinMonto++; continue; }
        const dest = ntDestDe(b, k);
        lista.push(Object.assign({}, base, lugar, { residuo: r, contenedor: v.cont || "", precio: monto, moneda: v.moneda || "CLP", unidad: v.unidad || "",
          tipo_transaccion: v.tipo === "paga" ? "paga" : "cobra", tipo_servicio: v.serv || "", volumen_m3: vol(v.vol || ""),
          destino: dest, comuna_destino: comunaDeDestino(dest), ...trat(v),
          detalle: c.detalle || "",
          fecha: porSuc ? (c.fecha || fechaCli) : fechaCli, _pdf: ntAdjPara(sk, ntK(r)),
          sucursal: su, estado_servicio: estado, cliente: emp, estado_cliente: estCli, condicion_pago_dias: pagoPara(emp) }));
      } });
    });
  }
  return { lista, nRef, nCli: lista.length - nRef, sinMonto, enClickUp: !!sup, nuevasSucursales };
}
function ntResumen() {
  const st = document.getElementById("n_status"); if (!st || !NT) return;
  try {
    const a = ntArmar();
    st.textContent = a.lista.length ? "Se crearán " + a.lista.length + " tarifa(s): " + a.nRef + " referencial(es)" + (a.nCli ? " + " + a.nCli + " por cliente" : "") + "." + (a.sinMonto ? " " + a.sinMonto + " cobro(s) sin monto en sucursales se omiten." : "") +
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
    const faltan = a.lista.map(d => ({ d, f: faltantesMinimos(d) })).find(x => x.f.length);
    if (faltan) throw new Error(textoFaltantes(faltan.d, faltan.f));
    if (a.lista.length > 200) throw new Error("Son " + a.lista.length + " tarifas; el máximo por carga es 200. Divide la carga.");
    if (a.lista.length > 1 && !confirm("Se crearán " + a.lista.length + " tarifas (" + a.nRef + " referenciales" + (a.nCli ? " y " + a.nCli + " por cliente" : "") + ")" + (a.enClickUp ? "" : " y antes se creará la ficha del proveedor en ClickUp") + ". ¿Continuar?")) return;
    if (!sesionActiva()) await iniciarSesion();
    if (!a.enClickUp) { ntPedirFicha(a); return; } // paso siguiente obligatorio: la ficha en ClickUp
    btn.disabled = true;
    await ntGuardarLista(a);
  } catch (e) {
    st.textContent = "Error: " + e.message;
  } finally { if (btn) btn.disabled = false; }
}

/** Sube los PDF y guarda las tarifas armadas. */
async function ntGuardarLista(a) {
  const st = document.getElementById("n_status");
  if (st) st.textContent = "Guardando…";
  for (const d of a.lista) await asegurarCatalogos(d); // valores nuevos (residuo, unidad, contenedor…) pasan al catálogo y a los filtros
  const urls = {};
  for (const ref of [...new Set(a.lista.map(d => d._pdf).filter(Boolean))]) {
    const [sk, i] = ref.split(":"); urls[ref] = await ntSubirPdf(NT.adj[sk][+i].file);
  }
  a.lista.forEach(d => { d.pdf_url = urls[d._pdf] || ""; delete d._pdf; });
  const r = await api("tarifa_crear_lote", { tarifas: a.lista }, true);
  await refrescarTrasGuardar(r.tarifas);
  await registrarSucursales(a.nuevasSucursales);
  if (st) st.textContent = r.ids.length + " tarifa(s) guardada(s).";
  setTimeout(() => cerrarModal("nuevaTarifaModal"), 600);
  return r;
}

/** El proveedor no está en ClickUp: se abre "Crear ficha" con lo cargado; al crearla se guardan las tarifas ligadas a ella. */
function ntPedirFicha(a) {
  const st = document.getElementById("n_status");
  const nombre = a.lista[0].proveedor_nombre;
  const residuos = unicosOrdenados(a.lista.map(d => d.residuo));
  const regiones = unicosOrdenados(a.lista.map(d => d.region).filter(Boolean));
  if (st) st.textContent = "Falta crear la ficha de " + nombre + " en ClickUp para guardar.";
  abrirFichaClickUp(nombre, {
    residuos, regiones,
    origen: "Paso siguiente: " + nombre + " no está en ClickUp. Crea su ficha para guardar las " + a.lista.length + " tarifa(s); quedarán ligadas a ella.",
    textoBoton: "Crear ficha y guardar tarifas",
    onCreada: async (r) => {
      a.lista.forEach(d => { d.proveedor_id = r.id; d.proveedor_nombre = r.nombre || nombre; });
      await ntGuardarLista(a);
    }
  });
}
