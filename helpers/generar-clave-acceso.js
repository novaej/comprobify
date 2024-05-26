
const generarClaveAcceso = (fechaEmision, ruc, tipoComprobante, ambiente, tipoEmision, numeroFactura, codigoNumerico) => {

    /** Generar clave de acceso de acuerdo a validaciones de SRI
     * 
     * Descripción de campo     ====== Tipo de campo        ====== Longitud
     * 
     * Fecha de emisión         ====== ddmmaaaa             ====== 8
     * Tipo de comprobante      ====== "Tabla 3"            ====== 2
     * Número de RUC            ====== 1234567890001        ====== 13
     * Tipo de ambiente         ====== "Tabla 4"            ====== 1
     * Serie                    ====== 001001               ====== 6
     * Número del comprobante   ====== 000000001            ====== 9
     * (secuencial) 
     * Código numérico          ====== Numérico(Emisor)     ====== 8
     * Tipo de emisión          ====== "Tabla 2"            ====== 1
     * Dígito verificador       ====== Numérico             ====== 1
     * (módulo 11) 
     * 
     */

    const tieneRuc = ruc.length > 0;
    const tieneTipoComprobante = tipoComprobante !== '00';
    const tieneTipoEmision = tipoEmision !== '0';

    fechaEmision = fechaEmision.format('DDMMyyyy');

    return new Promise((resolve, reject) => {

        if (!tieneRuc || !tieneTipoComprobante || !tieneTipoEmision) {
            reject('No se pudo generar la clave de acceso');
        } else {

            let claveAcceso = `${fechaEmision}${tipoComprobante}${ruc}${ambiente}${numeroFactura}${codigoNumerico}${tipoEmision}`;

            const digitoVerificador = generarDigitoModulo11(claveAcceso);

            // claveAcceso = `${fechaEmision}-${tipoComprobante}-${ruc}-${ambiente}-${numeroFactura}-${codigoNumerico}-${tipoEmision}-${digitoVerificador}`;
            claveAcceso = `${fechaEmision}${tipoComprobante}${ruc}${ambiente}${numeroFactura}${codigoNumerico}${tipoEmision}${digitoVerificador}`;

            resolve(claveAcceso);
        }
    });
}

const generarDigitoModulo11 = (claveAcceso = '', factor = 2) => {
    const arregloDigitos = claveAcceso.split('');
    let contFactor = factor;
    let sum = 0;

    for (i = arregloDigitos.length - 1; i >= 0; i--) {
        if (contFactor <= 7) {
            sum += arregloDigitos[i] * contFactor;
            contFactor++;
        } else {
            contFactor = factor;
        }
    }

    const mod11 = sum % 11;
    const resta = 11 - mod11;

    return resta === 11 ? 0 : resta === 10 ? 1 : resta;
}


module.exports = {
    generarClaveAcceso
}