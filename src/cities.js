(function (global) {
    "use strict";

    var PERU_DEPARTMENTS = {
        "Amazonas": ["Bagua", "Bongará", "Chachapoyas", "Condorcanqui", "Luya", "Rodríguez de Mendoza", "Utcubamba"],
        "Áncash": ["Aija", "Antonio Raymondi", "Asunción", "Bolognesi", "Carhuaz", "Carlos Fermín Fitzcarrald", "Casma", "Corongo", "Huaraz", "Huari", "Huarmey", "Huaylas", "Mariscal Luzuriaga", "Ocros", "Pallasca", "Pomabamba", "Recuay", "Santa", "Sihuas", "Yungay"],
        "Apurímac": ["Abancay", "Andahuaylas", "Antabamba", "Aymaraes", "Chincheros", "Cotabambas", "Grau"],
        "Arequipa": ["Arequipa", "Camaná", "Caravelí", "Castilla", "Caylloma", "Condesuyos", "Islay", "La Unión"],
        "Ayacucho": ["Cangallo", "Huamanga", "Huanca Sancos", "Huanta", "La Mar", "Lucanas", "Parinacochas", "Páucar del Sara Sara", "Sucre", "Víctor Fajardo", "Vilcas Huamán"],
        "Cajamarca": ["Cajabamba", "Cajamarca", "Celendín", "Chota", "Contumazá", "Cutervo", "Hualgayoc", "Jaén", "San Ignacio", "San Marcos", "San Miguel", "San Pablo", "Santa Cruz"],
        "Callao": ["Callao"],
        "Cusco": ["Acomayo", "Anta", "Calca", "Canas", "Canchis", "Chumbivilcas", "Cusco", "Espinar", "La Convención", "Paruro", "Paucartambo", "Quispicanchi", "Urubamba"],
        "Huancavelica": ["Acobamba", "Angaraes", "Castrovirreyna", "Churcampa", "Huancavelica", "Huaytará", "Tayacaja"],
        "Huánuco": ["Ambo", "Dos de Mayo", "Huacaybamba", "Huamalíes", "Huánuco", "Lauricocha", "Leoncio Prado", "Marañón", "Pachitea", "Puerto Inca", "Yarowilca"],
        "Ica": ["Chincha", "Ica", "Nazca", "Palpa", "Pisco"],
        "Junín": ["Chanchamayo", "Chupaca", "Concepción", "Huancayo", "Jauja", "Junín", "Satipo", "Tarma", "Yauli"],
        "La Libertad": ["Ascope", "Bolívar", "Chepén", "Gran Chimú", "Julcán", "Otuzco", "Pacasmayo", "Pataz", "Sánchez Carrión", "Santiago de Chuco", "Trujillo", "Virú"],
        "Lambayeque": ["Chiclayo", "Ferreñafe", "Lambayeque"],
        "Lima": ["Barranca", "Cajatambo", "Cañete", "Canta", "Huaral", "Huarochirí", "Huaura", "Lima", "Oyón", "Yauyos"],
        "Loreto": ["Alto Amazonas", "Datem del Marañón", "Loreto", "Mariscal Ramón Castilla", "Maynas", "Putumayo", "Requena", "Ucayali"],
        "Madre de Dios": ["Manu", "Tahuamanu", "Tambopata"],
        "Moquegua": ["General Sánchez Cerro", "Ilo", "Mariscal Nieto"],
        "Pasco": ["Daniel Alcides Carrión", "Oxapampa", "Pasco"],
        "Piura": ["Ayabaca", "Huancabamba", "Morropón", "Paita", "Piura", "Sechura", "Sullana", "Talara"],
        "Puno": ["Azángaro", "Carabaya", "Chucuíto", "El Collao", "Huancané", "Lampa", "Melgar", "Moho", "Puno", "San Antonio de Putina", "San Román", "Sandia", "Yunguyo"],
        "San Martín": ["Bellavista", "El Dorado", "Huallaga", "Lamas", "Mariscal Cáceres", "Moyobamba", "Picota", "Rioja", "San Martín", "Tocache"],
        "Tacna": ["Candarave", "Jorge Basadre", "Tacna", "Tarata"],
        "Tumbes": ["Contralmirante Villar", "Tumbes", "Zarumilla"],
        "Ucayali": ["Atalaya", "Coronel Portillo", "Padre Abad", "Purús"]
    };

    global.PERU_DEPARTMENTS = PERU_DEPARTMENTS;
})(window);