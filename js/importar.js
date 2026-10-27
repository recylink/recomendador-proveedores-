/* ============================================================
   Importar planilla: carga masiva de tarifas sin Claude.
   - Plantilla estándar (.xlsx) o cualquier planilla con esas columnas (.xlsx, .xls, .csv),
     o filas copiadas desde Excel / Google Sheets (con la fila de encabezados).
   - Una fila = una tarifa; en Residuo, Contenedor, Comuna y Sucursal se pueden poner varios
     separados por ";" (una tarifa por combinación).
   - Si ya existe la misma tarifa (proveedor, empresa, sucursal, residuo, unidad, contenedor y
     tipo) se ACTUALIZA con historial en vez de duplicarla. Reimportar el mismo archivo es seguro.
   - No crea sucursales: una fila con una sucursal que no está registrada para la empresa es un error.
   ============================================================ */

const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const IMP_LOTE = 150; // cambios por llamada al servidor
const IMP_MAX_FILAS_VISTA = 300;

// [campo, encabezado de la plantilla, ayuda, ejemplo]
const IMP_COLUMNAS = [
  ["proveedor", "Proveedor", "Nombre del gestor, como en ClickUp. Obligatorio.", "Demarco"],
  ["empresa", "Empresa", "Cliente. Vacío = valor general del proveedor.", "Sodimac"],
  ["sucursal", "Sucursal", "Nombre registrado en el Recomendador. Varias separadas por ;", "Hc Quilicura"],
  ["estado_servicio", "Estado del servicio", "Activo, Cotizado, No tomado, Terminado o Valor general. Vacío = Cotizado (o Valor general sin empresa).", "Activo"],
  ["residuo", "Residuo", "Del catálogo. Varios separados por ; Obligatorio.", "Domiciliarios"],
  ["tipo_transaccion", "Tipo", "cobra = el cliente paga al proveedor · paga = el proveedor compra el residuo. Vacío = cobra.", "cobra"],
  ["precio", "Precio", "Neto (sin IVA), solo el número.", "57000"],
  ["moneda", "Moneda", "CLP o UF. Vacío = CLP.", "CLP"],
  ["unidad", "Unidad", "kg, ton, m3, viaje, retiro, servicio, mes, unidad…", "viaje"],
  ["tipo_servicio", "Tipo de servicio", "Transporte, Disposición, Transporte + disposición, Arriendo, Compra de material, Peoneta, Servicio de faena o Hidrojet. Obligatorio.", "Transporte"],
  ["contenedor", "Contenedor o vehículo", "Tipo, sin medida (Batea, Tolva, Camión…). Obligatorio si la unidad es viaje o retiro. Varios separados por ;", "Batea"],
  ["volumen_m3", "Volumen m3", "Volumen del contenedor en m³. Obligatorio si la unidad es viaje o retiro.", "30"],
  ["tratamiento", "Tratamiento", "Solo en Disposición, Transporte + disposición o Compra de material: Reciclaje, Disposición autorizada de residuos peligrosos, Coprocesamiento (Valorizado)… Si no está para ese residuo, se agrega. Opcional.", "Disposición final de residuos sólidos domiciliarios y asimilables"],
  ["incluye_destruccion_marca", "Incluye destrucción de marca", "sí / no. Si se cobra aparte, es otra fila con Tipo de servicio = Destrucción de marca. Opcional.", ""],
  ["cantidad_min", "Carga mínima", "Carga mínima para ese precio (opcional).", ""],
  ["cantidad_max", "Carga máxima", "Carga máxima para ese precio (opcional).", ""],
  ["carga_unidad", "Unidad de la carga", "m3, kg, ton, pallet o unidad. Vacío = la unidad del precio.", ""],
  ["direccion", "Dirección", "Donde se retira. No hace falta si la sucursal está registrada.", ""],
  ["comuna", "Comuna", "Comuna de origen. No hace falta si la sucursal está registrada. Varias separadas por ;", ""],
  ["destino", "Destino", "Planta donde termina el residuo (nombre o código RETC).", "Relleno Santa Marta"],
  ["comuna_destino", "Comuna destino", "Opcional por ahora.", "Talagante"],
  ["condicion_pago_dias", "Días de pago", "Condición de pago del cliente. Vacío = 120 para Euro, 30 para el resto.", "30"],
  ["fecha", "Fecha", "AAAA-MM-DD. Vacío = hoy.", "2026-10-16"],
  ["fuente", "Tipo de fuente", "De la lista (hoja Listas): Contratos de clientes, Cotizaciones de proveedores, Boca a boca… Obligatorio.", "Contratos de clientes"],
  ["fuente_ref", "Referencia", "Qué documento o conversación respalda el precio. Opcional.", "Contrato Sodimac 2026"],
  ["motivo_precio", "Motivo del precio", "Precio de lista, Por volumen, Acuerdo marco, Promoción, Licitación, Precio de entrada, Otro o No sé. Obligatorio.", "Acuerdo marco"],
  ["detalle", "Detalle", "Condiciones: recargos, qué incluye…", "Retiro de batea 30 m3"],
  ["vigente_hasta", "Vigente hasta", "AAAA-MM-DD. Vigencia de la cotización; al pasar se avisa \"Cotización vencida\". Opcional.", ""],
  ["por_confirmar", "Por confirmar", "sí si falta confirmar algún dato (baja la confianza). Opcional.", ""],
  ["valor_agregado", "Valor agregado", "CO2 evitado, material recuperado, trazabilidad… Opcional.", ""]
];
// Otros nombres de columna que se aceptan (sin tildes, espacios ni mayúsculas)
const IMP_ALIAS = {
  CLIENTE: "empresa", PROVEEDORNOMBRE: "proveedor", GESTOR: "proveedor", ESTADO: "estado_servicio", ESTADOSERVICIO: "estado_servicio",
  TIPOTRANSACCION: "tipo_transaccion", COBRAPAGA: "tipo_transaccion", TRANSPORTE: "incluye_transporte", DISPOSICION: "incluye_disposicion",
  INCLUYEDISPOSICIONFINAL: "incluye_disposicion", DISPOSICIONFINAL: "incluye_disposicion", CONTENEDOR: "contenedor", VEHICULO: "contenedor",
  PRECIONETO: "precio", VALOR: "precio", MINIMO: "cantidad_min", MAXIMO: "cantidad_max", TIENDA: "sucursal", OBRA: "sucursal", PLANTA: "sucursal",
  OBSERVACIONES: "detalle", CONDICIONES: "detalle", NOTAS: "detalle",
  SERVICIO: "tipo_servicio", TIPOSERVICIO: "tipo_servicio", VOLUMEN: "volumen_m3", VOLUMENM3: "volumen_m3", M3CONTENEDOR: "volumen_m3",
CONDICIONDEPAGO: "condicion_pago_dias", DIASDEPAGO: "condicion_pago_dias", PLAZODEPAGO: "condicion_pago_dias", PLANTA_DESTINO: "destino", PLANTADESTINO: "destino", COMUNADESTINO: "comuna_destino",
  REFERENCIA: "fuente_ref", REFERENCIAFUENTE: "fuente_ref", MOTIVO: "motivo_precio", TIPOFUENTE: "fuente", FUENTE: "fuente",
  TIPODETRATAMIENTO: "tratamiento", TRATAMIENTOS: "tratamiento", DESTRUCCIONDEMARCA: "incluye_destruccion_marca", CANTIDADMINIMA: "cantidad_min", CANTIDADMAXIMA: "cantidad_max",
  VIGENCIA: "vigente_hasta", VIGENTE: "vigente_hasta", PORCONFIRMAR: "por_confirmar", VALORAGREGADO: "valor_agregado",
  INCLUYETRANSPORTE: "incluye_transporte", INCLUYEDISPOSICION: "incluye_disposicion" // planillas anteriores: se deduce el tipo de servicio
};
const IMP_LISTAS = ["residuo", "contenedor", "comuna", "sucursal"];

let IMP = null; // { plan, errores, archivo }

/* ---------------- plantilla ---------------- */
function cargarXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = XLSX_URL;
    s.onload = () => res(window.XLSX);
    s.onerror = () => rej(new Error("No se pudo cargar el lector de Excel. Revisa tu conexión o pega las filas copiadas."));
    document.head.appendChild(s);
  });
}

async function descargarPlantilla() {
  const X = await cargarXlsx();
  const wb = X.utils.book_new();
  const hoja = X.utils.aoa_to_sheet([IMP_COLUMNAS.map(c => c[1]), IMP_COLUMNAS.map(c => c[3])]);
  hoja["!cols"] = IMP_COLUMNAS.map(c => ({ wch: Math.max(12, c[1].length + 2) }));
  X.utils.book_append_sheet(wb, hoja, "Tarifas");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Columna", "Cómo llenarla"]].concat(IMP_COLUMNAS.map(c => [c[1], c[2]])).concat([
    [], ["Reglas", "Una fila = una tarifa. Borra la fila de ejemplo antes de subir."],
    ["", "Si la tarifa ya existe (mismo proveedor, empresa, sucursal, residuo, unidad, contenedor y tipo) se actualiza; no se duplica."],
    ["", "La sucursal debe estar registrada para la empresa: la importación no crea sucursales nuevas."],
    ["", "Un retiro y la disposición con precios distintos son dos filas: una con Tipo de servicio = Transporte y otra con Disposición."],
    ["", "Obligatorios en tarifas nuevas: proveedor, residuo, tipo de servicio, precio, unidad, tipo de fuente, motivo, comuna de origen (o la sucursal), y contenedor + volumen si se cobra por viaje o retiro."]
  ])), "Instrucciones");
  const listas = [["Residuos", "Unidades", "Contenedores", "Estado del servicio", "Tipo de servicio", "Tipo de fuente", "Motivo del precio"]];
  const cols = [CATS.residuo || [], CATS.unidad || [], contenedoresCatalogo(), CATS.estado_servicio || [], TIPOS_SERVICIO, TIPOS_FUENTE, MOTIVOS_PRECIO];
  for (let i = 0; i < Math.max(...cols.map(c => c.length)); i++) listas.push(cols.map(c => c[i] || ""));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(listas), "Listas");
  X.writeFile(wb, "plantilla-tarifas-recomendador.xlsx");
}

/* ---------------- lectura ---------------- */
function campoDeEncabezado(h) {
  const k = norm(h); if (!k) return null;
  const c = IMP_COLUMNAS.find(c => norm(c[0]) === k || norm(c[1]) === k);
  return c ? c[0] : IMP_ALIAS[k] || null;
}

function fechaIso(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const s = String(v == null ? "" : v).trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); // 16/10/2026
  return m ? m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0") : s;
}

/** Filas (con encabezados en la primera fila con Proveedor y Residuo) → líneas de tarifa. */
function filasALineas(filas) {
  const iEnc = filas.findIndex(f => { const c = f.map(campoDeEncabezado); return c.includes("proveedor") && c.includes("residuo"); });
  if (iEnc === -1) throw new Error("No encontré las columnas Proveedor y Residuo. Usa la plantilla, o pásale el archivo a Claude (skill cargar-cotizacion) si tiene otro formato.");
  const campos = filas[iEnc].map(campoDeEncabezado);
  const lineas = [];
  filas.slice(iEnc + 1).forEach((f, i) => {
    if (!f.some(v => String(v == null ? "" : v).trim())) return;
    const l = { _fila: iEnc + i + 2 };
    campos.forEach((c, j) => {
      if (!c) return;
      let v = f[j];
      if (c === "fecha" || c === "vigente_hasta") v = fechaIso(v);
      else if (typeof v !== "number") v = String(v == null ? "" : v).trim();
      if (IMP_LISTAS.includes(c) && /;/.test(v)) v = v.split(";").map(x => x.trim()).filter(Boolean);
      if (v !== "") l[c] = v;
    });
    lineas.push(l);
  });
  if (!lineas.length) throw new Error("La planilla no trae filas con datos bajo los encabezados.");
  return lineas;
}

async function leerArchivoPlanilla(file) {
  const X = await cargarXlsx();
  const wb = X.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  let ultimoError = null;
  for (const nombre of wb.SheetNames) { // la primera hoja que tenga los encabezados
    try { return filasALineas(X.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: "" })); }
    catch (e) { ultimoError = e; }
  }
  throw ultimoError || new Error("El archivo no tiene hojas.");
}

function leerPegado(txt) {
  const s = String(txt || "").trim();
  if (!s) throw new Error("Pega las filas o elige un archivo.");
  if (/^[\[{]/.test(s)) return { tarifas: parsearBloqueClaude(s) }; // también acepta el bloque de Claude
  return { lineas: filasALineas(s.split(/\r?\n/).map(r => r.split("\t"))) };
}

/* ---------------- validación y plan ---------------- */
function validarImportada(d) {
  const e = [];
  if (!d.proveedor_nombre) e.push("falta el proveedor");
  if (!d.residuo) e.push("falta el residuo");
  if (d.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) e.push("fecha inválida (usa AAAA-MM-DD): " + d.fecha);
  if (!["CLP", "UF"].includes(d.moneda)) e.push("moneda inválida: " + d.moneda);
  if (d.precio === null && tget(d, "_precio_txt")) e.push("precio no numérico: " + d._precio_txt);
  if (d.estado_servicio === "Activo" && (!d.cliente || !d.sucursal)) e.push("una tarifa Activa necesita empresa y sucursal");
  if (d._sucursal_nueva) e.push("la sucursal no está registrada para " + d.cliente + " (la importación no crea sucursales: regístrala en Sucursales o corrige el nombre)");
  return e;
}

function claveCarga(t, sinTratamiento) {
  const tipo = String(t.tipo || t.tipo_transaccion || "").toLowerCase() === "paga" ? "paga" : "cobra";
  const prov = tget(t, "proveedor_id") || "n:" + norm(t.proveedor_nombre);
  return [prov, norm(t.cliente), norm(t.sucursal), t.sucursal ? "" : norm(t.comuna) || (t.region ? "r:" + norm(t.region) : ""), norm(t.residuo), norm(t.unidad), contKey(t), tipo].join("|") + (servicioClave(t) ? "|" + servicioClave(t) : "") +
    (sinTratamiento ? "" : "|t:" + norm(tget(t, "tratamiento"))); // el tratamiento separa tarifas (Q7c)
}

const CAMPOS_COMPARAR = ["precio", "moneda", "fecha", "tipo_servicio", "cantidad_min", "cantidad_max", "estado_servicio", "detalle", "direccion", "comuna", "region", "fuente", "pdf_url",
  "volumen_m3", "motivo_precio", "fuente_ref", "destino", "comuna_destino", "condicion_pago_dias",
  "tratamiento", "incluye_destruccion_marca", "carga_unidad", "vigente_hasta", "por_confirmar", "valor_agregado"];

/** Nuevas / se actualizan (solo campos que traen valor y cambian) / iguales, contra las tarifas activas. */
function planificarCarga(lista) {
  const porClave = {}, sinTrat = {};
  const poner = (m, k, t) => { const prev = m[k]; if (!prev || tget(t, "fecha") > tget(prev, "fecha")) m[k] = t; }; // la vigente
  TARIFAS.filter(t => t.activo).forEach(t => {
    poner(porClave, claveCarga(t), t);
    if (!tget(t, "tratamiento")) poner(sinTrat, claveCarga(t, true), t); // las antiguas sin tratamiento se actualizan y lo completan
  });
  const plan = { crear: [], editar: [], iguales: [] }, usadas = {};
  lista.forEach(d => {
    const t = porClave[claveCarga(d)] || (tget(d, "tratamiento") ? sinTrat[claveCarga(d, true)] : null);
    if (!t || usadas[t.id]) { plan.crear.push(d); return; }
    // precio más antiguo que el vigente (llegó después): tarifa propia, que queda como anterior; no pisa la vigente
    if (d.fecha && String(d.fecha).slice(0, 10) < tget(t, "fecha").slice(0, 10)) { d._anterior = t.id; plan.crear.push(d); return; }
    usadas[t.id] = true;
    const cambios = {}, antes = {};
    CAMPOS_COMPARAR.forEach(c => {
      const v = d[c];
      if (v == null || v === "") return;
      const a = c === "precio" ? t.precio_num : c === "cantidad_min" ? t.cantidad_min_num : c === "cantidad_max" ? t.cantidad_max_num : tget(t, c);
      const igual = ["precio", "cantidad_min", "cantidad_max", "volumen_m3", "peso_lleno_kg", "condicion_pago_dias"].includes(c) ? numDe(a) === numDe(v) : String(a ?? "").trim() === String(v).trim();
      if (!igual) { cambios[c] = v; antes[c] = a; }
    });
    if (Object.keys(cambios).length) plan.editar.push({ id: t.id, cambios, antes, d });
    else plan.iguales.push({ id: t.id, d });
  });
  return plan;
}

/** Guarda un plan en lotes. Devuelve { creadas, editadas }. Si un lote falla, los anteriores ya quedaron. */
async function guardarPlan(plan, st, pdfUrl) {
  if (!sesionActiva()) await iniciarSesion();
  // Regla: las cargas masivas no crean sucursales (las de nombre desconocido no se guardan)
  const omitidas = plan.crear.filter(d => d._sucursal_nueva);
  if (omitidas.length && !confirm(omitidas.length + " tarifa(s) tienen una sucursal que no está registrada (" + unicosOrdenados(omitidas.map(d => d.sucursal)).join(", ") + ") y no se guardarán. ¿Continuar con el resto?")) throw new Error("Cancelado.");
  const crear = plan.crear.filter(d => !d._sucursal_nueva).map(d => Object.assign({}, d));
  const incompleta = crear.map(d => ({ d, f: faltantesMinimos(d) })).find(x => x.f.length);
  if (incompleta) throw new Error(textoFaltantes(incompleta.d, incompleta.f) + " Ninguna tarifa se guardó.");
  const editar = plan.editar.map(e => ({ id: e.id, cambios: Object.assign({}, e.cambios) }));
  if (pdfUrl) { crear.forEach(d => { d.pdf_url = pdfUrl; }); editar.forEach(e => { e.cambios.pdf_url = pdfUrl; }); }
  st.textContent = "Revisando catálogos…";
  for (const d of crear) await asegurarCatalogos(d); // solo llama al servidor por valores nuevos
  const ops = editar.map(e => ["editar", e]).concat(crear.map(d => ["crear", d]));
  const filas = [];
  let creadas = 0, editadas = 0;
  for (let i = 0; i < ops.length; i += IMP_LOTE) {
    const parte = ops.slice(i, i + IMP_LOTE);
    st.textContent = "Guardando " + Math.min(i + IMP_LOTE, ops.length) + " de " + ops.length + "…";
    try {
      const r = await api("tarifa_lote", { lote: { crear: parte.filter(x => x[0] === "crear").map(x => x[1]), editar: parte.filter(x => x[0] === "editar").map(x => x[1]), baja: [] } }, true);
      creadas += r.creadas; editadas += r.editadas; filas.push(...(r.tarifas || []));
    } catch (e) {
      await refrescarTrasGuardar(filas);
      throw new Error(e.message + (i ? " — ya quedaron guardados " + i + " cambios; si vuelves a importar, esos se reconocen y no se duplican." : ""));
    }
  }
  await refrescarTrasGuardar(filas);
  return { creadas, editadas };
}

/* ---------------- ventana ---------------- */
function abrirImportar() {
  IMP = null;
  abrirModal("importarModal",
    '<h3>Importar planilla</h3>' +
    '<p class="small">Carga muchas tarifas de una vez. Si una ya existe (mismo proveedor, empresa, sucursal, residuo, unidad, contenedor y tipo) se <b>actualiza</b>; no se duplica.</p>' +
    '<ol class="small imp-pasos">' +
    '<li><button class="lnk" onclick="descargarPlantilla().catch(e => alert(e.message))">Descarga la plantilla</button> (Excel; también sirve copiarla a Google Sheets). Trae las instrucciones y las listas de residuos y unidades.</li>' +
    '<li>Sube el archivo (.xlsx, .xls o .csv) <b>o</b> pega las filas copiadas desde Excel o Google Sheets, con la fila de encabezados.</li>' +
    '</ol>' +
    '<input id="impArchivo" type="file" accept=".xlsx,.xls,.csv">' +
    '<textarea id="impTxt" rows="5" style="width:100%;margin-top:8px;font-family:monospace;font-size:12px" placeholder="…o pega aquí las filas (con encabezados). También acepta el bloque de Claude."></textarea>' +
    '<p class="muted small">¿Un archivo con otro formato (cotización, planilla de un cliente)? Pásaselo a Claude con la skill <b>cargar-cotizacion</b>: lo convierte y lo guarda con tu código de <i>Conectar con Claude</i>.</p>' +
    '<div class="tf-acc"><span id="impStatus" class="muted small"></span><button class="cbtn" onclick="revisarImportacion(this)">Revisar</button></div>' +
    '<div id="impPrev"></div>');
}

async function revisarImportacion(btn) {
  const st = document.getElementById("impStatus"), prev = document.getElementById("impPrev");
  const f = document.getElementById("impArchivo").files[0];
  if (btn) btn.disabled = true;
  st.textContent = "Leyendo…"; prev.innerHTML = "";
  try {
    const leido = f ? { lineas: await leerArchivoPlanilla(f) } : leerPegado(document.getElementById("impTxt").value);
    const lista = leido.tarifas || interpretarLineas({}, leido.lineas.map(l => { const x = Object.assign({}, l); x._precio_txt = typeof l.precio === "number" ? "" : l.precio || ""; return x; }));
    const errores = [], validas = [];
    lista.forEach(d => {
      if (!d.estado_servicio) d.estado_servicio = d.cliente ? "Cotizado" : "Valor general";
      if (!d.fecha) d.fecha = new Date().toISOString().slice(0, 10);
      const e = validarImportada(d);
      if (e.length) errores.push({ d, e }); else validas.push(d);
    });
    const plan = planificarCarga(validas);
    plan.crear = plan.crear.filter(d => {
      const fm = d._sucursal_nueva ? [] : faltantesMinimos(d); // las de sucursal nueva ya se avisan aparte
      if (fm.length) errores.push({ d, e: ["tarifa nueva sin datos obligatorios: " + fm.map(x => x.txt).join(", ")] });
      return !fm.length;
    });
    IMP = { plan, errores, archivo: f ? f.name : "" };
    st.textContent = "";
    prev.innerHTML = vistaImportacionHtml();
  } catch (e) {
    IMP = null; st.textContent = e.message;
  } finally { if (btn) btn.disabled = false; }
}

function vistaImportacionHtml() {
  const { plan, errores } = IMP;
  const total = plan.crear.length + plan.editar.length;
  const sinProv = unicosOrdenados(plan.crear.concat(plan.editar.map(e => e.d)).filter(d => !d.proveedor_id).map(d => d.proveedor_nombre));
  const sucNuevas = unicosOrdenados(plan.crear.filter(d => d._sucursal_nueva).map(d => d.cliente + " · " + d.sucursal));
  const sinPrecio = plan.crear.filter(d => d.precio == null).length;
  const tratNuevos = unicosOrdenados(plan.crear.concat(plan.editar.map(e => e.d)).filter(d => d._tratamiento_nuevo).map(d => d.residuo + " → " + d.tratamiento));
  const fila = (accion, d, e) => {
    let precio = precioHtml(prepararTarifa(Object.assign({ id: "nuevo", activo: "si" }, d)));
    if (e && "precio" in e.cambios) precio = '<span class="muted">' + esc(e.antes.precio == null ? "sin precio" : fmtNum(e.antes.precio)) + ' →</span> ' + precio;
    const otros = e ? Object.keys(e.cambios).filter(c => c !== "precio") : [];
    return '<tr><td><span class="pill imp-' + accion.toLowerCase() + '">' + accion + '</span></td>' +
      '<td>' + esc(d.proveedor_nombre) + (d.proveedor_id ? "" : ' <span class="t-alerta">no está en ClickUp</span>') + '</td>' +
      '<td>' + empresaHtml(d) + (d._sucursal_doc ? '<div class="muted small">en el archivo: ' + esc(d._sucursal_doc) + '</div>' : "") + '</td>' +
      '<td>' + resTag(d.residuo) + '<div class="muted small">' + esc([d.tipo_servicio, d.contenedor, d.tratamiento].filter(Boolean).join(" · ")) + '</div>' + (d._tratamiento_nuevo ? '<div class="small warn">tratamiento nuevo para este residuo: se agregaría</div>' : '') + '</td>' +
      '<td>' + esc(d.comuna || "-") + '</td><td class="num">' + precio + (otros.length ? '<div class="muted small">cambia: ' + esc(otros.join(", ")) + '</div>' : "") + '</td></tr>';
  };
  const filas = plan.editar.map(e => fila("Actualiza", e.d, e)).concat(plan.crear.map(d => fila(d._anterior ? "Anterior" : "Nueva", d)));
  return '<div class="imp-resumen">' +
    '<span class="pill imp-nueva">' + plan.crear.length + ' nuevas</span>' +
    '<span class="pill imp-actualiza">' + plan.editar.length + ' se actualizan</span>' +
    '<span class="pill">' + plan.iguales.length + ' ya estaban iguales</span>' +
    (errores.length ? '<span class="pill imp-error">' + errores.length + ' con error (no se guardan)</span>' : "") + '</div>' +
    (sinProv.length ? '<p class="warn small">No están en ClickUp (se guardan solo con el nombre; crea su ficha después y quedan ligadas): ' + esc(sinProv.join(", ")) + '</p>' : "") +
    (sucNuevas.length ? '<p class="warn small">Sucursales que no están registradas (esas tarifas no se guardan; regístralas en Sucursales o corrige el nombre): ' + esc(sucNuevas.join(", ")) + '</p>' : "") +
    (sinPrecio ? '<p class="warn small">' + sinPrecio + ' tarifa(s) nuevas sin precio.</p>' : "") +
    (tratNuevos.length ? '<p class="warn small">Tratamientos que no están para su residuo y se agregarían: ' + esc(tratNuevos.join(" · ")) + '</p>' : "") +
    (errores.length ? '<details class="small" open><summary class="warn">Filas con error</summary><ul>' + errores.slice(0, 100).map(x => '<li>' + (x.d._fila ? "Fila " + x.d._fila + ": " : "") + esc([x.d.proveedor_nombre, x.d.sucursal, x.d.residuo].filter(Boolean).join(" · ")) + " — " + esc(x.e.join("; ")) + '</li>').join("") + '</ul></details>' : "") +
    (filas.length ? '<div class="tscroll"><table class="ttar"><tr><th></th><th>Proveedor</th><th>Empresa / sucursal</th><th>Servicio</th><th>Comuna</th><th>Precio</th></tr>' + filas.slice(0, IMP_MAX_FILAS_VISTA).join("") + '</table></div>' +
      (filas.length > IMP_MAX_FILAS_VISTA ? '<p class="muted small">Se muestran ' + IMP_MAX_FILAS_VISTA + ' de ' + filas.length + ' filas.</p>' : "") : "") +
    (total ? campo("impPdf", "PDF de respaldo (opcional, se adjunta a todas)", '<input id="impPdf" type="file" accept="application/pdf">', "span2") +
      '<div class="tf-acc"><span id="impStatus2" class="muted small"></span><button class="cbtn" onclick="confirmarImportacion(this)">Guardar ' + total + ' cambio(s)</button></div>'
      : '<p class="small">No hay nada nuevo que guardar.</p>');
}

async function confirmarImportacion(btn) {
  const st = document.getElementById("impStatus2");
  if (!IMP || btn.disabled) return;
  btn.disabled = true;
  try {
    if (!sesionActiva()) await iniciarSesion();
    const url = await subirPdfSiHay("impPdf");
    const r = await guardarPlan(IMP.plan, st, url);
    st.textContent = "Listo: " + r.creadas + " nuevas y " + r.editadas + " actualizadas.";
    IMP = null;
    setTimeout(() => cerrarModal("importarModal"), 1500);
  } catch (e) { st.textContent = "Error: " + e.message; btn.disabled = false; }
}
