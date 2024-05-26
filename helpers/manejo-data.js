const fs = require('fs');

const dbPathSecuencialesComprobantes = './db/secuencialesComprobantes.json';
const dbPathFactura = './db/factura.json';


const guardarNuevoSecuencial = (payload) => {

    fs.writeFileSync(dbPathSecuencialesComprobantes, JSON.stringify(payload));
}

const leerSecuencialesComprobantes = () => {
    if (!fs.existsSync(dbPathSecuencialesComprobantes)) return;

    const info = fs.readFileSync(dbPathSecuencialesComprobantes, { encoding: 'utf-8' });
    const data = JSON.parse(info);

    return data;
}

const leerFactura = () => {
    if (!fs.existsSync(dbPathFactura)) return;

    const info = fs.readFileSync(dbPathFactura, { encoding: 'utf-8' });
    const data = JSON.parse(info);

    return data;
}

module.exports = {
    leerSecuencialesComprobantes,
    guardarNuevoSecuencial,
    leerFactura
}