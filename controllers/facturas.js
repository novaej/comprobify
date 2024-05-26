const { response, request } = require('express');
const moment = require('moment');
var js2xmlparser = require("js2xmlparser");

const { tiposComprobante, tiposEmision } = require('../db/catalogos');
const { generarClaveAcceso, leerSecuencialesComprobantes, guardarNuevoSecuencial, leerFactura, sign } = require('../helpers');
const { P12S } = require('../cert/certs');


const ruc = process.env.RUC || '';
const tipoComprobante = tiposComprobante.filter(tipo => tipo.nombre === 'FAC')[0].id || '00';
const tipoEmision = tiposEmision.filter(tipo => tipo.nombre === 'NRM')[0].id || '0';
const ambiente = process.env.ENVIRONMENT || '1';
const establecimiento = process.env.ESTABLECIMIENTO || '';
const puntoEmision = process.env.PUNTO_EMISION || '';


const facturaGet = async (req = request, res = response) => {

    const fechaEmision = moment();

    // Obtener secuencial comprobante
    const secuencialesComprobantes = leerSecuencialesComprobantes();
    const secuencialActual = secuencialesComprobantes
        .filter(sec => sec.establecimiento === establecimiento && sec.puntoEmision === puntoEmision)[0].secuencial || 0;
    const nuevoSecuencial = secuencialActual + 1; // '0009'
    const numeroFactura = `${establecimiento}${puntoEmision}${String(nuevoSecuencial).padStart(9, '0')}`;

    secuencialesComprobantes.forEach(sec => {
        if (sec.establecimiento === establecimiento && sec.puntoEmision === puntoEmision) {
            sec.secuencial = nuevoSecuencial;
        }
    });

    // Actualizar último secuencial
    guardarNuevoSecuencial(secuencialesComprobantes);

    const codigoNumerico = String(nuevoSecuencial).padStart(8, '0');

    // Generar clave de acceso
    const claveAcceso = await generarClaveAcceso(fechaEmision, ruc, tipoComprobante, ambiente, tipoEmision, numeroFactura, codigoNumerico);

    // Generar XML Factura desde JSON
    const facturaJson = leerFactura();
    facturaJson.infoTributaria = {
        "ambiente": ambiente,
        "tipoEmision": tipoEmision,
        "razonSocial": "JONATHAN ANDRES PILLAJO COKA",
        "nombreComercial": "JONATHAN PILLAJO",
        "ruc": ruc,
        "claveAcceso": claveAcceso,
        "codDoc": tipoComprobante,
        "estab": establecimiento,
        "ptoEmi": puntoEmision,
        "secuencial": nuevoSecuencial,
        "dirMatriz": "QUITO",
    };

    facturaJson.infoFactura = {
        "fechaEmision": fechaEmision.format('DD/MM/yyyy'),
        "dirEstablecimiento": "SANTIAGO Y SANTIAGO",
        // "contribuyenteEspecial": "contribuyente",
        // "obligadoContabilidad": "SI",
        // "comercioExterior": "EXPORTADOR",
        // "incoTermFactura": "A",
        // "lugarIncoTerm": "lugarIncoTerm0",
        // "paisOrigen": "000",
        // "puertoEmbarque": "puertoEmbarque0",
        // "puertoDestino": "puertoDestino0",
        // "paisDestino": "000",
        // "paisAdquisicion": "000",
        "tipoIdentificacionComprador": "04",
        // "guiaRemision": "000-000-000000000",
        "razonSocialComprador": "PRUEBAS SERVICIO DE RENTAS INTERNA",
        "identificacionComprador": "xxxxxxxxxx001",
        "direccionComprador": "SANTIAGO Y SANTIAGO",
        "totalSinImpuestos": "1428.57",
        // "totalSubsidio": "50.00",
        // "incoTermTotalSinImpuestos": "A",
        "totalDescuento": "0.00",
        // "codDocReembolso": "00",
        // "totalComprobantesReembolso": "50.00",
        // "totalBaseImponibleReembolso": "50.00",
        // "totalImpuestoReembolso": "50.00",
        "totalConImpuestos": {
            "totalImpuesto": [
                {
                    "codigo": "2",
                    "codigoPorcentaje": "2",
                    // "descuentoAdicional": "0.00",
                    "baseImponible": "1428.57",
                    // "tarifa": "49.50",
                    "valor": "171.43",
                    // "valorDevolucionIva": "50.00"
                }
            ]
        },
        // "compensaciones": {
        //     "compensacion": [
        //         {
        //             "codigo": "1",
        //             "tarifa": "49.50",
        //             "valor": "50.00"
        //         },
        //         {
        //             "codigo": "1",
        //             "tarifa": "49.50",
        //             "valor": "50.00"
        //         }
        //     ]
        // },
        "propina": "0.00",
        // "fleteInternacional": "50.00",
        // "seguroInternacional": "50.00",
        // "gastosAduaneros": "50.00",
        // "gastosTransporteOtros": "50.00",
        "importeTotal": "1600.00",
        "moneda": "DOLAR",
        // "placa": "placa0",
        "pagos": {
            "pago": [
                {
                    "formaPago": "20",
                    "total": "1600.00",
                    // "plazo": "50.00",
                    // "unidadTiempo": "unidadTiem"
                },
                // {
                //     "formaPago": "01",
                //     "total": "50.00",
                //     "plazo": "50.00",
                //     "unidadTiempo": "unidadTiem"
                // }
            ]
        },
        "valorRetIva": "0.00",
        "valorRetRenta": "0.00"
    };

    facturaJson.detalles = {
        "detalle": [
            {
                "codigoPrincipal": "001",
                // "codigoAuxiliar": "codigoAuxiliar0",
                "descripcion": "SERVICIOS PROFESIONALES",
                // "unidadMedida": "unidadMedida0",
                "cantidad": "1",
                "precioUnitario": "1428.57",
                // "precioSinSubsidio": "50.000000",
                // "descuento": "50.00",
                "precioTotalSinImpuesto": "1428.57",
                // "detallesAdicionales": {
                //     "detAdicional": [
                //         {
                //             "@": {
                //                 "nombre": "nombre0",
                //                 "valor": "valor0"
                //             }
                //         },
                //         {
                //             "@": {
                //                 "nombre": "nombre1",
                //                 "valor": "valor1"
                //             }
                //         }
                //     ]
                // },
                "impuestos": {
                    "impuesto": [
                        {
                            "codigo": "2",
                            "codigoPorcentaje": "2",
                            "tarifa": "12.00",
                            "baseImponible": "1428.57",
                            "valor": "171.43"
                        },
                    ]
                }
            },
        ]
    };

    delete facturaJson['reembolsos'];
    delete facturaJson['retenciones'];
    delete facturaJson['infoSustitutivaGuiaRemision'];
    delete facturaJson['otrosRubrosTerceros'];
    delete facturaJson['tipoNegociable'];
    delete facturaJson['maquinaFiscal'];
    delete facturaJson['infoAdicional'];

    const facturaXml = js2xmlparser.parse("factura", facturaJson, { declaration: { encoding: 'UTF-8' } });
    // console.log(facturaXml)

    let signatures = '';
    P12S.forEach( (element) => {
        try {
            signatures +=  sign(`cert/${element.filename}`, element.password, facturaXml);

        } catch (error) {
            console.error(error);
        }
    });

    // res.json(facturaXml);

    const facturaFirmada = signatures.toString();
    // const facturaFirmada = facturaXml + signatures
    res.send(facturaFirmada);
}


module.exports = {
    facturaGet,
}