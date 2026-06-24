const CreditNoteBuilder = require('../../../src/builders/credit-note.builder');

const mockIssuer = {
  environment: '1',
  emission_type: '1',
  business_name: 'TEST COMPANY S.A.',
  trade_name: 'TEST CO',
  ruc: '1712345678001',
  branch_code: '001',
  issue_point_code: '001',
  main_address: 'AV. QUITO',
  branch_address: 'SUCURSAL TEST',
  special_taxpayer: null,
  required_accounting: 'SI',
};

const validBody = {
  issueDate: '26/02/2026',
  buyer: { idType: '04', id: '1712345678001', name: 'BUYER S.A.', address: 'ADDRESS' },
  originalDocument: { documentType: '01', number: '001-001-000000027', issueDate: '03/04/2026' },
  motivo: 'Devolución de mercadería por defecto de fabricación',
  items: [{
    mainCode: '001',
    description: 'SERVICIOS PROFESIONALES',
    quantity: '1.000000',
    unitPrice: '100.000000',
    discount: '0.00',
    taxes: [{ code: '2', rateCode: '2', rate: '15.00' }],
  }],
  additionalInfo: [{ name: 'email', value: 'test@example.com' }],
};

describe('CreditNoteBuilder', () => {
  test('build generates XML with all required sections', () => {
    const builder = new CreditNoteBuilder(mockIssuer);
    const xml = builder.build(validBody, '1'.repeat(49), 27);

    expect(xml).toContain('<infoTributaria>');
    expect(xml).toContain('<infoNotaCredito>');
    expect(xml).toContain('<detalles>');
    expect(xml).toContain('<infoAdicional>');
    expect(xml).toContain('</notaCredito>');
  });

  test('infoTributaria carries codDoc 04', () => {
    const builder = new CreditNoteBuilder(mockIssuer);
    const xml = builder.build(validBody, '1'.repeat(49), 27);

    expect(xml).toContain('<codDoc>04</codDoc>');
  });

  test('infoNotaCredito contains buyer and modified-document data', () => {
    const builder = new CreditNoteBuilder(mockIssuer);
    const xml = builder.build(validBody, '1'.repeat(49), 27);

    expect(xml).toContain('<tipoIdentificacionComprador>04</tipoIdentificacionComprador>');
    expect(xml).toContain('<razonSocialComprador>BUYER S.A.</razonSocialComprador>');
    expect(xml).toContain('<identificacionComprador>1712345678001</identificacionComprador>');
    expect(xml).toContain('<codDocModificado>01</codDocModificado>');
    expect(xml).toContain('<numDocModificado>001-001-000000027</numDocModificado>');
    expect(xml).toContain('<fechaEmisionDocSustento>03/04/2026</fechaEmisionDocSustento>');
    expect(xml).toContain('<motivo>Devolución de mercadería por defecto de fabricación</motivo>');
  });

  test('does not include a pagos block', () => {
    const builder = new CreditNoteBuilder(mockIssuer);
    const xml = builder.build(validBody, '1'.repeat(49), 27);

    expect(xml).not.toContain('<pagos>');
  });

  test('calculates correct totals', () => {
    const builder = new CreditNoteBuilder(mockIssuer);
    builder.build(validBody, '1'.repeat(49), 27);

    expect(builder.subtotal).toBe('100.00');
    expect(builder.total).toBe('115.00');
  });

  test('infoNotaCredito reflects calculated totals', () => {
    const builder = new CreditNoteBuilder(mockIssuer);
    const xml = builder.build(validBody, '1'.repeat(49), 27);

    expect(xml).toContain('<totalSinImpuestos>100.00</totalSinImpuestos>');
    expect(xml).toContain('<valorModificacion>115.00</valorModificacion>');
  });

  test('detalles contains item details with taxes', () => {
    const builder = new CreditNoteBuilder(mockIssuer);
    const xml = builder.build(validBody, '1'.repeat(49), 27);

    expect(xml).toContain('<codigoInterno>001</codigoInterno>');
    expect(xml).toContain('<descripcion>SERVICIOS PROFESIONALES</descripcion>');
    expect(xml).toContain('<cantidad>1.000000</cantidad>');
    expect(xml).toContain('<precioUnitario>100.000000</precioUnitario>');
    expect(xml).toContain('<codigo>2</codigo>');
    expect(xml).toContain('<tarifa>15.00</tarifa>');
  });

  test('additional info is included when provided', () => {
    const builder = new CreditNoteBuilder(mockIssuer);
    const xml = builder.build(validBody, '1'.repeat(49), 27);

    expect(xml).toContain('nombre="email"');
    expect(xml).toContain('test@example.com');
  });

  test('additional info is omitted when not provided', () => {
    const bodyNoInfo = { ...validBody, additionalInfo: undefined };
    const builder = new CreditNoteBuilder(mockIssuer);
    const xml = builder.build(bodyNoInfo, '1'.repeat(49), 27);

    expect(xml).not.toContain('<infoAdicional>');
  });

  test('handles multiple items', () => {
    const multiItemBody = {
      ...validBody,
      items: [
        { ...validBody.items[0] },
        {
          mainCode: '002',
          description: 'CONSULTORIA',
          quantity: '2.000000',
          unitPrice: '50.000000',
          discount: '0.00',
          taxes: [{ code: '2', rateCode: '2', rate: '15.00' }],
        },
      ],
    };

    const builder = new CreditNoteBuilder(mockIssuer);
    const xml = builder.build(multiItemBody, '1'.repeat(49), 27);

    expect(xml).toContain('<codigoInterno>001</codigoInterno>');
    expect(xml).toContain('<codigoInterno>002</codigoInterno>');
  });
});
