
const manejoData = require('./manejo-data');
const generarClaveAcceso = require('./generar-clave-acceso');
const firmar = require('./firmar');

module.exports = {
    ...manejoData,
    ...generarClaveAcceso,
    ...firmar,
}