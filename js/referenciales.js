/* ============================================================
   REFERENCIALES POR REGIÓN (Ecosistema 3.0, fase 2)
   - Costo por m³ con contenedor lleno por sucursal: suma de las tarifas del MISMO proveedor,
     empresa, sucursal y residuo (nunca se mezclan proveedores). Retiro ÷ volumen + disposición
     por kg × densidad del residuo; el arriendo mensual se prorratea con RETIROS_MES retiros.
   - Referencial por proveedor × residuo × región: la fijada (Valor general) manda; si no, la
     mediana de sus sucursales vigentes en la región. Una región sin datos no aparece.
   - Precio de mercado por región: mediana de los proveedores (cada uno con su mediana).
   - "Por qué": de cuántas tarifas sale, fuentes, motivo, fechas y una confianza alta/media/baja.
   Depende de js/tarifas.js (TARIFAS, clpDe, mediana, esGeneral, fmtCLP…) y js/esquema.js.
   ============================================================ */

// kg por m³ por residuo, para llevar la disposición por kg a costo por m³: la densidad estándar de la plataforma
// (pestaña "Densidades", js/tratamientos.js), salvo que la tarifa informe el peso del contenedor lleno.
const RETIROS_MES = 4; // supuesto para prorratear el arriendo mensual
function densidadDe(residuo) {
  const d = densidadRegistro(residuo);
  return d && d.kgm3 ? { kgm3: d.kgm3, nota: "densidad estándar de la plataforma" } : null;
}
/** Densidad del contenedor lleno: el peso informado en alguna de sus tarifas (÷ volumen) o la estándar del residuo. */
function densidadContenedor(ts, vol, dens) {
  const kg = ts.map(t => numDe(t.peso_lleno_kg)).find(v => v > 0);
  return kg && vol ? { kgm3: kg / vol, nota: "peso lleno informado en la tarifa: " + fmtNum(kg, 0) + " kg" } : dens;
}

// Confiabilidad de cada tipo de fuente (catálogo de 16, pestaña "Fuentes")
const CONF_FUENTE = {
  "Plataforma de trazabilidad": 3, "Marketplace Recylink": 3, "Contratos de clientes": 3, "Licitaciones privadas de clientes": 3,
  "Facturas y órdenes de compra": 3, "Análisis de ahorro y líneas base": 3, "Cartas de oferta de gestores": 2, "Cotizaciones de proveedores": 2,
  "Propuestas comerciales de Recylink": 2, "Correos históricos": 2, "Ecosistema 1.0 / GAIA": 1.5, "Licitaciones públicas": 2,
  "Fuentes técnicas e institucionales": 2, "Boca a boca": 1, "SINADER / RETC": 3
};
/** Confianza de un conjunto de tarifas: según su mejor fuente, cuántas son y qué tan recientes. */
function confianzaDe(ts) {
  let p = Math.max(1, ...ts.map(t => CONF_FUENTE[t.fuente] || 1.5));
  if (ts.length === 1) p -= 1;
  const ultima = ts.map(t => tget(t, "fecha")).sort().pop() || "";
  const hace12 = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  if (ultima && ultima < hace12) p -= 1;
  const conf = ts.some(porConfirmar);
  if (conf) p -= 1;
  const r = p >= 2.5 ? { nivel: "alta", txt: "Confianza alta" } : p >= 1.5 ? { nivel: "media", txt: "Confianza media" } : { nivel: "baja", txt: "Confianza baja" };
  if (conf) r.txt += " · por confirmar";
  return r;
}
const mesAnio = f => { const s = String(f || ""); return s.length >= 7 ? s.slice(5, 7) + "-" + s.slice(0, 4) : ""; };
/** "Mediana de 14 tarifas en la RM · 14 contratos de clientes · motivo: acuerdo marco · de 10-2026". */
function porQueTexto(ts, n, region, unidadTxt) {
  const fuentes = {};
  ts.forEach(t => { const f = t.fuente || "sin fuente"; fuentes[f] = (fuentes[f] || 0) + 1; });
  const motivos = unicosOrdenados(ts.map(t => tget(t, "motivo_precio")).filter(Boolean));
  const fechas = ts.map(t => tget(t, "fecha")).filter(Boolean).sort();
  const rango = fechas.length ? (mesAnio(fechas[0]) === mesAnio(fechas[fechas.length - 1]) ? "de " + mesAnio(fechas[0]) : "de " + mesAnio(fechas[0]) + " a " + mesAnio(fechas[fechas.length - 1])) : "";
  const plural = { sucursal: "sucursales", tarifa: "tarifas" };
  return [(n === 1 ? "1 " + unidadTxt : "Mediana de " + n + " " + (plural[unidadTxt] || unidadTxt + "s")) + (region ? " en " + region : ""),
    Object.keys(fuentes).map(f => fuentes[f] + " " + f.toLowerCase()).join(", "),
    motivos.length ? "motivo: " + motivos.join(", ").toLowerCase() : "", rango].filter(Boolean).join(" · ");
}

/* ---------------- costo por m³ de cada sucursal ---------------- */
const esServ = (t, ...tipos) => tipos.includes(t.tipo_servicio);
const porViaje = t => UNIDADES_CON_CONTENEDOR.includes(String(t.unidad || "").toLowerCase());
const unidadEs = (t, u) => String(t.unidad || "").toLowerCase() === u;

/**
 * Costos por m³ de las sucursales (tarifas vigentes y activas, que cobran). Una entrada por
 * proveedor × empresa × sucursal (o comuna) × residuo × contenedor con volumen.
 */
function costosM3(ts) {
  const grupos = {};
  ts.filter(t => t.activo && t.vigente && t.precio_num != null && !esGeneral(t)).forEach(t => {
    const k = [t.provKey, norm(t.cliente), norm(t.sucursal) || "c:" + norm(t.comuna), norm(t.residuo)].join("|");
    (grupos[k] = grupos[k] || []).push(t);
  });
  const out = [];
  // Q7c: los precios de un mismo proveedor con tratamientos distintos nunca se mezclan (una entrada por tratamiento)
  const porTratamiento = gTodas => {
    const trat = t => tget(t, "tratamiento") || SIN_TRAT;
    const trats = unicosOrdenados(gTodas.filter(t => conTratamiento(t.tipo_servicio)).map(trat));
    if (trats.length <= 1) return [[gTodas, trats[0] && trats[0] !== SIN_TRAT ? trats[0] : ""]];
    return trats.map(tr => [gTodas.filter(t => !conTratamiento(t.tipo_servicio) || norm(trat(t)) === norm(tr)), tr === SIN_TRAT ? "" : tr]);
  };
  Object.values(grupos).flatMap(porTratamiento).forEach(([gTodas, tratamiento]) => {
    // lo que el proveedor paga por el material (compra) se muestra aparte, en verde; no entra al costo
    const g = gTodas.filter(t => t.tipo !== "paga"), pagas = gTodas.filter(t => t.tipo === "paga" && clpDe(t) != null);
    if (!g.length) return;
    const pk = pagas.filter(t => unidadEs(t, "kg")), pBase = pk.length ? pk : pagas;
    const compra = pBase.length ? { valor: mediana(pBase.map(clpDe)), unidad: pBase[0].unidad, tarifas: pBase } : null;
    const densRes = densidadDe(g[0].residuo);
    // por kg o ton → por m³ (necesita densidad); por m³ → directo
    const dispM3 = (t, dn) => unidadEs(t, "m3") ? clpDe(t) : !dn ? null : unidadEs(t, "kg") ? clpDe(t) * dn.kgm3 : unidadEs(t, "ton") ? clpDe(t) * dn.kgm3 / 1000 : null;
    const disp = g.filter(t => esServ(t, "Disposición") && clpDe(t) != null && ["m3", "kg", "ton"].some(u => unidadEs(t, u)));
    const conts = {};
    g.forEach(t => { const v = volumenEf(t); if (contenedorBase(t.contenedor) && v) conts[contKey(t)] = { cont: contenedorBase(t.contenedor), vol: v }; });
    const lista = Object.keys(conts).length ? Object.keys(conts) : [""];
    lista.forEach(ck => {
      const c = conts[ck] || { cont: "", vol: null };
      const mismo = t => !contenedorBase(t.contenedor) || contKey(t) === ck;
      const td = g.find(t => esServ(t, "Transporte + disposición") && porViaje(t) && contKey(t) === ck);
      const tr = g.find(t => esServ(t, "Transporte") && porViaje(t) && contKey(t) === ck);
      const tdM3 = g.find(t => esServ(t, "Transporte + disposición") && unidadEs(t, "m3") && mismo(t));
      const ar = g.find(t => esServ(t, "Arriendo") && unidadEs(t, "mes") && mismo(t));
      const dens = densidadContenedor(g.filter(mismo), c.vol, densRes);
      const d = disp.find(t => dispM3(t, dens) != null);
      const lineas = [], usadas = [];
      let op = null;
      if (td && c.vol) {
        op = clpDe(td) / c.vol; usadas.push(td);
        lineas.push({ comp: "Retiro con disposición", tarifa: precioCorto(td), porCont: clpDe(td), porM3: op });
      } else if (tr && d && c.vol) {
        const t1 = clpDe(tr), d1 = dispM3(d, dens);
        op = t1 / c.vol + d1; usadas.push(tr, d);
        lineas.push({ comp: "Retiro (transporte)", tarifa: precioCorto(tr), porCont: t1, porM3: t1 / c.vol });
        lineas.push({ comp: "Disposición", tarifa: precioCorto(d) + (unidadEs(d, "m3") ? "" : " × " + fmtNum(dens.kgm3 * c.vol, 0) + " " + (unidadEs(d, "ton") ? "kg (" + fmtNum(dens.kgm3 * c.vol / 1000, 2) + " ton)" : "kg") + " (contenedor lleno)"), porCont: d1 * c.vol, porM3: d1 });
      } else if (tr && !d && compra && c.vol) {
        // el proveedor compra el material: no hay disposición que pagar, el costo es solo el retiro
        const t1 = clpDe(tr);
        op = t1 / c.vol; usadas.push(tr);
        lineas.push({ comp: "Retiro (transporte)", tarifa: precioCorto(tr), porCont: t1, porM3: t1 / c.vol });
      } else if (tdM3) {
        op = clpDe(tdM3); usadas.push(tdM3);
        lineas.push({ comp: "Costo por m³ informado", tarifa: precioCorto(tdM3), porCont: c.vol ? op * c.vol : null, porM3: op });
      }
      if (op == null) return;
      // si además viene el costo por m³ informado, se usa solo como referencia (no se suma)
      if (tdM3 && !usadas.includes(tdM3)) usadas.push(tdM3);
      // peoneta, faena, hidrojet: se cobran aparte en cada viaje, así que se suman al retiro
      // destrucción de marca solo si se cobra por camión (viaje o retiro): un cargo fijo por servicio no se reparte por viaje
      const unidadesPorViaje = t => t.tipo_servicio === "Destrucción de marca" ? ["viaje", "retiro"] : ["servicio", "viaje", "retiro"];
      if (c.vol) g.filter(t => SERVICIOS_POR_VIAJE.includes(t.tipo_servicio) && unidadesPorViaje(t).includes(String(t.unidad || "").toLowerCase()) && mismo(t) && clpDe(t) != null)
        .forEach(t => {
          const v = clpDe(t);
          op += v / c.vol; usadas.push(t);
          lineas.push({ comp: t.tipo_servicio + " (por viaje)", tarifa: precioCorto(t), porCont: v, porM3: v / c.vol, porViaje: true });
        });
      let conArr = null;
      if (ar && c.vol) {
        const a = clpDe(ar) / RETIROS_MES;
        conArr = op + a / c.vol; usadas.push(ar);
        lineas.push({ comp: "Arriendo del contenedor", tarifa: precioCorto(ar) + " ÷ " + RETIROS_MES + " retiros", porCont: a, porM3: a / c.vol, aparte: true });
      }
      // lo que paga el proveedor por el contenedor lleno (densidad): solo informativo, no se descuenta del costo
      const kgLleno = dens && c.vol ? dens.kgm3 * c.vol : null;
      const compraCont = compra && kgLleno && (unidadEs(compra.tarifas[0], "kg") || unidadEs(compra.tarifas[0], "ton"))
        ? { valor: compra.valor * (unidadEs(compra.tarifas[0], "ton") ? kgLleno / 1000 : kgLleno), kg: kgLleno } : null;
      const t0 = usadas[0];
      out.push({ provKey: t0.provKey, proveedor: t0.proveedor_nombre, cliente: t0.cliente, sucursal: t0.sucursal || t0.comuna, residuo: t0.residuo,
        region: t0.region || regionDeComuna(t0.comuna) || "", cont: c.cont, vol: c.vol, op, conArr, lineas, tarifas: usadas, dens, pago: tget(t0, "condicion_pago_dias"), compra, compraCont, tratamiento });
    });
  });
  return out;
}
const precioCorto = t => (t.moneda === "UF" ? fmtNum(t.precio_num, 2) + " UF" : fmtCLP(t.precio_num)) + (t.unidad ? " / " + t.unidad : "");

/* ---------------- referencial por región de un proveedor ---------------- */
let _MERCADO = null; // se arma una vez por carga de tarifas
function mercado() {
  if (_MERCADO && _MERCADO.n === TARIFAS.length) return _MERCADO;
  const items = costosM3(TARIFAS);
  const m3 = {}, unid = {};
  // m³: mediana por proveedor y luego mediana entre proveedores
  const porProv = {};
  items.forEach(it => { const k = claveM3(it); ((porProv[k] = porProv[k] || {})[it.provKey] = porProv[k][it.provKey] || []).push(it); });
  Object.keys(porProv).forEach(k => {
    const provs = Object.values(porProv[k]);
    m3[k] = { op: mediana(provs.map(l => mediana(l.map(i => i.op)))), n: provs.length,
      conArr: mediana(provs.map(l => mediana(l.map(i => i.conArr).filter(v => v != null))).filter(v => v != null)) };
  });
  // por unidad: residuo × servicio × unidad × cobra/paga × región
  const pu = {};
  TARIFAS.filter(t => t.activo && t.vigente && t.precio_num != null && clpDe(t) != null && clpDe(t) > 1).forEach(t => {
    const k = claveUnidad(t); ((pu[k] = pu[k] || {})[t.provKey] = pu[k][t.provKey] || []).push(clpDe(t));
  });
  Object.keys(pu).forEach(k => { const provs = Object.values(pu[k]); unid[k] = { v: mediana(provs.map(l => mediana(l))), n: provs.length }; });
  return (_MERCADO = { n: TARIFAS.length, m3, unid });
}
/** Costo por m³: residuo × región × contenedor (tipo y volumen), porque el tamaño cambia el costo por m³. */
const claveM3 = i => [norm(i.residuo), i.region, norm(i.cont), i.vol || ""].join("|");
const claveUnidad = t => [norm(t.residuo), t.tipo_servicio, norm(t.unidad), t.tipo, t.region || ""].join("|");

/** Filas de la referencial por región de un proveedor. */
function referencialRegiones(ts) {
  const filas = [];
  const items = costosM3(ts);
  const usadas = new Set(items.flatMap(i => i.tarifas.map(t => t.id)));
  // 1) costo por m³ por residuo × región
  const g = {};
  items.forEach(i => { const k = claveM3(i) + "|t:" + norm(i.tratamiento); (g[k] = g[k] || []).push(i); });
  Object.keys(g).forEach(k => {
    const l = g[k], i0 = l[0], mk = mercado().m3[claveM3(i0)];
    const conts = {}; l.forEach(i => { const c = i.cont + " " + fmtNum(i.vol, 2) + " m³"; conts[c] = (conts[c] || 0) + 1; });
    const ts2 = l.flatMap(i => i.tarifas);
    filas.push({ tipo: "m3", residuo: i0.residuo, servicio: "Transporte + disposición", region: i0.region, tratamiento: i0.tratamiento,
      contenedor: Object.keys(conts).sort((a, b) => conts[b] - conts[a]).join(", "),
      valor: mediana(l.map(i => i.op)), conArr: mediana(l.map(i => i.conArr).filter(v => v != null)),
      mercado: mk && mk.n > 0 ? mk : null, porQue: porQueTexto(ts2, l.length, i0.region, "sucursal"),
      conf: confianzaDe(ts2), items: l, tarifas: ts2, dens: i0.dens });
  });
  // 2) por unidad: lo que no entró al costo por m³ (fijadas, compra de material, sin volumen…)
  const pu = {};
  ts.filter(t => t.activo && t.vigente && !usadas.has(t.id)).forEach(t => { const k = claveUnidad(t) + "|t:" + norm(tget(t, "tratamiento")); (pu[k] = pu[k] || []).push(t); });
  Object.keys(pu).forEach(k => {
    const l = pu[k], gen = l.filter(esGeneral), base = gen.length ? gen : l, t0 = base[0];
    const vals = base.map(clpDe).filter(v => v != null && v > 1);
    const genT = gen.slice().sort((a, b) => String(b.fecha + b.actualizado_el).localeCompare(String(a.fecha + a.actualizado_el)))[0];
    const fijada = genT && clpDe(genT) != null ? clpDe(genT) : null;
    const valor = fijada != null ? fijada : mediana(vals);
    const mk = mercado().unid[claveUnidad(t0)];
    filas.push({ tipo: "unidad", residuo: t0.residuo || "(sin residuo)", servicio: t0.tipo_servicio, region: t0.region || "", unidad: t0.unidad, paga: t0.tipo === "paga", tratamiento: tget(t0, "tratamiento"),
      contenedor: unicosOrdenados(l.map(contenedorTxt)).join(", "), valor, mercado: mk && mk.n > 0 ? mk : null, genId: genT ? genT.id : "", t0,
      porQue: genT ? "Fijada por " + String(tget(genT, "actualizado_por") || tget(genT, "creado_por")).replace(/@.*/, "") + " el " + String(tget(genT, "actualizado_el") || genT.fecha).slice(0, 10) +
        (tget(genT, "motivo_precio") ? " · motivo: " + genT.motivo_precio.toLowerCase() : "") + (tget(genT, "detalle") ? " · " + String(genT.detalle).replace(/\s+/g, " ").slice(0, 120) : "")
        : vals.length ? porQueTexto(base, vals.length, t0.region, "tarifa") : "Sin precio",
      conf: confianzaDe(base), tarifas: base });
  });
  const orden = f => [f.residuo, f.tipo === "m3" ? "0" : "1", f.region].join("|");
  return filas.sort((a, b) => orden(a).localeCompare(orden(b), "es"));
}

/* ---------------- HTML ---------------- */
const pillConf = c => '<span class="pill conf-' + c.nivel + '">' + esc(c.txt) + '</span>';
function vsMercadoHtml(valor, m, paga) {
  if (valor == null || !m || m.v == null && m.op == null) return '<span class="muted small">sin comparables</span>';
  const ref = m.op != null ? m.op : m.v;
  if (m.n < 2) return '<div class="muted small">1 proveedor (solo este)</div>';
  const dif = (valor - ref) / ref;
  const bajo = dif < 0, txt = Math.abs(dif) < 0.005 ? "igual al mercado" : Math.round(Math.abs(dif) * 100) + "% " + (bajo ? "bajo" : "sobre") + " el mercado";
  const bueno = paga ? !bajo : bajo; // si el proveedor paga, más alto es mejor
  return '<div><b>' + fmtCLP(ref) + '</b></div><div class="small ' + (Math.abs(dif) < 0.005 ? "muted" : bueno ? "ok-msg" : "warn") + '">' + txt + '</div><div class="muted small">' + m.n + ' proveedores</div>';
}
let _DESG_SEQ = 0;
function desgloseHtml(it) {
  return '<div class="desg-box"><div class="desg-tit">Desglose · ' + esc([it.cliente, it.sucursal].filter(Boolean).join(" · ")) + ' · ' + esc(it.cont + " " + fmtNum(it.vol, 2) + " m³") + '</div>' +
    '<table class="desg-tab"><tr><th>Componente</th><th>Tarifa</th><th class="num">Por contenedor</th><th class="num">Por m³</th></tr>' +
    it.lineas.filter(l => !l.aparte).map(l => '<tr><td>' + esc(l.comp) + '</td><td>' + esc(l.tarifa) + '</td><td class="num">' + (l.porCont != null ? fmtCLP(l.porCont) : "—") + '</td><td class="num">' + fmtCLP(l.porM3) + '</td></tr>').join('') +
    '<tr class="desg-tot"><td>Costo operativo</td><td></td><td class="num">' + fmtCLP(it.op * it.vol) + '</td><td class="num">' + fmtCLP(it.op) + '</td></tr>' +
    it.lineas.filter(l => l.aparte).map(l => '<tr class="muted"><td>' + esc(l.comp) + '</td><td>' + esc(l.tarifa) + '</td><td class="num">' + fmtCLP(l.porCont) + '</td><td class="num">' + fmtCLP(l.porM3) + '</td></tr>').join('') +
    (it.compra ? '<tr class="desg-paga"><td>El proveedor paga por el material</td><td>' + esc("+" + fmtCLP(it.compra.valor) + " / " + it.compra.unidad) + '</td>' +
      (it.compraCont ? '<td class="num">+' + fmtCLP(it.compraCont.valor) + '</td><td class="num">+' + fmtCLP(it.compraCont.valor / it.vol) + '</td></tr>' +
        '<tr class="desg-paga"><td>Balance por retiro (no se descuenta del costo)</td><td>' + esc(fmtNum(it.compraCont.kg, 0) + " kg con el contenedor lleno") + '</td><td class="num">' + (it.compraCont.valor >= it.op * it.vol ? "+" : "−") + fmtCLP(Math.abs(it.compraCont.valor - it.op * it.vol)) + '</td><td class="num">' + (it.compraCont.valor >= it.op * it.vol ? "+" : "−") + fmtCLP(Math.abs(it.compraCont.valor / it.vol - it.op)) + '</td></tr>'
        : '<td class="num" colspan="2">no se descuenta del costo</td></tr>') : '') +
    (it.conArr != null ? '<tr class="desg-tot"><td>Total con arriendo</td><td></td><td class="num">' + fmtCLP(it.conArr * it.vol) + '</td><td class="num">' + fmtCLP(it.conArr) + '</td></tr>' : '') +
    '</table>' + (it.dens && (it.compraCont || it.lineas.some(l => l.comp === "Disposición")) ? '<div class="muted small">Contenedor lleno con ' + fmtNum(it.dens.kgm3, 0) + ' kg/m³ (' + esc(it.dens.nota) + ').' + (it.pago ? ' Condición de pago: ' + esc(it.pago) + ' días.' : '') + '</div>' : '') + '</div>';
}
function verDesglose(id, btn) {
  const el = document.getElementById(id); if (!el) return;
  const abrir = el.style.display === "none";
  el.style.display = abrir ? "" : "none";
  if (btn) btn.textContent = abrir ? "Ocultar desglose" : btn.dataset.txt;
}
/**
 * Tabla de referencial por región (tarjeta del proveedor y su detalle en Tarifas).
 * opts: { proveedor, titulo, residuosCU, soloConPrecio }
 */
function referencialRegionHtml(ts, opts) {
  opts = opts || {};
  const filas = referencialRegiones(ts).filter(f => f.valor != null || !opts.soloConPrecio);
  const vistos = new Set(filas.map(f => norm(f.residuo)));
  const sinTar = (opts.residuosCU || []).filter(r => r && !vistos.has(norm(r)) && (vistos.add(norm(r)), true));
  const n = ts.filter(t => t.vigente && t.alertas && t.alertas.length).length;
  const cab = '<span class="t-etq">' + esc(opts.titulo || "Tarifa referencial por región") + (n ? ' ' + alertaBadge(ts.filter(t => t.vigente), n) : '') + '</span>';
  if (!filas.length && !sinTar.length) return '<div class="ref-box">' + cab + (opts.proveedor && !opts.soloConPrecio ? '<div class="sec-acc">' + botonNuevaReferencial(opts.proveedor) + '</div>' : '<div class="muted small">Sin tarifas.</div>') + '</div>';
  const uf = UF.valor ? " · UF del día " + fmtCLP(UF.valor) : "";
  const fila = f => {
    const resTxt = '<b>' + resTag(f.residuo) + '</b>' + (f.paga ? ' <span class="pill p-paga">paga</span>' : '') + '<div class="muted small">' + esc(f.tipo === "m3" ? "Costo operativo: transporte + disposición" : f.servicio || "-") + '</div>' +
      (f.tratamiento ? '<div class="small t-trat">' + esc(f.tratamiento + (familiaDe(f.tratamiento) ? " · " + familiaDe(f.tratamiento) : "")) + '</div>' : '');
    let precio;
    if (f.tipo === "m3") {
      precio = '<div class="ref-num">' + fmtCLP(f.valor) + ' <span class="muted small">/ m³</span></div>' +
        (UF.valor ? '<div class="muted small">' + fmtNum(f.valor / UF.valor, 3) + ' UF</div>' : '') +
        (f.conArr != null ? '<div class="muted small">' + fmtCLP(f.conArr) + ' con arriendo</div>' : '');
    } else precio = f.valor == null ? '<span class="muted">sin precio</span>' : '<div class="ref-num' + (f.paga ? ' t-paga' : '') + '">' + fmtCLP(f.valor) + (f.unidad ? ' <span class="muted small">/ ' + esc(f.unidad) + '</span>' : '') + '</div>';
    const id = "desg" + (++_DESG_SEQ);
    const desg = f.tipo === "m3" ? '<tr id="' + id + '" style="display:none" class="desg-fila"><td colspan="7">' + f.items.map(desgloseHtml).join('') + '</td></tr>' : '';
    const acc = f.tipo === "unidad" ? botonReferencial({ proveedor: f.t0.proveedor_nombre, residuo: f.residuo, unidad: f.unidad, tipo: f.t0.tipo, genId: f.genId, ref: f.valor, refUF: null, sinTarifas: false }) : '';
    return '<tr' + (f.tipo === "m3" ? ' class="ref-m3"' : '') + '><td>' + resTxt + '</td><td>' + esc(f.region || "Todas") + '</td><td class="small">' + esc(f.contenedor || "—") + '</td>' +
      '<td class="num">' + precio + '</td><td class="num">' + vsMercadoHtml(f.valor, f.mercado, f.paga) + '</td>' +
      '<td class="small">' + esc(f.porQue) + '<div class="ref-chips">' + pillConf(f.conf) +
        (f.tipo === "m3" ? '<button type="button" class="lnk small" data-txt="Ver desglose (' + f.items.length + ')" onclick="event.stopPropagation();verDesglose(\'' + id + '\',this)">Ver desglose (' + f.items.length + ')</button>' : '') + '</div></td>' +
      '<td><span class="ref-acc">' + acc + '</span></td></tr>' + desg;
  };
  return '<div class="ref-box">' + cab +
    '<div class="muted small">Costo por m³ con el contenedor lleno, neto' + uf + '. La fijada (Valor general) manda; si no, la mediana de las sucursales de la región.</div>' +
    '<div class="tscroll"><table class="ttar ref-tab ref-reg"><tr><th>Residuo · servicio</th><th>Región</th><th>Contenedor</th><th class="num">Referencial</th><th class="num">Mercado en la región</th><th>Por qué este número</th><th></th></tr>' +
    filas.map(fila).join('') +
    sinTar.map(r => '<tr class="ref-sin"><td>' + esc(r) + '</td><td colspan="5" class="muted small">sin tarifas registradas</td><td><span class="ref-acc">' + botonReferencial({ proveedor: opts.proveedor, residuo: r, unidad: "", tipo: "cobra", genId: "", ref: null, refUF: null, sinTarifas: true }) + '</span></td></tr>').join('') +
    '</table></div>' + (opts.proveedor && !opts.soloConPrecio ? '<div class="sec-acc">' + botonNuevaReferencial(opts.proveedor) + '</div>' : '') + '</div>';
}

/* ---------------- comparar proveedores en una región ---------------- */
let CMP = { provs: [], modo: "m3", residuo: "", region: "", tipos: [], vols: [], arriendo: false, servicio: "", unidad: "", fams: [], trat: "" }; // tipos/vols/fams vacío = todos
/** Filtro de tratamiento (Q7c/Q12): familias elegidas (una, varias o todas) y un tratamiento específico. */
const pasaTratamiento = tr => (!CMP.fams.length || CMP.fams.includes(familiaDe(tr) || SIN_TRAT)) && (!CMP.trat || norm(tr) === norm(CMP.trat));
/** Chips de familia + selector de tratamiento, con los tratamientos que hay para el residuo en la región. */
function filtrosTratamientoHtml(trats) {
  const lista = unicosOrdenados(trats.filter(Boolean));
  if (CMP.trat && !lista.some(t => norm(t) === norm(CMP.trat))) CMP.trat = "";
  return chipsCmp("Familia de tratamiento", "fams", FAMILIAS.concat([SIN_TRAT]), x => x) +
    '<label>Tratamiento<select id="cmpTrat" onchange="CMP.trat=this.value;renderComparar()"><option value="">Todos</option>' +
      lista.map(t => '<option value="' + esc(t) + '"' + (norm(t) === norm(CMP.trat) ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></label>';
}
const tratSubHtml = tr => tr ? '<div class="small t-trat">' + esc(tr + (familiaDe(tr) ? " · " + familiaDe(tr) : "")) + '</div>' : '';
function abrirComparar(on) { abrirVistaTar(on ? "cmp" : "lista"); } // la vista Historial de precios está en js/historial.js
/** Suma o quita un contenedor de la comparación (ninguno elegido = todos). */
function cmpCont(campo, c) { CMP[campo] = CMP[campo].includes(c) ? CMP[campo].filter(x => x !== c) : CMP[campo].concat([c]); renderComparar(); }
/** Por contenedor (tipo + m³) de un proveedor: medianas de sus sucursales, de mayor a menor volumen. */
function porContenedor(l) {
  const g = {};
  l.forEach(i => (g[i.cont + "|" + i.vol] = g[i.cont + "|" + i.vol] || []).push(i));
  return Object.values(g).map(x => {
    const comp = (...nombres) => { const v = x.flatMap(i => i.lineas.filter(y => nombres.includes(y.comp)).map(y => y.porCont)).filter(v => v != null); return v.length ? mediana(v) : null; };
    const disp = x.flatMap(i => i.tarifas.filter(t => esServ(t, "Disposición"))), arr = x.flatMap(i => i.tarifas.filter(t => esServ(t, "Arriendo"))).map(clpDe).filter(v => v != null);
    const ops = x.map(i => i.op);
    return { cont: x[0].cont, vol: x[0].vol, n: x.length, op: mediana(ops), min: Math.min(...ops), max: Math.max(...ops), conArr: mediana(x.map(i => i.conArr).filter(v => v != null)),
      // retiro: el de transporte o, si el retiro ya incluye la disposición, ese
      // si el precio viene por m³, el retiro es m³ × costo por m³ (contenedor lleno)
      retiro: comp("Retiro (transporte)", "Retiro con disposición", "Costo por m³ informado"),
      retiroConDisp: x.some(i => i.lineas.some(y => y.comp === "Retiro con disposición" || y.comp === "Costo por m³ informado")),
      retiroCalc: x.some(i => i.lineas.some(y => y.comp === "Costo por m³ informado")),
      // servicios por viaje cobrados aparte (suma por sucursal, mediana entre sucursales)
      porViaje: (v => v.length ? mediana(v) : null)(x.map(i => i.lineas.filter(y => y.porViaje)).filter(l => l.length).map(l => l.reduce((s, y) => s + y.porCont, 0))),
      porViajeTxt: unicosOrdenados(x.flatMap(i => i.lineas.filter(y => y.porViaje).map(y => y.comp.replace(" (por viaje)", "").toLowerCase()))).join(", "),
      disp: disp.length ? mediana(disp.map(clpDe)) : null, dispUnidad: disp.length ? disp[0].unidad : "", arriendo: arr.length ? mediana(arr) : null,
      compra: (cs => cs.length ? { valor: mediana(cs.map(c => c.valor)), unidad: cs[0].unidad } : null)(x.map(i => i.compra).filter(Boolean)) };
  }).sort((a, b) => b.vol - a.vol || a.cont.localeCompare(b.cont, "es"));
}
/** Residuo más frecuente (el que se abre por defecto). */
function masFrecuente(vals) { const c = {}; vals.forEach(v => { c[v] = (c[v] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || ""; }
/** Select con cuántos proveedores hay por opción; las opciones sin datos se ven pero no se pueden elegir. */
function selConteo(id, opciones, val, fn) {
  return '<select id="' + id + '" onchange="' + fn + '">' + opciones.map(o => '<option value="' + esc(o.v) + '"' + (o.v === val ? ' selected' : '') + (o.dis ? ' disabled' : '') + '>' + esc(o.txt) + '</option>').join('') + '</select>';
}
/** Opciones de residuo y región: "Domiciliarios (14 regiones)", "Maule (2 proveedores)", "Aysén — sin datos de este residuo". */
function opcionesCmp(filas, residuo) {
  const regPorRes = {}, provPorReg = {};
  filas.forEach(f => { (regPorRes[f.residuo] = regPorRes[f.residuo] || new Set()).add(f.region);
    if (f.residuo === residuo) (provPorReg[f.region] = provPorReg[f.region] || new Set()).add(f.provKey); });
  const res = unicosOrdenados(filas.map(f => f.residuo)).map(r => ({ v: r, txt: r + " (" + regPorRes[r].size + (regPorRes[r].size > 1 ? " regiones" : " región") + ")" }));
  const reg = unicosOrdenados(filas.map(f => f.region).filter(Boolean)).map(r => provPorReg[r]
    ? { v: r, txt: r + " (" + provPorReg[r].size + " proveedor" + (provPorReg[r].size > 1 ? "es" : "") + ")" }
    : { v: r, txt: r + " — sin datos de este residuo", dis: true });
  return { res, reg };
}
/**
 * Primero la región y después los residuos que tienen datos en ella.
 * filas: { region, residuo, provKey }. Ajusta CMP.region y CMP.residuo si ya no calzan.
 */
function regionYResiduo(filas) {
  const resPorReg = {}, provPorRes = {};
  filas.forEach(f => { if (f.region) (resPorReg[f.region] = resPorReg[f.region] || new Set()).add(f.residuo); });
  const regiones = Object.keys(resPorReg).sort((a, b) => a.localeCompare(b, "es"));
  if (!regiones.includes(CMP.region)) CMP.region = regiones.includes("Metropolitana") ? "Metropolitana" : regiones[0] || "";
  const enReg = filas.filter(f => f.region === CMP.region);
  enReg.forEach(f => (provPorRes[f.residuo] = provPorRes[f.residuo] || new Set()).add(f.provKey));
  const residuos = Object.keys(provPorRes).sort((a, b) => a.localeCompare(b, "es"));
  if (!residuos.includes(CMP.residuo)) CMP.residuo = masFrecuente(enReg.map(f => f.residuo));
  return {
    reg: regiones.map(r => ({ v: r, txt: r + " (" + resPorReg[r].size + (resPorReg[r].size > 1 ? " residuos" : " residuo") + ")" })),
    res: residuos.map(r => ({ v: r, txt: r + " (" + provPorRes[r].size + " proveedor" + (provPorRes[r].size > 1 ? "es" : "") + ")" }))
  };
}
const selRegRes = o => '<label>Región' + selConteo("cmpReg", o.reg, CMP.region, "CMP.region=this.value;renderComparar()") + '</label>' +
  '<label>Residuo' + selConteo("cmpRes", o.res, CMP.residuo, "CMP.residuo=this.value;renderComparar()") + '</label>';
/** Botones "Todos" + uno por opción (varios a la vez). */
function chipsCmp(etq, campo, opciones, txt) {
  return '<div class="cmp-conts"><span class="cmp-etq">' + esc(etq) + '</span><div class="cmp-chips" role="group" aria-label="' + esc(etq) + ' a comparar">' +
    '<button type="button" class="' + (CMP[campo].length ? "" : "on") + '" aria-pressed="' + !CMP[campo].length + '" onclick="CMP.' + campo + '=[];renderComparar()">Todos</button>' +
    opciones.map(c => '<button type="button" class="' + (CMP[campo].includes(c) ? "on" : "") + '" aria-pressed="' + CMP[campo].includes(c) + '" onclick="cmpCont(\'' + campo + '\',' + esc(JSON.stringify(c)) + ')">' + esc(txt(c)) + '</button>').join('') +
    '</div></div>';
}
/** Selector "Qué comparar": costo por m³ (servicios que se cobran) o precio por unidad (incluye compra de material). */
function modoCmpHtml() {
  return '<div class="cmp-conts"><span class="cmp-etq">Qué comparar</span><div class="cmp-toggle" role="group" aria-label="Qué comparar">' +
    '<button type="button" class="' + (CMP.modo === "m3" ? "on" : "") + '" onclick="CMP.modo=\'m3\';renderComparar()">Costo por m³</button>' +
    '<button type="button" class="' + (CMP.modo === "unidad" ? "on" : "") + '" onclick="CMP.modo=\'unidad\';renderComparar()">Precio por unidad</button></div></div>';
}

/* ---------------- detalle de un proveedor (clic en su nombre) ---------------- */
const CMP_ABIERTOS = new Set(); // provKey con el detalle desplegado; se mantiene al cambiar filtros
function cmpToggle(k, irA) {
  CMP_ABIERTOS.has(k) ? CMP_ABIERTOS.delete(k) : CMP_ABIERTOS.add(k);
  renderComparar();
  if (irA && CMP_ABIERTOS.has(k)) { const el = document.querySelector('[data-cmp-det="' + CSS.escape(k) + '"]'); if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
}
/** Nombre del proveedor como botón que despliega su detalle (desde la barra baja hasta el detalle en la tabla). */
function cmpNombreHtml(nombre, k, irA) {
  const ab = CMP_ABIERTOS.has(k);
  return '<button type="button" class="cmp-prov" aria-expanded="' + ab + '" onclick="cmpToggle(' + esc(JSON.stringify(k)) + ',' + !!irA + ')"><b>' + esc(nombre) + '</b> <span class="cmp-flecha">' + (ab ? "▾" : "▸") + '</span></button>';
}
/** Abre el Historial de precios con este proveedor, residuo y servicio. */
function cmpVerHistorial(o) {
  Object.assign(HIS, { residuo: o.residuo, servicio: o.servicio || "", unidad: o.unidad || "", region: o.region || "", prov: o.prov });
  abrirVistaTar("his");
}
function cmpTarifasTabla(ts) {
  return '<div class="tscroll"><table class="ttar cmp-det-tab"><tr><th>Empresa · sucursal</th><th>Servicio · contenedor</th><th class="num">Precio</th><th>Fecha</th><th>Fuente · motivo</th><th>Destino</th></tr>' +
    ts.slice().sort((a, b) => String(a.cliente + a.sucursal).localeCompare(String(b.cliente + b.sucursal), "es") || String(a.tipo_servicio).localeCompare(String(b.tipo_servicio), "es")).map(t =>
      '<tr><td>' + (esGeneral(t) ? '<span class="muted">Valor general</span>' : esc([t.cliente, t.sucursal].filter(Boolean).join(" · ") || "-")) + '<div class="muted small">' + esc(t.comuna || "") + '</div></td>' +
      '<td>' + esc(t.tipo_servicio || "-") + '<div class="muted small">' + esc(contenedorTxt(t) || "") + '</div>' + tratSubHtml(tget(t, "tratamiento")) + marcasV3Html(t) + '</td>' +
      '<td class="num">' + precioHtml(t) + '</td><td class="small">' + esc(t.fecha || "-") + '</td>' +
      '<td class="small">' + esc([t.fuente, tget(t, "fuente_ref")].filter(Boolean).join(" · ") || "-") + (tget(t, "motivo_precio") ? '<div class="muted small">' + esc(t.motivo_precio) + '</div>' : '') +
        (t.pdf_url ? '<a href="' + esc(t.pdf_url) + '" target="_blank" rel="noopener">PDF ↗</a>' : '') + '</td>' +
      '<td class="small">' + esc(tget(t, "destino") || "—") + '</td></tr>' +
      (t.detalle ? '<tr class="cmp-det-txt"><td colspan="6">' + esc(t.detalle).replace(/\n/g, '<br>') + '</td></tr>' : '')).join('') +
    '</table></div>';
}
/**
 * Detalle desplegable: contacto, costo por sucursal con su desglose (costo por m³), las tarifas que entran al número
 * y los otros cobros del proveedor para el mismo residuo en la región (peoneta, faena, arriendo…).
 * o: { provKey, nombre, residuo, region, items (costo por m³) | null, tarifas, servicio, unidad }
 */
function cmpDetalleHtml(o) {
  const usadas = new Set(o.tarifas.map(t => t.id));
  const otras = TARIFAS.filter(t => t.provKey === o.provKey && t.activo && t.vigente && t.residuo === o.residuo && !usadas.has(t.id) &&
    (t.region || regionDeComuna(t.comuna) || "") === o.region);
  const sucs = o.items ? o.items.slice().sort((a, b) => a.op - b.op).map(it => {
    const id = "desg" + (++_DESG_SEQ);
    return '<tr><td><b>' + esc([it.cliente, it.sucursal].filter(Boolean).join(" · ") || "-") + '</b></td><td>' + esc(it.cont + " " + fmtNum(it.vol, 2) + " m³") + '</td>' +
      '<td class="num"><b>' + fmtCLP(it.op) + '</b></td><td class="num">' + (it.conArr != null ? fmtCLP(it.conArr) : "—") + '</td>' +
      '<td class="num">' + (it.pago ? esc(it.pago) + " días" : "—") + '</td>' +
      '<td><button type="button" class="lnk small" data-txt="Ver desglose" onclick="verDesglose(\'' + id + '\',this)">Ver desglose</button></td></tr>' +
      '<tr id="' + id + '" style="display:none" class="desg-fila"><td colspan="6">' + desgloseHtml(it) + '</td></tr>';
  }).join('') : '';
  const his = esc(JSON.stringify({ prov: o.nombre, residuo: o.residuo, region: o.region, servicio: o.servicio || "", unidad: o.unidad || "" }));
  return '<div class="cmp-detalle" data-cmp-det="' + esc(o.clave || o.provKey) + '">' +
    '<div class="cmp-det-cab">' + contactoCortoTarifa(o.tarifas[0]) + '<div class="cmp-det-acc">' +
      '<button type="button" class="lnk" onclick="cmpVerHistorial(' + his + ')">Historial de precios</button>' +
      (typeof abrirEditarTarifas === "function" ? '<button type="button" class="lnk" onclick="abrirEditarTarifas(' + esc(JSON.stringify(o.nombre)) + ')">Editar tarifas</button>' : '') + '</div></div>' +
    (o.items ? '<div class="t-etq">Costo por sucursal (' + o.items.length + ')</div><div class="tscroll"><table class="ttar cmp-det-tab"><tr><th>Empresa · sucursal</th><th>Contenedor</th><th class="num">Operativo / m³</th><th class="num">Con arriendo / m³</th><th class="num">Pago</th><th></th></tr>' + sucs + '</table></div>' : '') +
    '<div class="t-etq">' + (o.items ? "Tarifas que entran al cálculo" : "Tarifas") + ' (' + o.tarifas.length + ')</div>' + cmpTarifasTabla(o.tarifas) +
    (otras.length ? '<div class="t-etq">Otros cobros para ' + esc(o.residuo) + ' en ' + esc(o.region) + ' (' + otras.length + ')</div>' + cmpTarifasTabla(otras) : '') +
    '</div>';
}

/* Precio por unidad: residuo × tipo de servicio × unidad × región, una mediana por proveedor.
   En compra de material el proveedor paga: el mejor es quien paga más. */
function renderCompararUnidad(box) {
  const ts = TARIFAS.filter(t => t.activo && t.vigente && t.precio_num != null && clpDe(t) != null && clpDe(t) > 1 && t.unidad);
  const sel = (id, opts, val, fn) => '<select id="' + id + '" onchange="' + fn + '">' + opts.map(o => '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
  const rr = regionYResiduo(ts.map(t => ({ region: t.region, residuo: t.residuo, provKey: t.provKey })));
  const t1 = ts.filter(t => t.residuo === CMP.residuo && t.region === CMP.region);
  const servicios = unicosOrdenados(t1.map(t => t.tipo_servicio).filter(Boolean));
  if (!servicios.includes(CMP.servicio)) CMP.servicio = servicios[0] || "";
  const t2Todos = t1.filter(t => t.tipo_servicio === CMP.servicio);
  const conTr = conTratamiento(CMP.servicio);
  const t2 = conTr ? t2Todos.filter(t => pasaTratamiento(tget(t, "tratamiento"))) : t2Todos;
  const provPorUni = {};
  t2.forEach(t => (provPorUni[t.unidad] = provPorUni[t.unidad] || new Set()).add(t.provKey));
  const unidades = unicosOrdenados(t2.map(t => t.unidad));
  if (!unidades.includes(CMP.unidad)) CMP.unidad = unidades.slice().sort((a, b) => provPorUni[b].size - provPorUni[a].size)[0] || "";
  const opcUni = unidades.map(u => ({ v: u, txt: u + " (" + provPorUni[u].size + " proveedor" + (provPorUni[u].size > 1 ? "es" : "") + ")" }));
  const del = t2.filter(t => t.unidad === CMP.unidad);
  const paga = del.length ? del.filter(t => t.tipo === "paga").length > del.length / 2 : CMP.servicio === "Compra de material";
  const porProv = {};
  // un proveedor con tratamientos distintos da una fila por tratamiento (Q7c)
  del.filter(t => (t.tipo === "paga") === paga).forEach(t => { const k = t.provKey + "|t:" + norm(tget(t, "tratamiento")); (porProv[k] = porProv[k] || []).push(t); });
  let provs = Object.entries(porProv).map(([clave, l]) => {
    const gen = l.filter(esGeneral), base = gen.length ? gen : l, vals = base.map(clpDe);
    return { nombre: l[0].proveedor_nombre, provKey: l[0].provKey, clave, tratamiento: tget(l[0], "tratamiento"), tarifas: l, n: l.length, v: mediana(vals), min: Math.min(...vals), max: Math.max(...vals), fijada: !!gen.length,
      empresas: unicosOrdenados(l.map(t => t.cliente).filter(Boolean)).join(", "), conf: confianzaDe(base),
      fuente: unicosOrdenados(l.map(t => t.fuente).filter(Boolean)).join(", ") + (unicosOrdenados(l.map(t => tget(t, "motivo_precio")).filter(Boolean)).length ? " · " + unicosOrdenados(l.map(t => tget(t, "motivo_precio")).filter(Boolean)).join(", ").toLowerCase() : "") };
  }).sort((a, b) => paga ? b.v - a.v : a.v - b.v);
  const merc = mediana(provs.map(p => p.v));
  const todosProv = provs.map(p => p.nombre);
  const max = Math.max(...provs.map(p => p.v), merc || 0) * 1.15 || 1;
  const pct = v => (v / max * 100).toFixed(1) + "%";
  const u = " / " + CMP.unidad;
  box.innerHTML =
    '<div class="cmp-filtros">' + modoCmpHtml() +
      selRegRes(rr) +
      '<label>Tipo de servicio' + sel("cmpServ", servicios, CMP.servicio, "CMP.servicio=this.value;renderComparar()") + '</label>' +
      '<label>Unidad' + selConteo("cmpUni", opcUni, CMP.unidad, "CMP.unidad=this.value;renderComparar()") + '</label>' +
      (conTr ? filtrosTratamientoHtml(t2Todos.map(t => tget(t, "tratamiento"))) : '') +
    '</div>' +
    (!provs.length ? '<div class="empty">Sin tarifas para ' + esc(CMP.residuo) + ' · ' + esc(CMP.servicio) + ' por ' + esc(CMP.unidad) + ' en ' + esc(CMP.region || "esta región") + '.</div>' :
    '<div class="cmp-box"><div class="cmp-cab"><b>' + esc(paga ? "Lo que paga el proveedor" : "Lo que cobra el proveedor") + ' · ' + resTag(CMP.residuo) + ' · ' + esc(CMP.servicio) + u + '</b>' +
      '<span><b>Precio de mercado en ' + esc(CMP.region) + ': ' + fmtCLP(merc) + u + '</b> <span class="muted">(mediana de ' + todosProv.length + ' proveedor' + (todosProv.length > 1 ? 'es' : '') + ')</span></span></div>' +
      (paga ? '<div class="muted small">El proveedor compra el material: arriba el que paga más.</div>' : '') +
      (unidades.length > 1 ? '<div class="muted small">Solo se comparan precios en la misma unidad. Este servicio también tiene tarifas por ' + esc(unidades.filter(u => u !== CMP.unidad).map(u => u + " (" + provPorUni[u].size + ")").join(", ")) + ': cámbialo en Unidad.</div>' : '') +
      provs.map((p, i) => {
        const dif = merc ? (p.v - merc) / merc : 0, bueno = paga ? dif > 0 : dif < 0;
        return '<div class="cmp-fila"><div>' + cmpNombreHtml(p.nombre, p.clave, true) + tratSubHtml(p.tratamiento) + '<div class="muted small">' + p.n + ' tarifa' + (p.n > 1 ? 's' : '') + (p.fijada ? ' · fijada' : '') + ' · ' + esc(p.conf.txt.toLowerCase()) + '</div></div>' +
          '<div class="cmp-barra"><div class="cmp-val' + (i === 0 ? ' mejor' : '') + '" style="width:' + pct(p.v) + '"></div><div class="cmp-merc" style="left:' + pct(merc) + '" title="Precio de mercado"></div></div>' +
          '<div class="num"><b>' + fmtCLP(p.v) + '</b><span class="muted small">' + esc(u) + '</span><div class="small ' + (Math.abs(dif) < 0.005 ? "muted" : bueno ? "ok-msg" : "warn") + '">' + (Math.abs(dif) < 0.005 ? "igual al mercado" : Math.round(Math.abs(dif) * 100) + "% " + (dif < 0 ? "bajo" : "sobre") + " mercado") + '</div></div></div>';
      }).join('') +
      '<div class="cmp-fila cmp-eje"><div></div><div class="muted small">│ línea = precio de mercado</div><div></div></div>' +
      '<div class="tscroll"><table class="ttar"><tr><th>Proveedor</th><th class="num">Mediana' + esc(u) + '</th><th class="num">Mín – máx</th><th class="num">Tarifas</th><th>Empresas</th><th>Fuente · motivo</th></tr>' +
        provs.map(p => '<tr><td>' + cmpNombreHtml(p.nombre, p.clave) + tratSubHtml(p.tratamiento) + '</td><td class="num"><b>' + fmtCLP(p.v) + '</b></td><td class="num">' + (p.min === p.max ? fmtCLP(p.min) : fmtCLP(p.min) + ' – ' + fmtCLP(p.max)) + '</td><td class="num">' + p.n + '</td>' +
          '<td class="small">' + esc(p.empresas || "Valor general") + '</td><td class="small">' + esc(p.fuente) + '</td></tr>' +
          (CMP_ABIERTOS.has(p.clave) ? '<tr class="cmp-det-fila"><td colspan="6">' + cmpDetalleHtml({ provKey: p.provKey, clave: p.clave, nombre: p.nombre, residuo: CMP.residuo, region: CMP.region, items: null, tarifas: p.tarifas, servicio: CMP.servicio, unidad: CMP.unidad }) + '</td></tr>' : '')).join('') +
      '</table></div>' +
      '<div class="muted small">Mediana de las tarifas vigentes de cada proveedor en la región (si tiene una referencial fijada, manda esa). Precios en UF llevados a pesos con la UF del día.</div></div>');
}

function renderComparar() {
  const box = document.getElementById("tarComparar"); if (!box) return;
  if (CMP.modo === "unidad") return renderCompararUnidad(box);
  const items = costosM3(TARIFAS);
  // Compradores: proveedores que pagan por el material (compra). No tienen costo por m³, pero se muestran en la tabla.
  const compras = TARIFAS.filter(t => t.activo && t.vigente && t.tipo === "paga" && t.precio_num != null && clpDe(t) != null && !esGeneral(t));
  const universo = items.concat(compras.map(t => ({ residuo: t.residuo, region: t.region || regionDeComuna(t.comuna) || "", provKey: t.provKey })));
  const rr = regionYResiduo(universo);
  const volTxt = i => fmtNum(i.vol, 2);
  const enRegTodos = items.filter(i => i.residuo === CMP.residuo && i.region === CMP.region);
  const enReg = enRegTodos.filter(i => pasaTratamiento(i.tratamiento));
  const tipos = unicosOrdenados(enReg.map(i => i.cont));
  CMP.tipos = CMP.tipos.filter(c => tipos.includes(c));
  const vols = [...new Set(enReg.filter(i => !CMP.tipos.length || CMP.tipos.includes(i.cont)).map(i => i.vol))].sort((a, b) => a - b).map(v => fmtNum(v, 2));
  CMP.vols = CMP.vols.filter(v => vols.includes(v));
  const sel = (id, opts, val, fn) => '<select id="' + id + '" onchange="' + fn + '">' + opts.map(o => '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
  const del = enReg; // todos los contenedores (el costo por contenedor está en la tabla)
  const porProv = {};
  // un proveedor con tratamientos distintos da una fila por tratamiento (Q7c)
  del.forEach(i => { const k = i.provKey + "|t:" + norm(i.tratamiento); (porProv[k] = porProv[k] || []).push(i); });
  const val = i => CMP.arriendo ? i.conArr : i.op;
  let provs = Object.entries(porProv).map(([clave, l]) => {
    const vs = l.map(val).filter(v => v != null);
    const comp = nombre => mediana(l.flatMap(i => i.lineas.filter(x => x.comp === nombre).map(x => x.porCont)).filter(v => v != null));
    const arr = l.flatMap(i => i.tarifas.filter(t => esServ(t, "Arriendo"))).map(clpDe).filter(v => v != null);
    const ts = l.flatMap(i => i.tarifas);
    return { nombre: l[0].proveedor, provKey: l[0].provKey, clave, tratamiento: l[0].tratamiento, items: l, tarifas: ts, n: l.length, v: vs.length ? mediana(vs) : null, op: mediana(l.map(i => i.op)), conArr: mediana(l.map(i => i.conArr).filter(v => v != null)),
      retiro: comp("Retiro (transporte)"), disp: mediana(l.flatMap(i => i.tarifas.filter(t => esServ(t, "Disposición")).map(clpDe))), arriendo: arr.length ? mediana(arr) : null,
      porCont: porContenedor(l), tipos: unicosOrdenados(l.map(i => i.cont)).join(", "), vols: [...new Set(l.map(i => i.vol))].sort((a, b) => a - b).map(v => fmtNum(v, 2)).join(", "), conf: confianzaDe(ts),
      fuente: unicosOrdenados(ts.map(t => t.fuente).filter(Boolean)).join(", ") + (unicosOrdenados(ts.map(t => tget(t, "motivo_precio")).filter(Boolean)).length ? " · " + unicosOrdenados(ts.map(t => tget(t, "motivo_precio")).filter(Boolean)).join(", ").toLowerCase() : "") };
  }).filter(p => p.v != null).sort((a, b) => a.v - b.v);
  const merc = mediana(provs.map(p => p.v));
  const todosProv = provs.map(p => p.nombre);
  const porComp = {};
  const conCosto = new Set(Object.values(porProv).map(l => l[0].provKey));
  compras.filter(t => t.residuo === CMP.residuo && (t.region || regionDeComuna(t.comuna)) === CMP.region && !conCosto.has(t.provKey) && pasaTratamiento(tget(t, "tratamiento")))
    .forEach(t => (porComp[t.provKey] = porComp[t.provKey] || []).push(t));
  const compradores = Object.values(porComp).map(l => {
    const kg = l.filter(t => unidadEs(t, "kg")), base = kg.length ? kg : l, vals = base.map(clpDe);
    return { nombre: l[0].proveedor_nombre, provKey: l[0].provKey, tarifas: l, valor: mediana(vals), min: Math.min(...vals), max: Math.max(...vals), unidad: base[0].unidad,
      n: new Set(l.map(t => norm(t.cliente) + "|" + norm(t.sucursal || t.comuna))).size };
  }).sort((a, b) => b.valor - a.valor);
  const max = Math.max(...provs.map(p => p.v), merc || 0) * 1.15 || 1;
  const pct = v => (v / max * 100).toFixed(1) + "%";
  box.innerHTML =
    '<div class="cmp-filtros">' + modoCmpHtml() +
      selRegRes(rr) +
      '<div class="cmp-toggle" role="group" aria-label="Qué costo comparar"><button type="button" class="' + (CMP.arriendo ? "" : "on") + '" onclick="CMP.arriendo=false;renderComparar()">Costo operativo</button><button type="button" class="' + (CMP.arriendo ? "on" : "") + '" onclick="CMP.arriendo=true;renderComparar()">Con arriendo</button></div>' +
      filtrosTratamientoHtml(enRegTodos.map(i => i.tratamiento).concat(compras.filter(t => t.residuo === CMP.residuo).map(t => tget(t, "tratamiento")))) +
    '</div>' +
    (!provs.length && !compradores.length ? '<div class="empty">Sin proveedores con costo por m³ para ' + esc(CMP.residuo) + ' en ' + esc(CMP.region || "esta región") + (CMP.arriendo ? ' con arriendo' : '') + '.</div>' :
    '<div class="cmp-box">' + (provs.length ? '<div class="cmp-cab"><b>Costo por m³ con contenedor lleno · todos los contenedores</b><span><b>Precio de mercado en ' + esc(CMP.region) + ': ' + fmtCLP(merc) + ' / m³</b> <span class="muted">(mediana de ' + todosProv.length + ' proveedor' + (todosProv.length > 1 ? 'es' : '') + ')</span></span></div>'
      : '<div class="cmp-cab"><b>Nadie cobra por ' + esc(CMP.residuo) + ' en ' + esc(CMP.region) + ': solo hay compradores del material</b></div>') +
      provs.map((p, i) => {
        const dif = merc ? (p.v - merc) / merc : 0;
        return '<div class="cmp-fila"><div>' + cmpNombreHtml(p.nombre, p.clave, true) + tratSubHtml(p.tratamiento) + '<div class="muted small">' + p.n + ' sucursal' + (p.n > 1 ? 'es' : '') + ' · ' + esc(p.conf.txt.toLowerCase()) + '</div></div>' +
          '<div class="cmp-barra"><div class="cmp-val' + (i === 0 ? ' mejor' : '') + '" style="width:' + pct(p.v) + '"></div><div class="cmp-merc" style="left:' + pct(merc) + '" title="Precio de mercado"></div></div>' +
          '<div class="num"><b>' + fmtCLP(p.v) + '</b><div class="small ' + (Math.abs(dif) < 0.005 ? "muted" : dif < 0 ? "ok-msg" : "warn") + '">' + (Math.abs(dif) < 0.005 ? "igual al mercado" : Math.round(Math.abs(dif) * 100) + "% " + (dif < 0 ? "bajo" : "sobre") + " mercado") + '</div></div></div>';
      }).join('') +
      '<div class="cmp-fila cmp-eje"><div></div><div class="muted small">│ línea = precio de mercado</div><div></div></div>' +
      '<div class="tscroll"><table class="ttar cmp-tab"><tr><th>Proveedor</th><th>Contenedor</th><th class="num">m³</th><th class="num">Operativo / m³</th><th class="num">Mín – máx / m³</th>' +
        '<th class="num">Retiro</th><th class="num">Disposición</th><th class="num">Arriendo / mes</th><th class="num">Sucursales</th></tr>' +
        provs.flatMap(p => p.porCont.map((c, j) => '<tr' + (j ? ' class="cmp-sub"' : '') + '><td>' + (j ? '' : cmpNombreHtml(p.nombre, p.clave) + tratSubHtml(p.tratamiento)) + '</td><td>' + esc(c.cont || "—") + '</td><td class="num">' + (c.vol ? fmtNum(c.vol, 2) : "—") + '</td>' +
          '<td class="num"><b>' + fmtCLP(c.op) + '</b></td><td class="num">' + (c.min === c.max ? fmtCLP(c.min) : fmtCLP(c.min) + ' – ' + fmtCLP(c.max)) + '</td>' +
          '<td class="num">' + (c.retiro != null ? fmtCLP(c.retiro) + (c.retiroConDisp ? '<div class="muted small">transporte + disposición' + (c.retiroCalc ? ' · ' + fmtNum(c.vol, 2) + ' m³ × costo por m³' : '') + '</div>' : '') : "—") +
            (c.porViaje != null ? '<div class="muted small">+ ' + fmtCLP(c.porViaje) + ' ' + esc(c.porViajeTxt) + ' por viaje</div>' : '') + '</td>' +
          '<td class="num">' + (c.disp != null ? fmtCLP(c.disp) + (c.dispUnidad ? ' <span class="muted small">/ ' + esc(c.dispUnidad) + '</span>' : '') : c.retiroConDisp ? '<span class="muted small">incluida en el retiro</span>' : (c.compra ? '' : "—")) +
            (c.compra ? '<div class="paga-txt">+' + fmtCLP(c.compra.valor) + ' / ' + esc(c.compra.unidad) + ' <span class="small">paga el proveedor</span></div>' : '') + '</td>' +
          '<td class="num">' + (c.arriendo != null ? fmtCLP(c.arriendo) : "—") + '</td><td class="num">' + c.n + '</td></tr>')
          .concat(CMP_ABIERTOS.has(p.clave) ? ['<tr class="cmp-det-fila"><td colspan="9">' + cmpDetalleHtml({ provKey: p.provKey, clave: p.clave, nombre: p.nombre, residuo: CMP.residuo, region: CMP.region, items: p.items, tarifas: p.tarifas }) + '</td></tr>'] : [])).join('') +
        compradores.map(c => '<tr class="cmp-compra"><td>' + cmpNombreHtml(c.nombre, c.provKey) + '</td><td>—</td><td class="num">—</td>' +
          '<td class="num"><span class="muted small">no cobra</span></td><td class="num">—</td><td class="num">—</td>' +
          '<td class="num"><div class="paga-txt">+' + fmtCLP(c.valor) + ' / ' + esc(c.unidad) + '</div><div class="paga-txt small">compra de material</div>' +
            (c.min !== c.max ? '<div class="muted small">' + fmtCLP(c.min) + ' – ' + fmtCLP(c.max) + '</div>' : '') + '</td>' +
          '<td class="num">—</td><td class="num">' + c.n + '</td></tr>' +
          (CMP_ABIERTOS.has(c.provKey) ? '<tr class="cmp-det-fila"><td colspan="9">' + cmpDetalleHtml({ provKey: c.provKey, nombre: c.nombre, residuo: CMP.residuo, region: CMP.region, items: null, tarifas: c.tarifas, servicio: "Compra de material" }) + '</td></tr>' : '')).join('') +
      '</table></div>' +
      '<div class="muted small">Cada proveedor se calcula por separado (nunca se mezcla el retiro de uno con la disposición de otro, ni dos tratamientos de un mismo proveedor): la barra es la mediana de todas sus sucursales en la región; la tabla separa cada contenedor, con el rango entre sus sucursales. Los contenedores chicos cuestan más por m³. Peoneta, servicio de faena e hidrojet se cobran por viaje y se suman al retiro. El arriendo se prorratea con ' + RETIROS_MES + ' retiros al mes. Disposición por kg llevada a m³ con la densidad del residuo' + (densidadDe(CMP.residuo) ? ' (' + fmtNum(densidadDe(CMP.residuo).kgm3, 0) + ' kg/m³)' : '') + '.</div></div>');
}
