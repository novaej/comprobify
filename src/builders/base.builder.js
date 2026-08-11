const js2xmlparser = require('js2xmlparser');
const config = require('../config');

class BaseDocumentBuilder {
  constructor(issuer, documentType, schemaVersion) {
    this.issuer = issuer;
    this.documentType = documentType;
    this.schemaVersion = schemaVersion;
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

  // SRI Resolution NAC-DGERCGC26-00000027 requires every electronic document
  // issued through a third-party invoicing system to identify that provider's
  // RUC in infoAdicional. Comprobify is not incorporated, so config.operator
  // holds the operator's own persona natural RUC/name.
  buildAdditionalInfo(additionalInfo) {
    const campoAdicional = (additionalInfo || []).map((info) => ({
      '@': { nombre: info.name },
      '#': info.value,
    }));

    campoAdicional.push({
      '@': { nombre: 'RUC Proveedor' },
      '#': config.operator.ruc,
    });

    this.data.infoAdicional = { campoAdicional };
    return this;
  }

  getXmlAttributes() {
    return {
      '@': {
        id: 'comprobante',
        version: this.schemaVersion,
      },
    };
  }

  toXml(rootElement) {
    const doc = { ...this.getXmlAttributes(), ...this.data };
    return js2xmlparser.parse(rootElement, doc, {
      declaration: { encoding: 'UTF-8' },
      format: { doubleQuotes: true },
      // signer.js hashes the raw serialized string instead of running real XML
      // C14N (see its own doc comment) — but C14N always expands a self-closing
      // empty element (<foo/>) to the open/close form (<foo></foo>) when SRI
      // recomputes the digest to verify. Left at js2xmlparser's default, any
      // attribute-only element (e.g. detAdicional) is signed in one tag form
      // but verified against the other, so the signature never matches.
      useSelfClosingTagIfEmpty: false,
    });
  }
}

module.exports = BaseDocumentBuilder;
