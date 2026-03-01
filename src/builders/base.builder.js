const js2xmlparser = require('js2xmlparser');

class BaseDocumentBuilder {
  constructor(issuer, documentType) {
    this.issuer = issuer;
    this.documentType = documentType;
    this.data = {};
  }

  buildInfoTributaria({ accessKey, sequential }) {
    this.data.infoTributaria = {
      ambiente: this.issuer.environment,
      tipoEmision: this.issuer.emission_type,
      razonSocial: this.issuer.business_name,
      ...(this.issuer.trade_name && { nombreComercial: this.issuer.trade_name }),
      ruc: this.issuer.ruc,
      claveAcceso: accessKey,
      codDoc: this.documentType,
      estab: this.issuer.branch_code,
      ptoEmi: this.issuer.issue_point_code,
      secuencial: String(sequential).padStart(9, '0'),
      dirMatriz: this.issuer.main_address,
      ...(this.issuer.agent_retention && { agenteRetencion: this.issuer.agent_retention }),
      ...(this.issuer.contribuyente_rimpe && { contribuyenteRimpe: this.issuer.contribuyente_rimpe }),
    };
    return this;
  }

  getXmlAttributes() {
    return {
      '@': {
        id: 'comprobante',
        version: '2.1.0',
      },
    };
  }

  toXml(rootElement) {
    const doc = { ...this.getXmlAttributes(), ...this.data };
    return js2xmlparser.parse(rootElement, doc, {
      declaration: { encoding: 'UTF-8' },
      format: { doubleQuotes: true },
    });
  }
}

module.exports = BaseDocumentBuilder;
