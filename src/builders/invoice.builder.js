const BaseDocumentBuilder = require('./base.builder');

class InvoiceBuilder extends BaseDocumentBuilder {
  constructor(issuer) {
    super(issuer, '01');
  }

  buildInfoFactura(body) {
    const { issueDate, buyer, items, payments } = body;

    // Calculate totals from items
    let subtotal = 0;
    const taxTotals = {};

    for (const item of items) {
      const itemTotal = parseFloat(item.quantity) * parseFloat(item.unitPrice) - parseFloat(item.discount || '0');
      subtotal += itemTotal;

      for (const tax of item.taxes) {
        const key = `${tax.code}-${tax.rateCode}`;
        if (!taxTotals[key]) {
          taxTotals[key] = { codigo: tax.code, codigoPorcentaje: tax.rateCode, baseImponible: 0, valor: 0 };
        }
        taxTotals[key].baseImponible += parseFloat(tax.taxBase);
        taxTotals[key].valor += parseFloat(tax.value);
      }
    }

    const totalTax = Object.values(taxTotals).reduce((sum, t) => sum + t.valor, 0);
    const totalDiscount = items.reduce((sum, i) => sum + parseFloat(i.discount || '0'), 0);
    const grandTotal = subtotal + totalTax;

    this.data.infoFactura = {
      fechaEmision: issueDate,
      ...(this.issuer.branch_address && { dirEstablecimiento: this.issuer.branch_address }),
      ...(this.issuer.special_taxpayer && { contribuyenteEspecial: this.issuer.special_taxpayer }),
      ...(this.issuer.required_accounting && { obligadoContabilidad: this.issuer.required_accounting }),
      tipoIdentificacionComprador: buyer.idType,
      razonSocialComprador: buyer.name,
      identificacionComprador: buyer.id,
      ...(buyer.address && { direccionComprador: buyer.address }),
      totalSinImpuestos: subtotal.toFixed(2),
      totalDescuento: totalDiscount.toFixed(2),
      totalConImpuestos: {
        totalImpuesto: Object.values(taxTotals).map((t) => ({
          codigo: t.codigo,
          codigoPorcentaje: t.codigoPorcentaje,
          baseImponible: t.baseImponible.toFixed(2),
          valor: t.valor.toFixed(2),
        })),
      },
      propina: '0.00',
      importeTotal: grandTotal.toFixed(2),
      moneda: 'DOLAR',
      pagos: {
        pago: payments.map((p) => ({
          formaPago: p.method,
          total: p.total,
        })),
      },
    };

    this.subtotal = subtotal.toFixed(2);
    this.total = grandTotal.toFixed(2);

    return this;
  }

  buildDetalles(items) {
    this.data.detalles = {
      detalle: items.map((item) => {
        const itemTotal = parseFloat(item.quantity) * parseFloat(item.unitPrice) - parseFloat(item.discount || '0');
        return {
          codigoPrincipal: item.mainCode,
          ...(item.auxCode && { codigoAuxiliar: item.auxCode }),
          descripcion: item.description,
          cantidad: item.quantity,
          precioUnitario: item.unitPrice,
          descuento: item.discount || '0.00',
          precioTotalSinImpuesto: itemTotal.toFixed(2),
          impuestos: {
            impuesto: item.taxes.map((tax) => ({
              codigo: tax.code,
              codigoPorcentaje: tax.rateCode,
              tarifa: tax.rate,
              baseImponible: tax.taxBase,
              valor: tax.value,
            })),
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
    this.buildInfoFactura(body);
    this.buildDetalles(body.items);
    this.buildAdditionalInfo(body.additionalInfo);
    return this.toXml('factura');
  }
}

module.exports = InvoiceBuilder;
