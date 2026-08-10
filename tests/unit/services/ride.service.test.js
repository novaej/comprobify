jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/catalog.model');
jest.mock('../../../helpers/ride-builder');

const documentModel = require('../../../src/models/document.model');
const issuerModel = require('../../../src/models/issuer.model');
const catalogModel = require('../../../src/models/catalog.model');
const rideBuilder = require('../../../helpers/ride-builder');
const config = require('../../../src/config');
const DocumentStatus = require('../../../src/constants/document-status');
const rideService = require('../../../src/services/ride.service');

// Builds a minimal, well-formed <factura> XML string (the shape stored in
// documents.authorization_xml/signed_xml) so tests exercise the real parse path
// instead of mocking it away.
function buildInvoiceXml({
  ruc = '1234567890001',
  businessName = 'Acme SA',
  tradeName = 'Acme',
  mainAddress = 'Av. Principal',
  branchAddress = 'Sucursal Norte',
  branchCode = '001',
  issuePointCode = '001',
  emissionType = '1',
  environment = '1',
  accessKey = '1'.repeat(49),
  sequential = '000000005',
  buyerIdType = '05',
  buyerName = 'John Doe',
  buyerId = '0999999999',
  subtotal = '100.00',
  total = '115.00',
  propina = '0.00',
  items = [{
    mainCode: '001', description: 'Item', quantity: '1', unitPrice: '100.00', discount: '0.00',
    taxes: [{ code: '2', rateCode: '4', rate: '15' }],
  }],
  payments = [{ method: '01', total: '115.00' }],
  additionalInfo = [{ name: 'RUC Proveedor', value: '1715824775001' }],
} = {}) {
  const detalleXml = items.map((it) => `
    <detalle>
      <codigoPrincipal>${it.mainCode}</codigoPrincipal>
      <descripcion>${it.description}</descripcion>
      <cantidad>${it.quantity}</cantidad>
      <precioUnitario>${it.unitPrice}</precioUnitario>
      <descuento>${it.discount}</descuento>
      <precioTotalSinImpuesto>${it.unitPrice}</precioTotalSinImpuesto>
      <impuestos>${it.taxes.map((t) => `
        <impuesto>
          <codigo>${t.code}</codigo>
          <codigoPorcentaje>${t.rateCode}</codigoPorcentaje>
          <tarifa>${t.rate}</tarifa>
          <baseImponible>${it.unitPrice}</baseImponible>
          <valor>0.00</valor>
        </impuesto>`).join('')}
      </impuestos>
    </detalle>`).join('');

  const pagosXml = payments.map((p) => `
    <pago>
      <formaPago>${p.method}</formaPago>
      <total>${p.total}</total>
      ${p.term !== undefined ? `<plazo>${p.term}</plazo>` : ''}
      ${p.termUnit ? `<unidadTiempo>${p.termUnit}</unidadTiempo>` : ''}
    </pago>`).join('');

  const additionalInfoXml = additionalInfo
    .map((a) => `<campoAdicional nombre="${a.name}">${a.value}</campoAdicional>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="2.1.0">
  <infoTributaria>
    <ambiente>${environment}</ambiente>
    <tipoEmision>${emissionType}</tipoEmision>
    <razonSocial>${businessName}</razonSocial>
    <nombreComercial>${tradeName}</nombreComercial>
    <ruc>${ruc}</ruc>
    <claveAcceso>${accessKey}</claveAcceso>
    <codDoc>01</codDoc>
    <estab>${branchCode}</estab>
    <ptoEmi>${issuePointCode}</ptoEmi>
    <secuencial>${sequential}</secuencial>
    <dirMatriz>${mainAddress}</dirMatriz>
  </infoTributaria>
  <infoFactura>
    <fechaEmision>01/06/2026</fechaEmision>
    ${branchAddress ? `<dirEstablecimiento>${branchAddress}</dirEstablecimiento>` : ''}
    <obligadoContabilidad>NO</obligadoContabilidad>
    <tipoIdentificacionComprador>${buyerIdType}</tipoIdentificacionComprador>
    <razonSocialComprador>${buyerName}</razonSocialComprador>
    <identificacionComprador>${buyerId}</identificacionComprador>
    <totalSinImpuestos>${subtotal}</totalSinImpuestos>
    <totalDescuento>0.00</totalDescuento>
    <propina>${propina}</propina>
    <importeTotal>${total}</importeTotal>
    <moneda>DOLAR</moneda>
    <pagos>${pagosXml}</pagos>
  </infoFactura>
  <detalles>${detalleXml}</detalles>
  <infoAdicional>${additionalInfoXml}</infoAdicional>
</factura>`;
}

function buildCreditNoteXml({
  ruc = '1234567890001',
  businessName = 'Acme SA',
  accessKey = '2'.repeat(49),
  sequential = '000000009',
  buyerIdType = '05',
  buyerName = 'John Doe',
  buyerId = '0999999999',
  subtotal = '100.00',
  total = '115.00',
  originalDocument = { documentType: '01', number: '001-001-000000005', issueDate: '01/06/2026' },
  motivo = 'Devolución de mercadería',
  items = [{
    mainCode: '001', description: 'Item', quantity: '1', unitPrice: '100.00', discount: '0.00',
    taxes: [{ code: '2', rateCode: '4', rate: '15' }],
  }],
} = {}) {
  const detalleXml = items.map((it) => `
    <detalle>
      <codigoInterno>${it.mainCode}</codigoInterno>
      <descripcion>${it.description}</descripcion>
      <cantidad>${it.quantity}</cantidad>
      <precioUnitario>${it.unitPrice}</precioUnitario>
      <descuento>${it.discount}</descuento>
      <precioTotalSinImpuesto>${it.unitPrice}</precioTotalSinImpuesto>
      <impuestos>${it.taxes.map((t) => `
        <impuesto>
          <codigo>${t.code}</codigo>
          <codigoPorcentaje>${t.rateCode}</codigoPorcentaje>
          <tarifa>${t.rate}</tarifa>
          <baseImponible>${it.unitPrice}</baseImponible>
          <valor>0.00</valor>
        </impuesto>`).join('')}
      </impuestos>
    </detalle>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<notaCredito id="comprobante" version="1.1.0">
  <infoTributaria>
    <ambiente>1</ambiente>
    <tipoEmision>1</tipoEmision>
    <razonSocial>${businessName}</razonSocial>
    <ruc>${ruc}</ruc>
    <claveAcceso>${accessKey}</claveAcceso>
    <codDoc>04</codDoc>
    <estab>001</estab>
    <ptoEmi>001</ptoEmi>
    <secuencial>${sequential}</secuencial>
    <dirMatriz>Av. Principal</dirMatriz>
  </infoTributaria>
  <infoNotaCredito>
    <fechaEmision>01/06/2026</fechaEmision>
    <tipoIdentificacionComprador>${buyerIdType}</tipoIdentificacionComprador>
    <razonSocialComprador>${buyerName}</razonSocialComprador>
    <identificacionComprador>${buyerId}</identificacionComprador>
    <codDocModificado>${originalDocument.documentType}</codDocModificado>
    <numDocModificado>${originalDocument.number}</numDocModificado>
    <fechaEmisionDocSustento>${originalDocument.issueDate}</fechaEmisionDocSustento>
    <totalSinImpuestos>${subtotal}</totalSinImpuestos>
    <valorModificacion>${total}</valorModificacion>
    <moneda>DOLAR</moneda>
    <motivo>${motivo}</motivo>
  </infoNotaCredito>
  <detalles>${detalleXml}</detalles>
  <infoAdicional></infoAdicional>
</notaCredito>`;
}

describe('RideService', () => {
  const baseIssuer = {
    id: '00000000-0000-0000-0000-000000000007',
    logo: null,
    sandbox: true,
  };

  const baseDocument = {
    id: '00000000-0000-0000-0000-000000000042',
    issuer_id: '00000000-0000-0000-0000-000000000007',
    status: DocumentStatus.AUTHORIZED,
    authorization_number: 'AUTH-1',
    authorization_date: '2026-06-01',
    document_type: '01',
    access_key: '1'.repeat(49),
    authorization_xml: buildInvoiceXml(),
    signed_xml: null,
  };

  const originalAppEnv = config.appEnv;
  const originalOperator = config.operator;

  afterEach(() => {
    jest.clearAllMocks();
    config.appEnv = originalAppEnv;
    config.operator = originalOperator;
  });

  beforeEach(() => {
    catalogModel.getIdTypeLabel.mockResolvedValue('CEDULA');
    catalogModel.getPaymentMethodLabel.mockResolvedValue('EFECTIVO');
    catalogModel.getTermUnitLabel.mockResolvedValue('DIAS');
    catalogModel.getDocumentTypeDescription.mockResolvedValue('FACTURA');
    catalogModel.getTaxRateDescription.mockResolvedValue('IVA 15%');
    rideBuilder.build.mockResolvedValue(Buffer.from('%PDF-FAKE'));
  });

  describe('generate', () => {
    test('throws NotFoundError when given an access key that resolves to no document', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(rideService.generate('nonexistent-key')).rejects.toMatchObject({ statusCode: 404 });
      expect(issuerModel.findById).not.toHaveBeenCalled();
    });

    test('looks up by access key with no issuer scoping when no issuerOverride is supplied', async () => {
      documentModel.findByAccessKey.mockResolvedValue(baseDocument);
      issuerModel.findById.mockResolvedValue(baseIssuer);

      await rideService.generate(baseDocument.access_key);

      expect(documentModel.findByAccessKey).toHaveBeenCalledWith(baseDocument.access_key, null, false);
      expect(issuerModel.findById).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000007');
    });

    test('scopes the lookup to the issuerOverride id/sandbox when supplied', async () => {
      const issuerOverride = { ...baseIssuer, id: '00000000-0000-0000-0000-000000000009', sandbox: true };
      documentModel.findByAccessKey.mockResolvedValue(baseDocument);

      await rideService.generate(baseDocument.access_key, issuerOverride);

      expect(documentModel.findByAccessKey).toHaveBeenCalledWith(baseDocument.access_key, '00000000-0000-0000-0000-000000000009', true);
      // issuerOverride is used directly — issuerModel.findById is never called
      expect(issuerModel.findById).not.toHaveBeenCalled();
    });

    test('accepts a document object directly, skipping the accessKey lookup entirely', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);

      await rideService.generate(baseDocument);

      expect(documentModel.findByAccessKey).not.toHaveBeenCalled();
      expect(issuerModel.findById).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000007');
    });

    test('throws DOCUMENT_NOT_AUTHORIZED when the document status is not AUTHORIZED', async () => {
      const signedDoc = { ...baseDocument, status: DocumentStatus.SIGNED };

      await expect(rideService.generate(signedDoc)).rejects.toMatchObject({
        statusCode: 400,
        code: 'DOCUMENT_NOT_AUTHORIZED',
      });
      expect(issuerModel.findById).not.toHaveBeenCalled();
      expect(rideBuilder.build).not.toHaveBeenCalled();
    });

    test('throws RIDE_XML_UNAVAILABLE when an AUTHORIZED document has neither authorization_xml nor signed_xml', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);
      const document = { ...baseDocument, authorization_xml: null, signed_xml: null };

      await expect(rideService.generate(document)).rejects.toMatchObject({
        statusCode: 500,
        code: 'RIDE_XML_UNAVAILABLE',
      });
      expect(rideBuilder.build).not.toHaveBeenCalled();
    });

    test('falls back to signed_xml when authorization_xml is not set, mirroring getXml()', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);
      const document = {
        ...baseDocument,
        authorization_xml: null,
        signed_xml: buildInvoiceXml({ businessName: 'From Signed XML' }),
      };

      await rideService.generate(document);

      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.businessName).toBe('From Signed XML');
    });

    test('resolves the buyer id type label from the catalog', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);

      await rideService.generate(baseDocument);

      expect(catalogModel.getIdTypeLabel).toHaveBeenCalledWith('05');
      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.buyerIdTypeLabel).toBe('CEDULA');
    });

    test('resolves a methodLabel for every payment, and a termUnitLabel only when termUnit is present', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);
      const document = {
        ...baseDocument,
        authorization_xml: buildInvoiceXml({
          payments: [
            { method: '01', total: '50' },
            { method: '20', total: '65', termUnit: 'dias' },
          ],
        }),
      };

      await rideService.generate(document);

      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.payments).toEqual([
        { method: '01', total: '50', methodLabel: 'EFECTIVO' },
        { method: '20', total: '65', termUnit: 'dias', methodLabel: 'EFECTIVO', termUnitLabel: 'DIAS' },
      ]);
      expect(catalogModel.getTermUnitLabel).toHaveBeenCalledTimes(1);
      expect(catalogModel.getTermUnitLabel).toHaveBeenCalledWith('dias');
    });

    test('resolves originalDocument.documentTypeLabel for credit notes; null for invoices', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);
      const document = {
        ...baseDocument,
        document_type: '04',
        authorization_xml: buildCreditNoteXml({
          originalDocument: { documentType: '01', number: '001-001-000000005', issueDate: '01/06/2026' },
        }),
      };

      await rideService.generate(document);

      expect(catalogModel.getDocumentTypeDescription).toHaveBeenCalledWith('01');
      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.originalDocument).toEqual({
        documentType: '01', number: '001-001-000000005', issueDate: '01/06/2026', documentTypeLabel: 'FACTURA',
      });
    });

    test('originalDocument is null and getDocumentTypeDescription is skipped for an invoice', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);

      await rideService.generate(baseDocument);

      expect(catalogModel.getDocumentTypeDescription).not.toHaveBeenCalled();
      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.originalDocument).toBeNull();
    });

    test('collects distinct tax rate descriptions keyed by "code|rateCode", deduplicating repeats', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);
      const document = {
        ...baseDocument,
        authorization_xml: buildInvoiceXml({
          items: [
            {
              mainCode: '001', description: 'A', quantity: '1', unitPrice: '10.00', discount: '0.00',
              taxes: [{ code: '2', rateCode: '4', rate: '15' }, { code: '2', rateCode: '4', rate: '15' }],
            },
            {
              mainCode: '002', description: 'B', quantity: '1', unitPrice: '10.00', discount: '0.00',
              taxes: [{ code: '2', rateCode: '0', rate: '0' }],
            },
          ],
        }),
      };

      await rideService.generate(document);

      expect(catalogModel.getTaxRateDescription).toHaveBeenCalledTimes(2);
      expect(catalogModel.getTaxRateDescription).toHaveBeenCalledWith('2', '4');
      expect(catalogModel.getTaxRateDescription).toHaveBeenCalledWith('2', '0');
      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.taxDescriptions).toEqual({ '2|4': 'IVA 15%', '2|0': 'IVA 15%' });
    });

    test('additionalInfo reflects exactly the campoAdicional entries baked into the authorized XML, regardless of live config', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);
      config.operator = { ...config.operator, ruc: '9999999999999' };
      const document = {
        ...baseDocument,
        // Old combined-field format from before the Proveedor field-format fix —
        // must be printed exactly as authorized, not reconstructed from current config/format.
        authorization_xml: buildInvoiceXml({
          additionalInfo: [{ name: 'Proveedor', value: '1715824775001 - JONATHAN PILLAJO' }],
        }),
      };

      await rideService.generate(document);

      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.additionalInfo).toEqual([
        { name: 'Proveedor', value: '1715824775001 - JONATHAN PILLAJO' },
      ]);
    });

    test('environment reflects the ambiente declared in the authorized XML, not current config.appEnv/issuer.sandbox', async () => {
      config.appEnv = 'production';
      issuerModel.findById.mockResolvedValue({ ...baseIssuer, sandbox: false });
      const document = { ...baseDocument, authorization_xml: buildInvoiceXml({ environment: '1' }) };

      await rideService.generate(document);

      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.environment).toBe('1');
    });

    test('returns whatever rideBuilder.build resolves to', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);
      const pdfBuffer = Buffer.from('%PDF-SPECIFIC');
      rideBuilder.build.mockResolvedValue(pdfBuffer);

      const result = await rideService.generate(baseDocument);

      expect(result).toBe(pdfBuffer);
    });

    test('builds a rideData shape covering issuer, document, buyer, and totals fields sourced from the authorized XML', async () => {
      issuerModel.findById.mockResolvedValue({ ...baseIssuer, logo: Buffer.from('logo-bytes') });

      await rideService.generate(baseDocument);

      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData).toMatchObject({
        authorizationNumber: 'AUTH-1',
        authorizationDate: '2026-06-01',
        ruc: '1234567890001',
        businessName: 'Acme SA',
        tradeName: 'Acme',
        mainAddress: 'Av. Principal',
        branchAddress: 'Sucursal Norte',
        logoBuffer: Buffer.from('logo-bytes'),
        branchCode: '001',
        issuePointCode: '001',
        emissionType: '1',
        environment: '1',
        documentType: '01',
        accessKey: baseDocument.access_key,
        sequential: '000000005',
        buyerIdType: '05',
        buyerName: 'John Doe',
        buyerId: '0999999999',
        subtotal: '100.00',
        total: '115.00',
        motivo: null,
      });
    });
  });
});
