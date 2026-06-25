const BaseDocumentBuilder = require('./base.builder');

class CreditNoteBuilder extends BaseDocumentBuilder {
  constructor(issuer) {
    super(issuer, '04', '1.1.0');
  }

  buildInfoNotaCredito(body) {
    const { issueDate, buyer, originalDocument, motivo, items } = body;

    let subtotal = 0;
    const taxTotals = {};

    for (const item of items) {
      const itemTotal = parseFloat(item.quantity) * parseFloat(item.unitPrice) - parseFloat(item.discount || '0');
      subtotal += itemTotal;

      for (const tax of item.taxes) {
        const taxValue = itemTotal * (parseFloat(tax.rate) / 100);
        const key = `${tax.code}-${tax.rateCode}`;
        if (!taxTotals[key]) {
          taxTotals[key] = { codigo: tax.code, codigoPorcentaje: tax.rateCode, baseImponible: 0, valor: 0 };
        }
        taxTotals[key].baseImponible += itemTotal;
        taxTotals[key].valor += taxValue;
      }
    }

    const totalTax = Object.values(taxTotals).reduce((sum, t) => sum + t.valor, 0);
    const grandTotal = subtotal + totalTax;

    this.data.infoNotaCredito = {
      fechaEmision: issueDate,
      ...(this.issuer.branch_address && { dirEstablecimiento: this.issuer.branch_address }),
      tipoIdentificacionComprador: buyer.idType,
      razonSocialComprador: buyer.name,
      identificacionComprador: buyer.id,
      ...(this.issuer.special_taxpayer && { contribuyenteEspecial: this.issuer.special_taxpayer }),
      ...(this.issuer.required_accounting && { obligadoContabilidad: this.issuer.required_accounting }),
      codDocModificado: originalDocument.documentType,
      numDocModificado: originalDocument.number,
      fechaEmisionDocSustento: originalDocument.issueDate,
      totalSinImpuestos: subtotal.toFixed(2),
      valorModificacion: grandTotal.toFixed(2),
      moneda: 'DOLAR',
      totalConImpuestos: {
        totalImpuesto: Object.values(taxTotals).map((t) => ({
          codigo: t.codigo,
          codigoPorcentaje: t.codigoPorcentaje,
          baseImponible: t.baseImponible.toFixed(2),
          valor: t.valor.toFixed(2),
        })),
      },
      motivo,
    };

    this.subtotal = subtotal.toFixed(2);
    this.total = grandTotal.toFixed(2);

    return this;
  }

  // Element names (codigoInterno/codigoAdicional) follow the SRI ficha técnica for
  // notaCredito — confirm against assets/notaCredito_V1.1.0.xsd once available.
  buildDetalles(items) {
    this.data.detalles = {
      detalle: items.map((item) => {
        const itemTotal = parseFloat(item.quantity) * parseFloat(item.unitPrice) - parseFloat(item.discount || '0');
        return {
          codigoInterno: item.mainCode,
          ...(item.auxCode && { codigoAdicional: item.auxCode }),
          descripcion: item.description,
          cantidad: item.quantity,
          precioUnitario: item.unitPrice,
          descuento: item.discount || '0.00',
          precioTotalSinImpuesto: itemTotal.toFixed(2),
          impuestos: {
            impuesto: item.taxes.map((tax) => {
              const taxValue = itemTotal * (parseFloat(tax.rate) / 100);
              return {
                codigo: tax.code,
                codigoPorcentaje: tax.rateCode,
                tarifa: tax.rate,
                baseImponible: itemTotal.toFixed(2),
                valor: taxValue.toFixed(2),
              };
            }),
          },
        };
      }),
    };
    return this;
  }

  buildAdditionalInfo(additionalInfo) {
    if (additionalInfo && additionalInfo.length > 0) {
      this.data.infoAdicional = {
        campoAdicional: additionalInfo.map((info) => ({
          '@': { nombre: info.name },
          '#': info.value,
        })),
      };
    }
    return this;
  }

  build(body, accessKey, sequential) {
    this.buildInfoTributaria({ accessKey, sequential });
    this.buildInfoNotaCredito(body);
    this.buildDetalles(body.items);
    this.buildAdditionalInfo(body.additionalInfo);
    return this.toXml('notaCredito');
  }
}

module.exports = CreditNoteBuilder;
