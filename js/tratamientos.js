/* ============================================================
   TRATAMIENTOS Y CAMPOS V3 (Ecosistema 3.0, grilling 2026-10-23)
   - Tratamiento: solo en los cobros que llevan el residuo a su destino (Disposición, Transporte +
     disposición, Compra de material). Cada residuo ofrece solo sus tratamientos (pestaña
     "Tratamientos", base: planilla de importación masiva de la plataforma + coprocesamiento) y
     "Otra…" agrega uno nuevo para ese residuo; si el tratamiento es nuevo del todo, se pregunta su familia.
   - Familias Valorización / Eliminación / Otra (nivel 1 de SINADER), para filtrar en Comparar e Historial.
   - Campos V3 del formulario: destrucción de marca incluida, carga mín./máx. con unidad, vigencia
     (alerta informativa "Cotización vencida"), dato por confirmar y valor agregado.
   Depende de js/tarifas.js (norm, tget, esc, unicosOrdenados, filasAObjetos, campo, inp, api, abrirModal)
   y js/esquema.js (selOtraHtml, selOtraValor, unidadesLista).
   ============================================================ */
const TIPOS_CON_TRATAMIENTO = ["Disposición", "Transporte + disposición", "Compra de material"];
const FAMILIAS = ["Valorización", "Eliminación", "Otra"];
let TRATS = [];   // [{ residuo, tratamiento, familia }]
let EQUIVS = {};  // norm(residuo del Recomendador) → residuo de la plataforma (pestaña "Equivalencias", Q10)
let DENS = {};    // norm(residuo de la plataforma) → { kgm3, color } (pestaña "Densidades", Q16; viene en ton/m³)
const conTratamiento = serv => TIPOS_CON_TRATAMIENTO.includes(serv);
const SIN_TRAT = "Sin especificar";

async function cargarTratamientos() {
  try {
    const [t, e, d] = await Promise.all([
      gvizFetch(MIRROR_SHEET_ID, "sheet=Tratamientos", true, true),
      gvizFetch(MIRROR_SHEET_ID, "sheet=Equivalencias", true, true).catch(() => null),
      gvizFetch(MIRROR_SHEET_ID, "sheet=Densidades", true, true).catch(() => null)
    ]);
    TRATS = filasAObjetos(t).filter(x => x.residuo && x.tratamiento);
    EQUIVS = {};
    (e ? filasAObjetos(e) : []).forEach(x => { if (x.residuo && x.residuo_plataforma) EQUIVS[norm(x.residuo)] = x.residuo_plataforma; });
    DENS = {};
    // gviz entrega "0.066" con punto decimal: numDe lo leería como miles (66)
    (d ? filasAObjetos(d) : []).forEach(x => { const v = parseFloat(String(x.densidad_ton_m3).replace(",", ".")); if (x.residuo && (v > 0 || x.color)) DENS[norm(x.residuo)] = { kgm3: v > 0 ? v * 1000 : null, color: x.color || "" }; });
  } catch (err) { console.warn("No se pudo leer la pestaña Tratamientos:", err.message); }
}

const singular = k => k.replace(/(ES|S)$/, "");
/** Residuo de la plataforma que corresponde a uno del Recomendador: equivalencia, mismo nombre o singular/plural. */
function residuoPlataforma(residuo) {
  const k = norm(residuo); if (!k) return "";
  if (EQUIVS[k]) return EQUIVS[k];
  const x = TRATS.find(t => norm(t.residuo) === k) || TRATS.find(t => singular(norm(t.residuo)) === singular(k));
  return x ? x.residuo : "";
}
/** Fila de la pestaña Densidades de un residuo del Recomendador: equivalencia, mismo nombre, plataforma o singular/plural. */
function densidadRegistro(residuo) {
  const k = norm(residuo); if (!k) return null;
  return DENS[norm(EQUIVS[k] || "")] || DENS[k] || DENS[norm(residuoPlataforma(residuo))] ||
    Object.keys(DENS).filter(x => singular(x) === singular(k)).map(x => DENS[x])[0] || null;
}
/** Nombre que se muestra: el de la plataforma ("Carton" → "Cartón", "Plasticos" → "Mix Plástico"); si no tiene, el mismo. */
const residuoNombre = residuo => residuoPlataforma(residuo) || nombreLindo(residuo);
/** Residuos sin repetir por su nombre de la plataforma ("Plásticos" y "Mix Plásticos" son uno solo). */
function residuosUnicos(lista) {
  const vistos = new Set();
  return (lista || []).filter(r => { const k = norm(residuoNombre(r)); return k && !vistos.has(k) && vistos.add(k); });
}
/** Nombre del residuo (el de la plataforma) sobre su color (sin color: solo el nombre).
 *  cls: clase extra (p. ej. "chip"). Letra blanca; en los colores muy claros (amarillos, grises claros), letra oscura. */
function resTag(residuo, cls) {
  const txt = esc(residuo ? residuoNombre(residuo) : "-");
  const c = (densidadRegistro(residuo) || {}).color || "";
  if (!/^#[0-9a-f]{6}$/i.test(c)) return cls ? '<span class="' + cls + '">' + txt + '</span>' : txt;
  const n = parseInt(c.slice(1), 16), lum = (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  return '<span class="res-tag' + (lum > 0.72 ? ' res-claro' : '') + (cls ? ' ' + cls : '') + '" style="--rc:' + c + '">' + txt + '</span>';
}
/** Tratamientos del residuo (Q8). Si el residuo no tiene lista, se ofrecen todos los conocidos. */
function tratamientosDe(residuo) {
  const rp = residuoPlataforma(residuo);
  const propios = rp ? TRATS.filter(t => norm(t.residuo) === norm(rp)).map(t => t.tratamiento) : [];
  return unicosOrdenados(propios.length ? propios : TRATS.map(t => t.tratamiento));
}
const tratamientoPermitido = (residuo, tr) => tratamientosDe(residuo).some(x => norm(x) === norm(tr));
function familiaDe(tr) {
  if (!tr) return "";
  const x = TRATS.find(t => norm(t.tratamiento) === norm(tr) && t.familia);
  return x ? x.familia : "";
}
/** Texto corto para mostrar: "Reciclaje · Valorización". */
const tratamientoTxt = t => { const tr = tget(t, "tratamiento"); return tr ? tr + (familiaDe(tr) ? " · " + familiaDe(tr) : "") : ""; };

/* ---------- celda de tratamiento en las tablas de cobros (Nueva tarifa / Editar tarifas) ---------- */
/** v: { serv, trat, dm }. on = handler de cambio (texto JS). */
function tratCeldaHtml(residuo, v, on) {
  return '<div class="nt-trat">' +
    selOtraHtml('class="nt-trat-sel"' + (on ? ' onchange="' + on + '"' : ''), tratamientosDe(residuo), v.trat || "", SIN_TRAT) +
    '<label class="chk nt-dm-l"><input type="checkbox" class="nt-dm"' + (v.dm === "si" ? " checked" : "") + (on ? ' onchange="' + on + '"' : '') + '> incluye destrucción de marca</label>' +
    '<div class="muted small">solo en disposición o compra</div></div>';
}
function tratCeldaValor(tr) {
  const s = tr.querySelector(".nt-trat-sel"), dm = tr.querySelector(".nt-dm");
  return { trat: s ? selOtraValor(s) : "", dm: dm && dm.checked ? "si" : "" };
}
function tratCeldaPoner(tr, v) {
  const s = tr.querySelector(".nt-trat-sel"), dm = tr.querySelector(".nt-dm");
  if (s) selOtraPoner(s, v.trat || ""); if (dm) dm.checked = v.dm === "si";
}

/* ---------- tratamiento nuevo: se guarda para ese residuo, y si es nuevo del todo se pregunta su familia ---------- */
function preguntarFamilia(tratamiento) {
  return new Promise(resolve => {
    window.__famResolver = f => { window.__famResolver = null; cerrarModal("famModal"); resolve(f); };
    abrirModal("famModal",
      '<h3>Tratamiento nuevo</h3><p>¿A qué familia pertenece <b>' + esc(tratamiento) + '</b>? Sirve para el filtro de Comparar e Historial.</p>' +
      '<div class="tf-acc">' + FAMILIAS.map(f => '<button class="cbtn" onclick="window.__famResolver(\'' + f + '\')">' + f + '</button>').join(' ') + '</div>',
      () => { if (window.__famResolver) { window.__famResolver = null; resolve(""); } });
  });
}
/** Antes de guardar: registra los tratamientos que no estén para su residuo (Q8) y su familia si es nuevo (Q12). */
async function asegurarTratamientos(lista) {
  const vistos = new Set();
  for (const d of lista) {
    const tr = String(d.tratamiento || "").trim();
    if (!tr || !conTratamiento(d.tipo_servicio)) continue;
    const res = residuoPlataforma(d.residuo) || d.residuo;
    const k = norm(res) + "|" + norm(tr);
    if (vistos.has(k)) continue;
    vistos.add(k);
    if (TRATS.some(t => norm(t.residuo) === norm(res) && norm(t.tratamiento) === norm(tr))) continue;
    const fam = familiaDe(tr) || await preguntarFamilia(tr);
    try {
      const r = await api("tratamiento_agregar", { residuo: res, tratamiento: tr, familia: fam }, true);
      TRATS.push({ residuo: res, tratamiento: tr, familia: r.familia || fam });
    } catch (e) { console.warn("No se pudo agregar el tratamiento", res, tr, e.message); } // no impide guardar la tarifa
  }
}

/* ---------- campos V3 del formulario de una tarifa (prefijo f_) ---------- */
const CARGA_UNIDADES = ["m3", "kg", "ton", "pallet", "unidad"];
function camposV3Html(v, residuos) {
  const opciones = unicosOrdenados([].concat(...(residuos.length ? residuos : [""]).map(tratamientosDe)));
  return campo("f_tratamiento", "Tratamiento <span class=\"muted\">· solo en disposición o compra</span>",
      selOtraHtml('id="f_tratamiento"', opciones, tget(v, "tratamiento"), SIN_TRAT) +
      '<label class="chk"><input type="checkbox" id="f_dm"' + (siNo(v.incluye_destruccion_marca) === "si" ? " checked" : "") + '> incluye destrucción de marca</label>') +
    campo("f_vigente_hasta", "Vigente hasta <span class=\"muted\">· opcional</span>", '<input id="f_vigente_hasta" type="date" value="' + esc(tget(v, "vigente_hasta")) + '">') +
    campo("f_por_confirmar", "Dato por confirmar", '<label class="chk"><input type="checkbox" id="f_por_confirmar"' + (siNo(v.por_confirmar) === "si" ? " checked" : "") + '> falta confirmar algún dato (baja la confianza)</label>') +
    campo("f_valor_agregado", "Valor agregado <span class=\"muted\">· CO₂ evitado, material recuperado, trazabilidad…</span>", '<textarea id="f_valor_agregado" rows="2">' + esc(tget(v, "valor_agregado")) + '</textarea>', "span2");
}
/** Unidad de la carga mín./máx.: vacía = la unidad del precio. */
function cargaUnidadSel(id, val) {
  return '<select id="' + id + '"><option value="">= unidad del precio</option>' + CARGA_UNIDADES.map(u => '<option' + (u === val ? ' selected' : '') + '>' + u + '</option>').join('') + '</select>';
}
function leerCamposV3() {
  const chk = id => !!(document.getElementById(id) || {}).checked;
  return {
    tratamiento: selOtraValor("f_tratamiento"), incluye_destruccion_marca: chk("f_dm") ? "si" : "",
    vigente_hasta: ((document.getElementById("f_vigente_hasta") || {}).value || "").trim(),
    por_confirmar: chk("f_por_confirmar") ? "si" : "",
    valor_agregado: ((document.getElementById("f_valor_agregado") || {}).value || "").trim(),
    carga_unidad: ((document.getElementById("f_carga_unidad") || {}).value || "").trim()
  };
}

/* ---------- vigencia y por confirmar ---------- */
const hoyISO = () => new Date().toISOString().slice(0, 10);
const estaVencida = t => !!tget(t, "vigente_hasta") && tget(t, "vigente_hasta") < hoyISO();
const porConfirmar = t => siNo(t.por_confirmar) === "si";
/** Marcas informativas de una tarifa (no son alertas de datos faltantes). */
function marcasV3Html(t) {
  return (estaVencida(t) ? ' <span class="pill p-vencida" title="Vigente hasta ' + esc(tget(t, "vigente_hasta")) + '">Cotización vencida</span>' : '') +
    (porConfirmar(t) ? ' <span class="pill p-confirmar">Por confirmar</span>' : '') +
    (siNo(t.incluye_destruccion_marca) === "si" ? ' <span class="pill p-dm">incluye destrucción de marca</span>' : '');
}
