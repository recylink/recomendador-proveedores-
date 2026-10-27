/* Comunas de Chile (346) agrupadas por región. Se usa para obtener la región
   a partir de la comuna y para detectar la comuna dentro de una dirección. */
const REGIONES_COMUNAS = {
  "Arica y Parinacota": ["Arica","Camarones","Putre","General Lagos"],
  "Tarapacá": ["Iquique","Alto Hospicio","Pozo Almonte","Camiña","Colchane","Huara","Pica"],
  "Antofagasta": ["Antofagasta","Mejillones","Sierra Gorda","Taltal","Calama","Ollagüe","San Pedro de Atacama","Tocopilla","María Elena"],
  "Atacama": ["Copiapó","Caldera","Tierra Amarilla","Chañaral","Diego de Almagro","Vallenar","Alto del Carmen","Freirina","Huasco"],
  "Coquimbo": ["La Serena","Coquimbo","Andacollo","La Higuera","Paihuano","Vicuña","Illapel","Canela","Los Vilos","Salamanca","Ovalle","Combarbalá","Monte Patria","Punitaqui","Río Hurtado"],
  "Valparaíso": ["Valparaíso","Casablanca","Concón","Juan Fernández","Puchuncaví","Quintero","Viña del Mar","Isla de Pascua","Los Andes","Calle Larga","Rinconada","San Esteban","La Ligua","Cabildo","Papudo","Petorca","Zapallar","Quillota","La Calera","Hijuelas","La Cruz","Nogales","San Antonio","Algarrobo","Cartagena","El Quisco","El Tabo","Santo Domingo","San Felipe","Catemu","Llaillay","Panquehue","Putaendo","Santa María","Quilpué","Limache","Olmué","Villa Alemana"],
  "Metropolitana": ["Santiago","Cerrillos","Cerro Navia","Conchalí","El Bosque","Estación Central","Huechuraba","Independencia","La Cisterna","La Florida","La Granja","La Pintana","La Reina","Las Condes","Lo Barnechea","Lo Espejo","Lo Prado","Macul","Maipú","Ñuñoa","Pedro Aguirre Cerda","Peñalolén","Providencia","Pudahuel","Quilicura","Quinta Normal","Recoleta","Renca","San Joaquín","San Miguel","San Ramón","Vitacura","Puente Alto","Pirque","San José de Maipo","Colina","Lampa","Tiltil","San Bernardo","Buin","Calera de Tango","Paine","Melipilla","Alhué","Curacaví","María Pinto","San Pedro","Talagante","El Monte","Isla de Maipo","Padre Hurtado","Peñaflor"],
  "O'Higgins": ["Rancagua","Codegua","Coinco","Coltauco","Doñihue","Graneros","Las Cabras","Machalí","Malloa","Mostazal","Olivar","Peumo","Pichidegua","Quinta de Tilcoco","Rengo","Requínoa","San Vicente","Pichilemu","La Estrella","Litueche","Marchigüe","Navidad","Paredones","San Fernando","Chépica","Chimbarongo","Lolol","Nancagua","Palmilla","Peralillo","Placilla","Pumanque","Santa Cruz"],
  "Maule": ["Talca","Constitución","Curepto","Empedrado","Maule","Pelarco","Pencahue","Río Claro","San Clemente","San Rafael","Cauquenes","Chanco","Pelluhue","Curicó","Hualañé","Licantén","Molina","Rauco","Romeral","Sagrada Familia","Teno","Vichuquén","Linares","Colbún","Longaví","Parral","Retiro","San Javier","Villa Alegre","Yerbas Buenas"],
  "Ñuble": ["Chillán","Bulnes","Chillán Viejo","El Carmen","Pemuco","Pinto","Quillón","San Ignacio","Yungay","Quirihue","Cobquecura","Coelemu","Ninhue","Portezuelo","Ránquil","Treguaco","San Carlos","Coihueco","Ñiquén","San Fabián","San Nicolás"],
  "Biobío": ["Concepción","Coronel","Chiguayante","Florida","Hualqui","Lota","Penco","San Pedro de la Paz","Santa Juana","Talcahuano","Tomé","Hualpén","Lebu","Arauco","Cañete","Contulmo","Curanilahue","Los Álamos","Tirúa","Los Ángeles","Antuco","Cabrero","Laja","Mulchén","Nacimiento","Negrete","Quilaco","Quilleco","San Rosendo","Santa Bárbara","Tucapel","Yumbel","Alto Biobío"],
  "Araucanía": ["Temuco","Carahue","Cunco","Curarrehue","Freire","Galvarino","Gorbea","Lautaro","Loncoche","Melipeuco","Nueva Imperial","Padre Las Casas","Perquenco","Pitrufquén","Pucón","Saavedra","Teodoro Schmidt","Toltén","Vilcún","Villarrica","Cholchol","Angol","Collipulli","Curacautín","Ercilla","Lonquimay","Los Sauces","Lumaco","Purén","Renaico","Traiguén","Victoria"],
  "Los Ríos": ["Valdivia","Corral","Lanco","Los Lagos","Máfil","Mariquina","Paillaco","Panguipulli","La Unión","Futrono","Lago Ranco","Río Bueno"],
  "Los Lagos": ["Puerto Montt","Calbuco","Cochamó","Fresia","Frutillar","Los Muermos","Llanquihue","Maullín","Puerto Varas","Castro","Ancud","Chonchi","Curaco de Vélez","Dalcahue","Puqueldón","Queilén","Quellón","Quemchi","Quinchao","Osorno","Puerto Octay","Purranque","Puyehue","Río Negro","San Juan de la Costa","San Pablo","Chaitén","Futaleufú","Hualaihué","Palena"],
  "Aysén": ["Coyhaique","Lago Verde","Aysén","Cisnes","Guaitecas","Cochrane","O'Higgins","Tortel","Chile Chico","Río Ibáñez"],
  "Magallanes": ["Punta Arenas","Laguna Blanca","Río Verde","San Gregorio","Cabo de Hornos","Antártica","Porvenir","Primavera","Timaukel","Natales","Torres del Paine"]
};

const _normCom = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// comuna normalizada -> { comuna, region }
const COMUNAS_IDX = (() => {
  const idx = {};
  Object.keys(REGIONES_COMUNAS).forEach(region => {
    REGIONES_COMUNAS[region].forEach(comuna => { idx[_normCom(comuna)] = { comuna, region }; });
  });
  return idx;
})();
const COMUNAS_LISTA = Object.values(COMUNAS_IDX).map(x => x.comuna).sort((a, b) => a.localeCompare(b, "es"));

function regionDeComuna(comuna) {
  const x = COMUNAS_IDX[_normCom(comuna)];
  return x ? x.region : "";
}
function comunaCanonica(comuna) {
  const x = COMUNAS_IDX[_normCom(comuna)];
  return x ? x.comuna : String(comuna || "").trim();
}
const REGIONES = Object.keys(REGIONES_COMUNAS);
/** Nombre oficial de una región escrita libre ("RM", "Región del Bío Bío", "Libertador Gral. Bernardo O'Higgins"); "" si no se reconoce. */
const _normReg = s => _normCom(s).replace(/\b(region|de|del)\b/g, " ").replace(/\s+/g, "");
const REGIONES_ROMANOS = { xv: "Arica y Parinacota", i: "Tarapacá", ii: "Antofagasta", iii: "Atacama", iv: "Coquimbo", v: "Valparaíso", xiii: "Metropolitana",
  vi: "O'Higgins", vii: "Maule", xvi: "Ñuble", viii: "Biobío", ix: "Araucanía", xiv: "Los Ríos", x: "Los Lagos", xi: "Aysén", xii: "Magallanes" };
function regionCanonica(region) {
  const k = _normReg(region);
  if (!k) return "";
  if (k === "rm" || k === "santiago") return "Metropolitana";
  if (REGIONES_ROMANOS[k]) return REGIONES_ROMANOS[k];
  if (k.startsWith("aisen")) return "Aysén";
  // nombre exacto, o el nombre oficial dentro de uno largo ("Libertador General Bernardo O'Higgins", "Metropolitana de Santiago")
  return REGIONES.find(r => _normReg(r) === k) ||
    REGIONES.filter(r => _normReg(r).length >= 4 && k.includes(_normReg(r))).sort((a, b) => b.length - a.length)[0] || "";
}

/* Busca una comuna dentro de una dirección libre. Gana la que termina más al
   final ("Av. Pedro Aguirre Cerda 12968, Cerrillos" -> Cerrillos) y, si terminan
   en el mismo punto, la más larga ("La Florida" y no "Florida"). "" si no hay. */
function detectarComuna(direccion) {
  const t = " " + _normCom(direccion) + " ";
  let mejor = null;
  Object.keys(COMUNAS_IDX).forEach(k => {
    const pos = t.lastIndexOf(" " + k + " ");
    if (pos === -1) return;
    // "Av. Pedro Aguirre Cerda 12968": nombre de calle, no comuna
    if (/(^| )(av|avda|avenida|calle|pasaje|psje|camino|ruta|autopista|costanera)\s*$/.test(t.slice(0, pos))) return;
    const fin = pos + k.length;
    if (!mejor || fin > mejor.fin || (fin === mejor.fin && k.length > mejor.k.length)) mejor = { k, fin };
  });
  return mejor ? COMUNAS_IDX[mejor.k].comuna : "";
}
