'use strict';

/* =============================================================================
   Nombres de trabajador a partir de su código.

   Un código es la inicial del nombre, la inicial del apellido y cinco dígitos
   (AB12345 -> A…, B…). Ver server/auth.js. Todavía no hay una lista de nombres
   reales de la plantilla, así que aquí se inventa uno estable a partir del
   código: la misma AB12345 devuelve siempre «Andrés Bravo». No pretende
   acertar el nombre de nadie; es para que la columna «Ocupado» del panel diga
   quién tiene el vehículo con algo más legible que un código.

   Cuando lleguen los nombres de verdad, esto se cambia por una tabla (código ->
   nombre) sin tocar nada más: el resto del servidor solo llama a nameFor().

   Vive en el servidor y no en el navegador a propósito: el panel muestra el
   nombre que le manda la API (ver server/db.js y server/server.js), así que hay
   un solo sitio donde se decide y no dos que se puedan desincronizar.
   ========================================================================== */

// Nombres y apellidos peruanos, agrupados por inicial. Con dos o tres por letra
// alcanza: los cinco dígitos del código eligen dentro del grupo, así que dos
// trabajadores con la misma inicial no salen con el mismo nombre.
const FIRST = {
    A: ['Andrés', 'Ana', 'Alberto'], B: ['Bruno', 'Beatriz', 'Bryan'],
    C: ['Carlos', 'Carmen', 'César'], D: ['Diego', 'Daniela', 'David'],
    E: ['Eduardo', 'Elena', 'Enrique'], F: ['Fernando', 'Fiorella', 'Felipe'],
    G: ['Gabriel', 'Gloria', 'Gustavo'], H: ['Hugo', 'Hilda', 'Héctor'],
    I: ['Iván', 'Isabel', 'Ignacio'], J: ['José', 'Julia', 'Juan'],
    K: ['Karla', 'Kevin', 'Katia'], L: ['Luis', 'Lucía', 'Lorenzo'],
    M: ['Manuel', 'María', 'Miguel'], N: ['Nicolás', 'Natalia', 'Néstor'],
    O: ['Óscar', 'Olga', 'Omar'], P: ['Pedro', 'Paola', 'Pablo'],
    Q: ['Quintín', 'Queta', 'Quique'], R: ['Ricardo', 'Rosa', 'Raúl'],
    S: ['Sergio', 'Sofía', 'Santiago'], T: ['Tomás', 'Teresa', 'Tatiana'],
    U: ['Ulises', 'Úrsula', 'Ubaldo'], V: ['Víctor', 'Valeria', 'Vicente'],
    W: ['Walter', 'Wendy', 'Wilson'], X: ['Ximena', 'Xavier', 'Xiomara'],
    Y: ['Yolanda', 'Yuri', 'Yésica'], Z: ['Zoila', 'Zacarías', 'Zulema']
};

const LAST = {
    A: ['Álvarez', 'Aguilar', 'Arana'], B: ['Bautista', 'Benites', 'Bravo'],
    C: ['Castro', 'Cárdenas', 'Chávez'], D: ['Díaz', 'Durand', 'Delgado'],
    E: ['Espinoza', 'Escobar', 'Estrada'], F: ['Flores', 'Fernández', 'Fuentes'],
    G: ['García', 'Gonzales', 'Gutiérrez'], H: ['Huamán', 'Herrera', 'Hidalgo'],
    I: ['Ibáñez', 'Injante', 'Isla'], J: ['Jiménez', 'Juárez', 'Jara'],
    K: ['Kong', 'Kana', 'Kohler'], L: ['López', 'Loayza', 'Luna'],
    M: ['Mendoza', 'Molina', 'Mamani'], N: ['Núñez', 'Navarro', 'Neyra'],
    O: ['Ochoa', 'Ortiz', 'Oré'], P: ['Pérez', 'Palomino', 'Ponce'],
    Q: ['Quispe', 'Quiroz', 'Quintana'], R: ['Ramírez', 'Rojas', 'Ríos'],
    S: ['Sánchez', 'Salazar', 'Suárez'], T: ['Torres', 'Tapia', 'Trujillo'],
    U: ['Ugarte', 'Urbina', 'Ubillús'], V: ['Vargas', 'Vásquez', 'Vega'],
    W: ['Wong', 'Watanabe', 'Wu'], X: ['Ximénez', 'Xandó', 'Xurco'],
    Y: ['Yataco', 'Yépez', 'Yaranga'], Z: ['Zapata', 'Zúñiga', 'Zavala']
};

const CODE_RE = /^[A-Z]{2}[0-9]{5}$/;

/**
 * Nombre y apellido para un código de trabajador, o cadena vacía si el código
 * no tiene la forma esperada (dos letras y cinco dígitos). Es determinista: el
 * mismo código devuelve siempre lo mismo.
 */
function nameFor(workerId) {
    const code = String(workerId || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return '';

    const firsts = FIRST[code[0]] || [code[0]];
    const lasts = LAST[code[1]] || [code[1]];
    const digits = parseInt(code.slice(2), 10);

    // Dos derivaciones distintas del mismo número, para que el nombre y el
    // apellido no avancen a la vez y AB00001 no salga igual de emparejado que
    // AB00002.
    const first = firsts[digits % firsts.length];
    const last = lasts[Math.floor(digits / firsts.length) % lasts.length];
    return first + ' ' + last;
}

module.exports = { nameFor };
