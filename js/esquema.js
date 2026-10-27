/* ============================================================
   ESQUEMA V2 DE TARIFAS (Ecosistema 3.0, grilling 2026-10-21)
   - Tipo de servicio (reemplaza los sí/no de transporte y disposición), contenedor con volumen,
     motivo del precio, tipo de fuente + referencia, destino (planta) con su comuna.
   - El servidor valida lo mismo al crear (Esquema.js) y calcula el precio en UF a la fecha.
   - Lo usan el formulario, Nueva tarifa, Editar tarifas, Importar planilla y Pegar desde Claude.
   Depende de js/tarifas.js (CATS, esc, norm, tget, siNo, campo, inp, sel) y js/sinader.js.
   ============================================================ */
const TIPOS_SERVICIO = ["Transporte", "Disposición", "Transporte + disposición", "Arriendo", "Compra de material", "Peoneta", "Servicio de faena", "Hidrojet", "Destrucción de marca"];
// Peoneta, faena e hidrojet: servicios por viaje cobrados aparte del transporte (facturas Recycling–Abastible Talca, 2026-10-22)
const TIPOS_BASE = TIPOS_SERVICIO.slice(0, 5);
// se suman al retiro en el costo por m³ (destrucción de marca solo si se cobra por camión: viaje o retiro)
const SERVICIOS_POR_VIAJE = TIPOS_SERVICIO.slice(5);
/** Tipo de servicio en la clave de duplicados, solo si no es de los básicos (peoneta y faena del mismo viaje son tarifas distintas). */
const servicioClave = t => { const ts = tget(t, "tipo_servicio"); return ts && !canonDe(TIPOS_BASE, ts) ? norm(ts) : ""; };
const TIPOS_CON_DESTINO = ["Transporte", "Disposición", "Transporte + disposición"];
const UNIDADES_CON_CONTENEDOR = ["viaje", "retiro"];
const MOTIVOS_PRECIO = ["Precio de lista", "Por volumen", "Acuerdo marco", "Promoción", "Licitación", "Precio de entrada", "Precio ejecutado", "Otro", "No sé"];
const TIPOS_FUENTE = ["Plataforma de trazabilidad", "Marketplace Recylink", "Contratos de clientes", "Licitaciones privadas de clientes",
  "Facturas y órdenes de compra", "Análisis de ahorro y líneas base", "Cartas de oferta de gestores", "Cotizaciones de proveedores",
  "Propuestas comerciales de Recylink", "Correos históricos", "Ecosistema 1.0 / GAIA", "Licitaciones públicas",
  "Fuentes técnicas e institucionales", "Boca a boca", "Nóminas de gestores REP", "SINADER / RETC"];
// Valores de fuente anteriores a V2
const FUENTES_ANTERIORES = { cotizacion: "Cotizaciones de proveedores", "cotización": "Cotizaciones de proveedores", contrato: "Contratos de clientes",
  plataforma: "Plataforma de trazabilidad", informal: "Boca a boca", "carga inicial": "Ecosistema 1.0 / GAIA" };

/** Listas con lo que se haya agregado con "Otra…" (catálogo del Sheet). */
const tiposServicio = () => unicosOrdenados(TIPOS_SERVICIO.concat(CATS.tipo_servicio || [])).sort((a, b) => (TIPOS_SERVICIO.indexOf(a) + 1 || 99) - (TIPOS_SERVICIO.indexOf(b) + 1 || 99));
const fuentesLista = () => (CATS.fuente && CATS.fuente.length ? CATS.fuente : TIPOS_FUENTE);
const unidadesLista = () => CATS.unidad && CATS.unidad.length ? CATS.unidad : ["kg", "ton", "m3", "retiro", "viaje", "servicio", "mes", "tambor", "pallet", "unidad", "hora"];

const canonDe = (lista, v) => { const k = norm(v); return k ? lista.find(x => norm(x) === k) || "" : ""; };
function tipoServicioCanon(v) {
  const alias = { TRANSPORTEYDISPOSICION: "Transporte + disposición", AMBOS: "Transporte + disposición", RETIRO: "Transporte", TRATAMIENTO: "Disposición", COMPRA: "Compra de material" };
  return canonDe(TIPOS_SERVICIO, v) || alias[norm(v)] || "";
}
const motivoCanon = v => canonDe(MOTIVOS_PRECIO, v) || (norm(v) === "NOSE" ? "No sé" : "");
function fuenteCanon(v) { const s = String(v || "").trim(); return s ? FUENTES_ANTERIORES[s.toLowerCase()] || canonDe(TIPOS_FUENTE, s) || s : ""; }

/** Tipo de servicio a partir de los sí/no anteriores ('' = no se puede saber). Igual que el servidor. */
function tipoServicioDeSiNo(t) {
  if (String(t.tipo_transaccion || t.tipo || "").toLowerCase() === "paga") return "Compra de material";
  const tr = siNo(t.incluye_transporte) || "si", di = siNo(t.incluye_disposicion) || "si";
  if (tr === "si" && di === "si") return "Transporte + disposición";
  if (tr === "si") return "Transporte";
  if (di === "si") return "Disposición";
  if (String(t.unidad).toLowerCase() === "mes" || /arriendo/i.test(tget(t, "detalle"))) return "Arriendo";
  return "";
}
/** Sí/no equivalentes a un tipo de servicio (para lo que aún los muestra o los compara). */
function siNoDeTipo(ts) {
  return { incluye_transporte: ts === "Transporte" || ts === "Transporte + disposición" ? "si" : "no",
           incluye_disposicion: ts === "Disposición" || ts === "Transporte + disposición" ? "si" : "no" };
}

/** Volumen en m³ escrito en el nombre del contenedor ("Batea 30 m3", "Contenedor 1,1 m3", "Tambor 200 L"). */
function volumenDeContenedor(nombre) {
  const s = String(nombre || "");
  let m = s.match(/(\d+(?:[.,]\d+)?)\s*m\s*3|(\d+(?:[.,]\d+)?)\s*m³/i);
  if (m) return Number((m[1] || m[2]).replace(",", "."));
  m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:L|lt|litros)\b/i);
  return m ? Number(m[1].replace(",", ".")) / 1000 : null;
}
/** Tipo de contenedor sin medida ("Batea 30 m3" → "Batea"); la medida va en volumen_m3. */
function contenedorBase(nombre) {
  return String(nombre || "").replace(/\s*\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(?:m\s*3|m³|L|lt|litros)\b\.?/ig, "").replace(/\s{2,}/g, " ").trim();
}
/** Para mostrar: tipo + volumen ("Batea · 30 m³"). */
function contenedorTxt(t) {
  const base = contenedorBase(t.contenedor), v = volumenEf(t);
  return base ? base + (v != null ? " · " + fmtNum(v, 2) + " m³" : "") : "";
}
/** Clave de contenedor para comparar tarifas (tipo + volumen), igual antes y después de la migración. */
const contKey = t => norm(contenedorBase(t.contenedor)) + "|" + (volumenEf(t) ?? "");
/** Catálogo de contenedores sin medidas, sin repetidos. */
const contenedoresCatalogo = () => unicosOrdenados((CATS.contenedor || []).map(contenedorBase).filter(Boolean)).filter((x, i, a) => a.findIndex(y => norm(y) === norm(x)) === i);

/* Selector con opción "Otra…": muestra un campo de texto para escribir un valor que no está en la lista. */
const OTRA = "__otra";
function selOtraHtml(attrs, opciones, val, vacio) {
  val = String(val || "");
  const enLista = !val || opciones.some(o => (Array.isArray(o) ? o[0] : o) === val);
  // el onchange/oninput de quien lo usa se suma al propio (y también corre al escribir en "Otra…")
  let extra = "";
  attrs = String(attrs || "").replace(/\s*on(?:change|input)="([^"]*)"/g, (m, h) => { extra += h + ";"; return ""; });
  return '<span class="sel-otra"><select ' + attrs + ' onchange="selOtraCambio(this);' + extra + '">' +
    (vacio != null ? '<option value="">' + esc(vacio) + '</option>' : '') +
    opciones.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return '<option value="' + esc(v) + '"' + (v === val ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') +
    '<option value="' + OTRA + '"' + (enLista ? '' : ' selected') + '>Otra…</option></select>' +
    '<input class="sel-otra-txt" placeholder="Escribe cuál" value="' + esc(enLista ? "" : val) + '"' + (extra ? ' oninput="' + extra + '"' : '') + (enLista ? ' style="display:none"' : '') + '></span>';
}
function selOtraCambio(sel) {
  const t = sel.parentNode.querySelector(".sel-otra-txt"); if (!t) return;
  const otra = sel.value === OTRA;
  t.style.display = otra ? "" : "none";
  if (otra) t.focus();
}
/** Valor elegido (o escrito en "Otra…"). sel = el <select> o su id. */
function selOtraValor(sel) {
  if (typeof sel === "string") sel = document.getElementById(sel);
  if (!sel) return "";
  if (sel.value !== OTRA) return sel.value;
  const t = sel.parentNode.querySelector(".sel-otra-txt");
  return t ? t.value.trim() : "";
}
/** Pone un valor (de la lista o, si no está, como "Otra…"). */
function selOtraPoner(sel, val) {
  val = String(val || "");
  const hay = [...sel.options].some(o => o.value === val && o.value !== OTRA);
  sel.value = hay || !val ? val : OTRA;
  const t = sel.parentNode.querySelector(".sel-otra-txt");
  if (t) { t.value = hay ? "" : val; t.style.display = hay || !val ? "none" : ""; }
}

/** Contenedor de un cobro: lista sin medidas + "Otra…"; vacío = el de las condiciones. */
function contSel(val, attrs, vacio) { return selOtraHtml('class="nt-cont"' + (attrs || ''), contenedoresCatalogo(), contenedorBase(val), vacio || "—"); }
/** Contenedor y volumen de un cobro: los suyos o, si no tiene contenedor propio, los por defecto.
    Si el cobro tiene contenedor y no volumen, solo hereda el volumen si es el mismo contenedor. */
function contVolDe(linea, def) {
  const c = linea.cont || "";
  if (!c) return { cont: def.cont || "", vol: linea.vol || def.vol || "" };
  return { cont: c, vol: linea.vol || (norm(contenedorBase(c)) === norm(contenedorBase(def.cont)) ? def.vol || "" : "") };
}

const volumenEf = d => { const v = numDe(d.volumen_m3); return v != null ? v : volumenDeContenedor(d.contenedor); };

/**
 * Campos obligatorios que le faltan a una tarifa (Q14/Q17), con el campo del formulario que los completa.
 * Mismas reglas que validarMinimos_ del servidor.
 */
function faltantesMinimos(d) {
  const f = [], falta = (txt, campo) => f.push({ txt, campo });
  const vacio = v => v == null || String(v).trim() === "";
  if (vacio(d.proveedor_id) && vacio(d.proveedor_nombre)) falta("proveedor", "f_proveedor");
  if (vacio(d.residuo)) falta("residuo", "f_residuos");
  if (vacio(d.tipo_servicio)) falta("tipo de servicio", "f_tipo_servicio");
  if (d.precio_num === null || (d.precio_num === undefined && vacio(d.precio))) falta("monto", "f_precio");
  if (vacio(d.unidad)) falta("unidad", "f_unidad");
  if (vacio(d.fecha)) falta("fecha", "f_fecha");
  if (vacio(d.fuente)) falta("tipo de fuente", "f_fuente");
  if (vacio(d.motivo_precio)) falta("motivo del precio", "f_motivo_precio");
  const general = norm(d.estado_servicio) === "VALORGENERAL";
  // origen: la comuna o, si no se conoce (p. ej. lo que interpretó Claude), al menos la región; la referencial (Valor general) no exige lugar
  if (vacio(d.comuna) && vacio(d.region) && !general) falta("comuna o región de origen", "f_comunas");
  // Comuna de destino: opcional por ahora (decisión 2026-10-21)
  if (norm(d.estado_servicio) === "ACTIVO" && (vacio(d.cliente) || vacio(d.sucursal))) falta("empresa y sucursal (servicio Activo)", "f_sucursales");
  if (UNIDADES_CON_CONTENEDOR.includes(String(d.unidad || "").toLowerCase())) {
    if (vacio(d.contenedor)) falta("contenedor (cobro por " + d.unidad + ")", "f_contenedores");
    if (volumenEf(d) == null) falta("volumen del contenedor en m³", "f_volumen_m3");
  }
  return f;
}
/** Días de pago por defecto según la empresa: Euro Constructora 120, el resto 30. */
const pagoDiasPorDefecto = cliente => /EURO/.test(norm(cliente)) ? 120 : 30;

const textoFaltantes = (d, f) => "Faltan datos obligatorios" + (d && d.residuo ? " (" + [d.residuo, d.sucursal || d.comuna].filter(Boolean).join(" · ") + ")" : "") + ": " + f.map(x => x.txt).join(", ") + ".";

/* ---------------- destino: empresa y planta donde termina el residuo ----------------
   Primero la empresa de destino y después su planta. Empresas, en este orden: destinos habituales
   del proveedor (ClickUp "Destinos concurridos"), el propio proveedor si tiene plantas en SINADER,
   las razones sociales de SINADER y las fichas de ClickUp que son destino y no están en SINADER.
   Plantas: los establecimientos SINADER de esa empresa (por RUT). Ambas se pueden escribir libres.
   Se guarda en "destino" como "Empresa — Planta (RETC n)". */
const SEP_DESTINO = " — ";
const etiquetaPlanta = e => e.nombre + " (RETC " + e.codigo + ")";
const opcionDL = (v, txt) => '<option value="' + esc(v) + '">' + esc(txt || "") + '</option>';
const hayRut = () => typeof SINADER_POR_RUT !== "undefined" && typeof rutClave === "function";
/** Fichas de ClickUp que son destino (destinatario final, gestor o tratamiento) y no están en SINADER. */
function fichasDestino() {
  return (SUPPLIERS || []).filter(s => !s.sheetOnly &&
    (/DESTINATARIO|GESTOR/.test(norm(s.actor)) || /TRATAMIENTO/.test(norm(s.categoria))) &&
    !(hayRut() && SINADER_POR_RUT[rutClave(s.rut)]));
}
const comunaDeFicha = s => (s && typeof detectarComuna === "function" ? detectarComuna([s.direccion, s.ubicTxt].filter(Boolean).join(", ")) : "") || "";
/** Nombre de empresa de destino para una ficha de ClickUp: su razón social en SINADER si calza por RUT. */
function empresaDeFicha(f) {
  const ests = f && hayRut() ? SINADER_POR_RUT[rutClave(f.rut)] : null;
  return ests && ests.length ? ests[0].razon : f ? f.name : "";
}
/** Plantas SINADER de una empresa (por razón social o por el RUT de su ficha en ClickUp). */
function plantasDeEmpresa(nombre) {
  const k = norm(nombre); if (!k || typeof SINADER === "undefined") return [];
  const porRazon = SINADER.filter(e => norm(e.razon) === k);
  if (porRazon.length) return porRazon;
  const f = (SUPPLIERS || []).find(x => norm(x.name) === k);
  return f && hayRut() ? SINADER_POR_RUT[rutClave(f.rut)] || [] : [];
}
const separarDestino = v => { const p = String(v || "").split(SEP_DESTINO); return { emp: p[0] || "", planta: p.slice(1).join(SEP_DESTINO) }; };
/** Comuna del destino: la de la planta SINADER, o la que se deduce de la dirección de la ficha de ClickUp. */
function comunaDeDestino(v) {
  v = String(v || "").trim();
  const m = v.match(/RETC\s+([A-Z0-9-]+)\)/i);
  if (m && typeof SINADER !== "undefined") { const e = SINADER.find(x => x.codigo === m[1]); if (e) return comunaCanonica(e.comuna) || e.comuna; }
  const emp = separarDestino(v).emp;
  const pl = plantasDeEmpresa(emp);
  if (pl.length === 1) return comunaCanonica(pl[0].comuna) || pl[0].comuna;
  return comunaDeFicha((SUPPLIERS || []).find(x => norm(x.name) === norm(emp)));
}
let _EMPRESAS_DESTINO = null; // opciones comunes a todos los proveedores (se arman una vez)
function datalistEmpresasDestino(id, nombreProveedor) {
  const s = nombreProveedor ? buscarProveedorClickUp(nombreProveedor) : null;
  const vistos = new Set(), primeras = [];
  const add = (nombre, nota) => { if (nombre && !vistos.has(norm(nombre))) { vistos.add(norm(nombre)); primeras.push(opcionDL(nombre, nota)); } };
  (s && s.destinos || []).forEach(d => { const f = (SUPPLIERS || []).find(x => x.id === d.id); add(f ? empresaDeFicha(f) : d.name, "destino habitual del proveedor"); });
  if (s && hayRut() && SINADER_POR_RUT[rutClave(s.rut)]) add(empresaDeFicha(s), "plantas propias del proveedor");
  if (!_EMPRESAS_DESTINO && typeof SINADER !== "undefined" && SINADER.length && SUPPLIERS.length) {
    const porRazon = {};
    SINADER.forEach(e => { const k = norm(e.razon); (porRazon[k] = porRazon[k] || { razon: e.razon, n: 0, comunas: new Set() }); porRazon[k].n++; if (e.comuna) porRazon[k].comunas.add(e.comuna); });
    _EMPRESAS_DESTINO = Object.values(porRazon).map(x => ({ nombre: x.razon, nota: "SINADER · " + x.n + " planta(s)" + (x.comunas.size === 1 ? " · " + [...x.comunas][0] : "") }))
      .concat(fichasDestino().map(f => ({ nombre: f.name, nota: "ClickUp, no está en SINADER" + (comunaDeFicha(f) ? " · " + comunaDeFicha(f) : "") })));
  }
  return '<datalist id="' + id + '">' + primeras.join('') +
    (_EMPRESAS_DESTINO || []).filter(x => !vistos.has(norm(x.nombre))).map(x => opcionDL(x.nombre, x.nota)).join('') + '</datalist>';
}
/** Campos Empresa de destino + Planta (prefijo f o n); la comuna de destino es p + "_comuna_destino". */
function destinoHtml(p, valor, proveedor) {
  const d = separarDestino(valor);
  return campo(p + "_dest_emp", "Empresa de destino <span class=\"muted\">· SINADER, ClickUp o escrita</span>",
      inp(p + "_dest_emp", d.emp, 'list="' + p + '_destEmpDL" autocomplete="off" placeholder="Empresa donde termina el residuo" onchange="alElegirEmpresaDestino(\'' + p + '\')"') +
      '<span id="' + p + '_destEmpBox">' + datalistEmpresasDestino(p + "_destEmpDL", proveedor) + '</span>') +
    campo(p + "_dest_planta", "Planta <span class=\"muted\">· de esa empresa</span>",
      inp(p + "_dest_planta", d.planta, 'list="' + p + '_destPlaDL" autocomplete="off" placeholder="Elige la empresa primero" onchange="alElegirPlanta(\'' + p + '\')"') +
      '<datalist id="' + p + '_destPlaDL">' + plantasDeEmpresa(d.emp).map(e => opcionDL(etiquetaPlanta(e), e.comuna || "")).join('') + '</datalist>');
}
const valDe = id => ((document.getElementById(id) || {}).value || "").trim();
function ponerComunaDestino(p, com) { const c = document.getElementById(p + "_comuna_destino"); if (c && com) c.value = comunaCanonica(com) || com; }
/** Al elegir la empresa: llena la lista de sus plantas (si tiene una sola, la deja elegida) y la comuna. */
function alElegirEmpresaDestino(p) {
  const emp = valDe(p + "_dest_emp"), pl = plantasDeEmpresa(emp);
  const dl = document.getElementById(p + "_destPlaDL");
  if (dl) dl.innerHTML = pl.map(e => opcionDL(etiquetaPlanta(e), e.comuna || "")).join('');
  const inpPl = document.getElementById(p + "_dest_planta");
  if (inpPl) { inpPl.value = pl.length === 1 ? etiquetaPlanta(pl[0]) : ""; inpPl.placeholder = pl.length ? pl.length + " planta(s) en SINADER" : "Sin plantas en SINADER: escríbela si la sabes"; }
  ponerComunaDestino(p, comunaDeDestino(emp + (inpPl && inpPl.value ? SEP_DESTINO + inpPl.value : "")));
}
function alElegirPlanta(p) { ponerComunaDestino(p, comunaDeDestino(valDe(p + "_dest_emp") + SEP_DESTINO + valDe(p + "_dest_planta"))); }
/** Valor a guardar en "destino". */
function leerDestino(p) { const e = valDe(p + "_dest_emp"), pl = valDe(p + "_dest_planta"); return e && pl ? e + SEP_DESTINO + pl : e || pl; }
/* Destino en una celda de tabla (por residuo): empresa + planta, con la lista de plantas propia de la fila. */
let _DEST_SEQ = 0;
function destinoCeldaHtml(valor, onCambio) {
  const d = separarDestino(valor), id = "dpl" + (++_DEST_SEQ);
  return '<div class="nt-dest">' +
    '<input class="nt-d-emp" list="ntDestEmpDL" autocomplete="off" placeholder="Empresa de destino" value="' + esc(d.emp) + '" onchange="destCeldaEmp(this);' + (onCambio || '') + '">' +
    '<input class="nt-d-pla" list="' + id + '" autocomplete="off" placeholder="Planta" value="' + esc(d.planta) + '" onchange="' + (onCambio || '') + '">' +
    '<datalist id="' + id + '">' + plantasDeEmpresa(d.emp).map(e => opcionDL(etiquetaPlanta(e), e.comuna || "")).join('') + '</datalist>' +
    '<div class="muted small nt-d-com">' + esc(comunaDeDestino(valor)) + '</div></div>';
}
/** Al elegir la empresa en una celda: lista sus plantas (si es una sola, la deja elegida). */
function destCeldaEmp(el) {
  const caja = el.closest(".nt-dest"), pl = plantasDeEmpresa(el.value);
  const inpPl = caja.querySelector(".nt-d-pla"), dl = document.getElementById(inpPl.getAttribute("list"));
  if (dl) dl.innerHTML = pl.map(e => opcionDL(etiquetaPlanta(e), e.comuna || "")).join('');
  inpPl.value = pl.length === 1 ? etiquetaPlanta(pl[0]) : "";
  inpPl.placeholder = pl.length ? pl.length + " planta(s)" : "Planta (escríbela)";
}
/** Valor de una celda de destino ("Empresa — Planta"). */
function destCeldaValor(caja) {
  if (!caja) return "";
  const e = caja.querySelector(".nt-d-emp").value.trim(), p = caja.querySelector(".nt-d-pla").value.trim();
  return e && p ? e + SEP_DESTINO + p : e || p;
}
function destCeldaPoner(caja, valor) {
  if (!caja) return;
  const d = separarDestino(valor);
  caja.querySelector(".nt-d-emp").value = d.emp;
  const inpPl = caja.querySelector(".nt-d-pla"), dl = document.getElementById(inpPl.getAttribute("list"));
  if (dl) dl.innerHTML = plantasDeEmpresa(d.emp).map(e => opcionDL(etiquetaPlanta(e), e.comuna || "")).join('');
  inpPl.value = d.planta;
  caja.querySelector(".nt-d-com").textContent = comunaDeDestino(valor);
}

/** Lista combinada "Empresa — Planta (RETC n)" para Editar tarifas (un solo campo por bloque). */
let _DESTINOS_COMBINADOS = null;
function datalistDestinosCombinados(id) {
  if (!_DESTINOS_COMBINADOS && typeof SINADER !== "undefined" && SINADER.length && SUPPLIERS.length) {
    _DESTINOS_COMBINADOS = SINADER.map(e => opcionDL(e.razon + SEP_DESTINO + etiquetaPlanta(e), e.comuna || "")).join('') +
      fichasDestino().map(f => opcionDL(f.name, "ClickUp, no está en SINADER")).join('');
  }
  return '<datalist id="' + id + '">' + (_DESTINOS_COMBINADOS || '') + '</datalist>';
}
/** Editar tarifas: al elegir un destino, completa la comuna del mismo bloque. */
function alElegirDestinoEl(el) {
  const c = el.closest(".nt-suc") && el.closest(".nt-suc").querySelector('[data-c="comuna_destino"]'), com = comunaDeDestino(el.value);
  if (c && com) c.value = comunaCanonica(com) || com;
}

/* ---------------- campos V2 del formulario de tarifa ---------------- */
/** Campos nuevos para el formulario (prefijo f_). v = valores iniciales. */
function camposV2Html(v, proveedor) {
  const motivos = [["", "— elegir —"]].concat(MOTIVOS_PRECIO.map(x => [x, x]));
  const volIni = v.volumen_m3 !== "" && v.volumen_m3 != null ? v.volumen_m3 : (volumenDeContenedor(v.contenedor) ?? "");
  return campo("f_tipo_servicio", "Tipo de servicio *", selOtraHtml('id="f_tipo_servicio"', tiposServicio(), tipoServicioCanon(v.tipo_servicio) || v.tipo_servicio || "", "— elegir —")) +
    campo("f_volumen_m3", "Volumen del contenedor (m³)", inp("f_volumen_m3", volIni, 'inputmode="decimal" placeholder="Ej: 30"')) +
    campo("f_motivo_precio", "Motivo del precio *", sel("f_motivo_precio", motivos, motivoCanon(v.motivo_precio))) +
    campo("f_fuente", "Tipo de fuente *", selOtraHtml('id="f_fuente"', fuentesLista(), fuenteCanon(v.fuente), "— elegir —")) +
    campo("f_fuente_ref", "Referencia de la fuente <span class=\"muted\">· opcional</span>", inp("f_fuente_ref", v.fuente_ref, 'placeholder="Ej: Cotización N° 123, Contrato Sodimac 2026"')) +
    destinoHtml("f", v.destino, proveedor) +
    campo("f_condicion_pago_dias", "Condición de pago (días) <span class=\"muted\">· Euro 120, resto 30</span>", inp("f_condicion_pago_dias", v.condicion_pago_dias, 'inputmode="numeric" placeholder="vacío = según la empresa"')) +
    campo("f_comuna_destino", "Comuna de destino <span class=\"muted\">· opcional</span>", inp("f_comuna_destino", v.comuna_destino, 'list="comunaDestDL" autocomplete="off"') +
      '<datalist id="comunaDestDL">' + (typeof COMUNAS_LISTA !== "undefined" ? COMUNAS_LISTA : []).map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>');
}
/** Lee los campos V2 del formulario. */
function leerCamposV2(g) {
  const num = id => { const s = g(id); if (s === "") return ""; const n = numDe(s); if (n == null) throw new Error("Revisa el número en " + id.replace("f_", "").replace("_", " ") + "."); return n; };
  return {
    tipo_servicio: selOtraValor("f_tipo_servicio"), volumen_m3: num("f_volumen_m3"),
    motivo_precio: g("f_motivo_precio"), fuente: selOtraValor("f_fuente"), fuente_ref: g("f_fuente_ref"),
    destino: leerDestino("f"), comuna_destino: g("f_comuna_destino") ? comunaCanonica(g("f_comuna_destino")) : "",
    condicion_pago_dias: num("f_condicion_pago_dias") === "" ? pagoDiasPorDefecto(g("f_cliente")) : num("f_condicion_pago_dias")
  };
}
/** Marca en el formulario los campos que faltan. */
function marcarFaltantes(f) {
  document.querySelectorAll("#tarifaModal .campo-falta").forEach(el => el.classList.remove("campo-falta"));
  f.forEach(x => { const el = document.getElementById(x.campo); const caja = el && (el.closest(".tf-campo") || el); if (caja) caja.classList.add("campo-falta"); });
}
