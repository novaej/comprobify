
const tiposComprobante = [
    {
        id: '01',
        nombre: 'FAC',
        descripcion: 'Factura',
    },
    {
        id: '03',
        nombre: 'LIQ',
        descripcion: 'Liquidación de compra de bienes y prestación de servicios',
    },
    {
        id: '04',
        nombre: 'CRE',
        descripcion: 'Nota de crédito',
    },
    {
        id: '05',
        nombre: 'DEB',
        descripcion: 'Nota de débito',
    },
    {
        id: '06',
        nombre: 'REM',
        descripcion: 'Guía de remisión',
    },
    {
        id: '07',
        nombre: 'RET',
        descripcion: 'Comprobante de retención',
    },
];

const tiposEmision = [
    {
        id: '1',
        nombre: 'NRM',
        descripcion: 'Emisión normal',
    },
];


module.exports = {
    tiposComprobante,
    tiposEmision,
}