/* ============================================================
   HISTORIAL DE PRECIOS (Ecosistema 3.0, fase 3)
   - Dispersión de precios por fecha de la tarifa: residuo × tipo de servicio × unidad,
     opcional región y proveedor. Color = proveedor, forma = tipo de fuente,
     relleno = vigente (hueco = valor anterior, reemplazado o dado de baja).
   - Puntos: todas las tarifas (también las no vigentes) + los valores previos que guarda
     el Historial cuando se editó el precio (una tarifa de $50.000 a $57.000 deja dos puntos).
   - Eje Y en UF o en pesos; cada punto se convierte con la UF de SU fecha (mindicador.cl).
   - Sin línea de tendencia (decisión Q24).
   Depende de js/tarifas.js (TARIFAS, HISTORIAL_GID, filasAObjetos, unicosOrdenados…).
   ============================================================ */

let HIS = { residuo: "", servicio: "", unidad: "", region: "", prov: "", moneda: "UF", bajas: false, trat: "" };
let HIS_PREVIOS = null;   // valores previos del Historial (se leen una vez)
let HIS_PREVIOS_ERR = "";
const UF_DIA = {};        // "2026-10-21" -> valor UF
const UF_ANIOS = {};      // año -> "ok" | promesa

// 4 colores validados (todos los pares, fondo claro) + gris para el resto: la forma y la tabla
// llevan la identidad cuando el color no alcanza.
const HIS_COLORES = ["#2a78d6", "#eda100", "#1baf7a", "#e87ba4"];
const HIS_OTROS = "#98A2B3";
const HIS_FORMAS = [
  { f: "circulo", txt: "Contrato o acuerdo", fuentes: ["Contratos de clientes", "Licitaciones privadas de clientes", "Facturas y órdenes de compra", "Análisis de ahorro y líneas base"] },
  { f: "triangulo", txt: "Cotización u oferta", fuentes: ["Cotizaciones de proveedores", "Cartas de oferta de gestores", "Propuestas comerciales de Recylink", "Licitaciones públicas"] },
  { f: "cuadrado", txt: "Plataforma o Marketplace", fuentes: ["Plataforma de trazabilidad", "Marketplace Recylink", "SINADER / RETC"] },
  { f: "rombo", txt: "Otras fuentes", fuentes: [] }
];
const formaDe = fuente => (HIS_FORMAS.find(x => x.fuentes.includes(fuente)) || HIS_FORMAS[3]).f;

/* ---------------- UF por fecha ---------------- */
async function cargarUFAnio(anio) {
  if (UF_ANIOS[anio] === "ok") return;
  if (UF_ANIOS[anio]) return UF_ANIOS[anio];
  const hoy = new Date().toISOString().slice(0, 10);
  const cache = lsGet("rp_uf_" + anio);
  // años pasados no cambian; el año en curso se refresca una vez al día
  if (cache && cache.serie && (String(anio) < hoy.slice(0, 4) || cache.fecha === hoy)) {
    Object.assign(UF_DIA, cache.serie); UF_ANIOS[anio] = "ok"; return;
  }
  UF_ANIOS[anio] = (async () => {
    try {
      // mindicador a veces no responde: a los 8 s se sigue con el caché o con la UF del día (si no, la vista quedaba cargando)
      const ctrl = new AbortController(), corte = setTimeout(() => ctrl.abort(), 8000);
      let j;
      try { j = await (await fetch(UF_API + "/" + anio, { signal: ctrl.signal })).json(); } finally { clearTimeout(corte); }
      const serie = {};
      (j.serie || []).forEach(x => { serie[String(x.fecha).slice(0, 10)] = x.valor; });
      Object.assign(UF_DIA, serie);
      lsSet("rp_uf_" + anio, { fecha: hoy, serie });
    } catch (e) { if (cache && cache.serie) Object.assign(UF_DIA, cache.serie); }
    UF_ANIOS[anio] = "ok";
  })();
  return UF_ANIOS[anio];
}
/** UF del día (o del último día anterior con valor); si no hay serie, la guardada en la tarifa o la de hoy. */
function ufDe(fecha, respaldo) {
  const f = String(fecha || "").slice(0, 10);
  if (UF_DIA[f]) return UF_DIA[f];
  const antes = Object.keys(UF_DIA).filter(d => d <= f).sort().pop();
  return antes ? UF_DIA[antes] : respaldo || UF.valor || null;
}

/* ---------------- puntos ---------------- */
async function cargarPreviosHistorial() {
  if (HIS_PREVIOS) return;
  try {
    const rows = filasAObjetos(await gvizFetch(MIRROR_SHEET_ID, HISTORIAL_GID, true, true));
    // Una edición = misma tarifa y mismo instante; trae juntos precio, moneda, unidad y fecha anteriores.
    const ed = {};
    rows.filter(h => h.accion === "editar" && ["precio", "moneda", "unidad", "fecha"].includes(h.campo))
      .forEach(h => { const k = h.tarifa_id + "|" + h.fecha; (ed[k] = ed[k] || { id: h.tarifa_id, cuando: h.fecha, campos: {} }).campos[h.campo] = h.valor_anterior; });
    HIS_PREVIOS = Object.values(ed).filter(e => numDe(e.campos.precio) != null);
  } catch (e) { HIS_PREVIOS = []; HIS_PREVIOS_ERR = (e && e.message) || String(e); }
}

/** Todos los puntos posibles (antes de filtrar por residuo, servicio, etc.). */
function puntosHistorial() {
  const base = t => ({ t, prov: t.proveedor_nombre, provKey: t.provKey, residuo: t.residuo, servicio: t.tipo_servicio, tipo: t.tipo,
    region: t.region || "", empresa: t.cliente, sucursal: t.sucursal, fuente: t.fuente || "", motivo: tget(t, "motivo_precio"), ufGuardada: numDe(t.valor_uf),
    trat: tget(t, "tratamiento") || SIN_TRAT });
  const out = [];
  TARIFAS.filter(t => (t.activo || HIS.bajas) && t.precio_num != null && t.precio_num > 1 && tget(t, "fecha") && t.unidad).forEach(t => {
    out.push(Object.assign(base(t), { fecha: tget(t, "fecha").slice(0, 10), precio: t.precio_num, moneda: t.moneda, unidad: t.unidad,
      estado: !t.activo ? "baja" : t.vigente ? "vigente" : "reemplazada" }));
  });
  const porId = {};
  TARIFAS.forEach(t => { porId[t.id] = t; });
  (HIS_PREVIOS || []).forEach(e => {
    const t = porId[e.id]; if (!t || (!t.activo && !HIS.bajas)) return;
    const precio = numDe(e.campos.precio); if (precio == null || precio <= 1) return;
    const unidad = "unidad" in e.campos ? e.campos.unidad : t.unidad; if (!unidad) return;
    out.push(Object.assign(base(t), { fecha: String(e.campos.fecha || tget(t, "fecha")).slice(0, 10), precio, unidad,
      moneda: String(("moneda" in e.campos ? e.campos.moneda : t.moneda) || "CLP").toUpperCase(),
      estado: "previo", editadoEl: String(e.cuando).slice(0, 10), ufGuardada: null }));
  });
  return out.filter(p => p.fecha);
}
function valorPunto(p) {
  if (p.moneda === HIS.moneda || (p.moneda !== "UF" && HIS.moneda === "CLP")) return p.precio;
  const uf = ufDe(p.fecha, p.ufGuardada); if (!uf) return null;
  return p.moneda === "UF" ? p.precio * uf : p.precio / uf;
}
const fmtHis = v => HIS.moneda === "UF" ? fmtNum(v, v < 1 ? 4 : v < 10 ? 3 : 2) + " UF" : fmtCLP(v);
const ESTADO_TXT = { vigente: "vigente", reemplazada: "reemplazada por una más nueva", baja: "dada de baja", previo: "valor anterior" };

/* ---------------- vista ---------------- */
function abrirVistaTar(v) {
  document.getElementById("tarList").style.display = v === "lista" ? "" : "none";
  document.getElementById("tarCount").style.display = v === "lista" ? "" : "none";
  document.getElementById("tarComparar").style.display = v === "cmp" ? "" : "none";
  document.getElementById("tarHistorial").style.display = v === "his" ? "" : "none";
  document.querySelectorAll(".tar-vista button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  if (v === "cmp") renderComparar();
  if (v === "his") abrirHistorialPrecios();
}
async function abrirHistorialPrecios() {
  const box = document.getElementById("tarHistorial");
  if (!HIS_PREVIOS) box.innerHTML = '<div class="spinner-row"><span class="spinner"></span> Cargando historial y valores UF…</div>';
  const anios = unicosOrdenados(TARIFAS.map(t => tget(t, "fecha").slice(0, 4)).filter(a => /^\d{4}$/.test(a)));
  await Promise.all([cargarPreviosHistorial()].concat(anios.map(cargarUFAnio)));
  renderHistorialPrecios();
}

function renderHistorialPrecios() {
  const box = document.getElementById("tarHistorial"); if (!box || box.style.display === "none") return;
  const todos = puntosHistorial();
  const sel = (id, opts, val, fn) => '<select id="' + id + '" onchange="' + fn + '">' + opts.map(o => '<option value="' + esc(o.v) + '"' + (o.v === val ? ' selected' : '') + '>' + esc(o.txt) + '</option>').join('') + '</select>';
  const conteo = (l, campo) => { const c = {}; l.forEach(p => { c[p[campo]] = (c[p[campo]] || 0) + 1; }); return c; };
  const opc = (c, orden) => (orden || Object.keys(c).sort((a, b) => a.localeCompare(b, "es"))).map(v => ({ v, txt: v + " (" + c[v] + ")" }));
  // Residuo → servicio → unidad: cada paso muestra solo lo que tiene datos
  const cRes = conteo(todos, "residuo");
  if (!cRes[HIS.residuo]) HIS.residuo = masFrecuente(todos.map(p => p.residuo));
  const p1 = todos.filter(p => p.residuo === HIS.residuo), cServ = conteo(p1, "servicio");
  if (!cServ[HIS.servicio]) HIS.servicio = masFrecuente(p1.map(p => p.servicio).filter(v => v !== "Arriendo")) || masFrecuente(p1.map(p => p.servicio));
  const p2 = p1.filter(p => p.servicio === HIS.servicio), cUni = conteo(p2, "unidad");
  if (!cUni[HIS.unidad]) HIS.unidad = masFrecuente(p2.map(p => p.unidad));
  let p3 = p2.filter(p => p.unidad === HIS.unidad);
  // tratamiento (solo en servicios con disposición o compra): no se mezclan precios de tratamientos distintos si se elige uno
  const conTr = conTratamiento(HIS.servicio), cTrat = conTr ? conteo(p3, "trat") : {};
  if (!conTr || (HIS.trat && !cTrat[HIS.trat])) HIS.trat = "";
  if (HIS.trat) p3 = p3.filter(p => p.trat === HIS.trat);
  // "cobra" y "paga" no se mezclan: manda el que tenga más puntos
  const paga = p3.filter(p => p.tipo === "paga").length > p3.length / 2;
  p3 = p3.filter(p => (p.tipo === "paga") === paga);
  // Color por proveedor: los 4 con más puntos en residuo × servicio × unidad (no cambia al filtrar región o proveedor)
  const cProv = conteo(p3, "prov");
  const ranking = Object.keys(cProv).sort((a, b) => cProv[b] - cProv[a] || a.localeCompare(b, "es"));
  const colorDe = prov => { const i = ranking.indexOf(prov); return i > -1 && i < HIS_COLORES.length ? HIS_COLORES[i] : HIS_OTROS; };
  const cReg = conteo(p3.filter(p => p.region), "region");
  if (HIS.region && !cReg[HIS.region]) HIS.region = "";
  const p4 = p3.filter(p => !HIS.region || p.region === HIS.region);
  const cProv4 = conteo(p4, "prov");
  if (HIS.prov && !cProv4[HIS.prov]) HIS.prov = "";
  const pts = p4.filter(p => !HIS.prov || p.prov === HIS.prov).map(p => Object.assign(p, { v: valorPunto(p) })).filter(p => p.v != null);
  pts.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.prov.localeCompare(b.prov, "es"));
  const u = " / " + HIS.unidad;

  box.innerHTML =
    '<div class="cmp-filtros">' +
      '<label>Residuo' + sel("hisRes", opc(cRes), HIS.residuo, "HIS.residuo=this.value;renderHistorialPrecios()") + '</label>' +
      '<label>Tipo de servicio' + sel("hisServ", opc(cServ), HIS.servicio, "HIS.servicio=this.value;renderHistorialPrecios()") + '</label>' +
      '<label>Unidad' + sel("hisUni", opc(cUni), HIS.unidad, "HIS.unidad=this.value;renderHistorialPrecios()") + '</label>' +
      (conTr ? '<label>Tratamiento' + sel("hisTrat", [{ v: "", txt: "Todos" }].concat(opc(cTrat)), HIS.trat, "HIS.trat=this.value;renderHistorialPrecios()") + '</label>' : '') +
      '<label>Región' + sel("hisReg", [{ v: "", txt: "Todas" }].concat(opc(cReg)), HIS.region, "HIS.region=this.value;renderHistorialPrecios()") + '</label>' +
      '<label>Proveedor' + sel("hisProv", [{ v: "", txt: "Todos" }].concat(opc(cProv4)), HIS.prov, "HIS.prov=this.value;renderHistorialPrecios()") + '</label>' +
      '<div class="cmp-toggle" role="group" aria-label="Moneda del eje"><button type="button" class="' + (HIS.moneda === "UF" ? "on" : "") + '" onclick="HIS.moneda=\'UF\';renderHistorialPrecios()">UF</button><button type="button" class="' + (HIS.moneda === "CLP" ? "on" : "") + '" onclick="HIS.moneda=\'CLP\';renderHistorialPrecios()">Pesos</button></div>' +
    '</div>' +
    (HIS_PREVIOS_ERR ? '<p class="warn small">No se pudo leer el Historial (' + esc(HIS_PREVIOS_ERR) + '): faltan los valores anteriores de las tarifas editadas.</p>' : '') +
    (!pts.length ? '<div class="empty">Sin precios para ' + esc(HIS.residuo) + ' · ' + esc(HIS.servicio) + u + (HIS.region ? ' en ' + esc(HIS.region) : '') + '.</div>' :
    '<div class="cmp-box">' +
      '<div class="cmp-cab"><b>' + esc(paga ? "Lo que paga el proveedor" : "Lo que cobra el proveedor") + ' · ' + resTag(HIS.residuo) + ' · ' + esc(HIS.servicio) + ' en ' + (HIS.moneda === "UF" ? "UF" : "pesos") + esc(u) + (HIS.region ? ' · ' + esc(HIS.region) : '') + '</b>' +
        '<span class="muted">' + pts.length + ' precio' + (pts.length > 1 ? 's' : '') + ' · ' + new Set(pts.map(p => p.prov)).size + ' proveedor' + (new Set(pts.map(p => p.prov)).size > 1 ? 'es' : '') + '</span></div>' +
      leyendaHistorial(pts, colorDe) +
      '<div id="hisGraf" class="his-graf"></div>' +
      '<div class="muted small">Cada punto es un precio en la fecha de su tarifa. Relleno = vigente; hueco = valor anterior (reemplazado por una tarifa más nueva, editado o dado de baja). ' +
        (HIS.moneda === "UF" ? 'Precios en pesos llevados a UF' : 'Precios en UF llevados a pesos') + ' con la UF de la fecha de cada punto. Sin línea de tendencia.</div>' +
      tablaHistorial(pts, colorDe, u) +
    '</div>');
  if (pts.length) dibujarHistorial(pts, colorDe, u);
}

function leyendaHistorial(pts, colorDe) {
  const provs = unicosOrdenados(pts.map(p => p.prov)).sort((a, b) => (colorDe(a) === HIS_OTROS) - (colorDe(b) === HIS_OTROS) || HIS_COLORES.indexOf(colorDe(a)) - HIS_COLORES.indexOf(colorDe(b)));
  const conColor = provs.filter(p => colorDe(p) !== HIS_OTROS), otros = provs.length - conColor.length;
  const formas = unicosOrdenados(pts.map(p => formaDe(p.fuente)));
  return '<div class="his-ley">' +
    conColor.map(p => '<span><i class="his-sw" style="background:' + colorDe(p) + '"></i>' + esc(p) + '</span>').join('') +
    (otros ? '<span><i class="his-sw" style="background:' + HIS_OTROS + '"></i>' + (conColor.length ? 'Otros ' : '') + otros + ' proveedor' + (otros > 1 ? 'es' : '') + '</span>' : '') +
    '<span class="his-sep"></span>' +
    HIS_FORMAS.filter(x => formas.includes(x.f)).map(x => '<span>' + formaSvg(x.f, "#475467", true, 6) + esc(x.txt) + '</span>').join('') +
    (pts.some(p => p.estado !== "vigente") ? '<span>' + formaSvg("circulo", "#475467", false, 6) + 'Valor anterior</span>' : '') +
    '</div>';
}
/** Marca en un SVG chico para la leyenda. */
function formaSvg(f, color, lleno, r) {
  const s = r * 2 + 4;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '" aria-hidden="true" class="his-ico">' + marca(f, s / 2, s / 2, r, color, lleno) + '</svg>';
}
function marca(f, x, y, r, color, lleno) {
  const pint = lleno ? 'fill="' + color + '" stroke="#fff" stroke-width="1.5"' : 'fill="#fff" stroke="' + color + '" stroke-width="2"';
  if (f === "triangulo") return '<polygon points="' + x + ',' + (y - r * 1.15) + ' ' + (x + r * 1.1) + ',' + (y + r * 0.85) + ' ' + (x - r * 1.1) + ',' + (y + r * 0.85) + '" ' + pint + '/>';
  if (f === "cuadrado") return '<rect x="' + (x - r * 0.9) + '" y="' + (y - r * 0.9) + '" width="' + r * 1.8 + '" height="' + r * 1.8 + '" rx="1.5" ' + pint + '/>';
  if (f === "rombo") return '<polygon points="' + x + ',' + (y - r * 1.2) + ' ' + (x + r * 1.2) + ',' + y + ' ' + x + ',' + (y + r * 1.2) + ' ' + (x - r * 1.2) + ',' + y + '" ' + pint + '/>';
  return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" ' + pint + '/>';
}

/** Valores "redondos" para el eje Y. */
function ticksBonitos(min, max, n) {
  if (min === max) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const paso0 = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(paso0))), r = paso0 / mag;
  const paso = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
  const ini = Math.floor(min / paso) * paso, fin = Math.ceil(max / paso) * paso, out = [];
  for (let v = ini; v <= fin + paso / 2; v += paso) out.push(+v.toFixed(10));
  return out;
}
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const diaMs = f => Date.parse(f + "T12:00:00");

let HIS_GRUPOS = [];
function dibujarHistorial(pts, colorDe, u) {
  const cont = document.getElementById("hisGraf"); if (!cont) return;
  const W = Math.max(320, cont.clientWidth || 800), H = W < 560 ? 260 : 340;
  const m = { l: HIS.moneda === "UF" ? 64 : 84, r: 16, t: 14, b: 34 };
  // eje X: del primer al último día, con margen (un solo día se abre a ±15 días)
  let x0 = Math.min(...pts.map(p => diaMs(p.fecha))), x1 = Math.max(...pts.map(p => diaMs(p.fecha)));
  const pad = Math.max((x1 - x0) * 0.05, 15 * 864e5); x0 -= pad; x1 += pad;
  const vs = pts.map(p => p.v), yt = ticksBonitos(Math.min(...vs), Math.max(...vs), 4);
  const y0 = yt[0], y1 = yt[yt.length - 1];
  const X = ms => m.l + (ms - x0) / (x1 - x0) * (W - m.l - m.r);
  const Y = v => H - m.b - (v - y0) / (y1 - y0 || 1) * (H - m.t - m.b);
  // marcas del eje X: semanales si el rango es corto, si no mensuales (una cada 1, 2, 3, 6 o 12 meses)
  const caben = Math.max(2, Math.floor((W - m.l) / 80)), marcasX = [];
  if (x1 - x0 <= 100 * 864e5) {
    const paso = [7, 14, 28].find(k => (x1 - x0) / (k * 864e5) <= caben) || 28;
    const d = new Date(x0); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + (8 - d.getDay()) % 7); // primer lunes
    for (; d.getTime() <= x1; d.setDate(d.getDate() + paso)) marcasX.push({ ms: d.getTime(), txt: d.getDate() + " " + MESES[d.getMonth()] });
  } else {
    const d = new Date(x0); d.setHours(12, 0, 0, 0); d.setDate(1); d.setMonth(d.getMonth() + 1);
    const n = Math.round((x1 - x0) / (30.4 * 864e5)), cada = [1, 2, 3, 6, 12].find(k => n / k <= caben) || 12;
    for (; d.getTime() <= x1; d.setMonth(d.getMonth() + 1)) if (d.getMonth() % cada === 0)
      marcasX.push({ ms: d.getTime(), txt: MESES[d.getMonth()] + (d.getMonth() === 0 || !marcasX.length ? " " + d.getFullYear() : "") });
  }
  const fmtY = v => HIS.moneda === "UF" ? fmtNum(v, Math.max(0, -Math.floor(Math.log10((yt[1] - yt[0]) || 1)))) : "$" + fmtNum(v, 0);
  // Puntos que caen en el mismo lugar (mismo proveedor, forma y estado) se dibujan una vez; el tooltip los lista.
  const grupos = {};
  pts.forEach(p => {
    const lleno = p.estado === "vigente", f = formaDe(p.fuente), cx = Math.round(X(diaMs(p.fecha))), cy = Math.round(Y(p.v));
    const k = [p.prov, f, lleno, cx, cy].join("|");
    (grupos[k] = grupos[k] || { cx, cy, f, lleno, color: colorDe(p.prov), pts: [] }).pts.push(p);
  });
  // los grises abajo, los huecos debajo de los rellenos
  HIS_GRUPOS = Object.values(grupos).sort((a, b) => (b.color === HIS_OTROS) - (a.color === HIS_OTROS) || a.lleno - b.lleno);
  cont.innerHTML =
    '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Precios de ' + esc(HIS.residuo) + ' por fecha; el detalle está en la tabla de abajo">' +
      yt.map(v => '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="' + (v === y0 ? "#D0D5DD" : "#F2F4F7") + '"/>' +
        '<text x="' + (m.l - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end" class="his-eje">' + esc(fmtY(v)) + '</text>').join('') +
      marcasX.map(x => '<text x="' + X(x.ms) + '" y="' + (H - m.b + 20) + '" text-anchor="middle" class="his-eje">' + esc(x.txt) + '</text>').join('') +
      HIS_GRUPOS.map((g, i) => '<g class="his-pt" data-i="' + i + '"><circle cx="' + g.cx + '" cy="' + g.cy + '" r="12" fill="transparent"/>' + marca(g.f, g.cx, g.cy, 6, g.color, g.lleno) + '</g>').join('') +
    '</svg><div id="hisTip" class="his-tip" role="tooltip" style="display:none"></div>';
  const tip = document.getElementById("hisTip");
  cont.querySelectorAll(".his-pt").forEach(el => {
    el.addEventListener("mouseenter", () => {
      const g = HIS_GRUPOS[+el.dataset.i], p = g.pts[0];
      tip.innerHTML = '<div class="his-tip-cab"><i class="his-sw" style="background:' + g.color + '"></i><b>' + esc(p.prov) + '</b></div>' +
        '<div class="his-tip-val">' + fmtHis(p.v) + esc(u) + '</div>' +
        '<div class="muted">' + esc(p.fecha) + ' · ' + esc(p.fuente || "sin fuente") + ' · ' + esc(ESTADO_TXT[p.estado]) + '</div>' +
        (g.pts.length > 1 ? '<div class="muted">' + g.pts.length + ' precios iguales: ' + esc(unicosOrdenados(g.pts.map(x => x.empresa || "Valor general")).join(", ")) + '</div>'
          : '<div class="muted">' + esc([p.empresa || "Valor general", p.sucursal, p.region].filter(Boolean).join(" · ")) + '</div>');
      tip.style.display = "";
      const bx = cont.getBoundingClientRect(), tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(g.cx - tw / 2, 0), bx.width - tw) + "px";
      tip.style.top = (g.cy > 90 ? g.cy - tip.offsetHeight - 14 : g.cy + 16) + "px";
    });
    el.addEventListener("mouseleave", () => { tip.style.display = "none"; });
  });
}

function tablaHistorial(pts, colorDe, u) {
  const MAX = 200;
  const orig = p => (p.moneda === "UF" ? fmtNum(p.precio, 2) + " UF" : fmtCLP(p.precio)) + " / " + p.unidad;
  return '<div class="tscroll"><table class="ttar"><tr><th>Fecha</th><th>Proveedor</th><th>Empresa · sucursal</th><th>Región</th><th class="num">' + (HIS.moneda === "UF" ? "UF" : "Pesos") + esc(u) + '</th><th class="num">Precio original</th><th>Fuente · motivo</th><th>Estado</th></tr>' +
    pts.slice(0, MAX).map(p => '<tr' + (p.estado === "vigente" ? '' : ' class="his-ant"') + '><td class="small his-fecha">' + esc(p.fecha) + '</td>' +
      '<td><i class="his-sw" style="background:' + colorDe(p.prov) + '"></i><b>' + esc(p.prov) + '</b></td>' +
      '<td class="small">' + esc([p.empresa || "Valor general", p.sucursal].filter(Boolean).join(" · ")) + '</td><td class="small">' + esc(p.region) + '</td>' +
      '<td class="num"><b>' + fmtHis(p.v) + '</b></td><td class="num small">' + esc(orig(p)) + '</td>' +
      '<td class="small">' + esc([p.fuente || "sin fuente", (p.motivo || "").toLowerCase()].filter(Boolean).join(" · ")) + '</td>' +
      '<td class="small">' + esc(ESTADO_TXT[p.estado]) + (p.estado === "previo" ? ' <span class="muted">(editado el ' + esc(p.editadoEl) + ')</span>' : '') + '</td></tr>').join('') +
    '</table></div>' + (pts.length > MAX ? '<div class="muted small">Se muestran los ' + MAX + ' precios más recientes de ' + pts.length + '. Filtra por región o proveedor para ver el resto.</div>' : '');
}

let _hisResize = null;
window.addEventListener("resize", () => { clearTimeout(_hisResize); _hisResize = setTimeout(() => { const b = document.getElementById("tarHistorial"); if (b && b.style.display !== "none") renderHistorialPrecios(); }, 200); });
