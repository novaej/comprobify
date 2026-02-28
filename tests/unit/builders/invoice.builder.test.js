const InvoiceBuilder = require('../../../src/builders/invoice.builder');

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
  items: [{
    mainCode: '001',
    description: 'SERVICIOS PROFESIONALES',
    quantity: '1.000000',
    unitPrice: '1428.570000',
    discount: '0.00',
    taxes: [{ code: '2', rateCode: '2', rate: '12.00', taxBase: '1428.57', value: '171.43' }],
  }],
  payments: [{ method: '20', total: '1600.00' }],
  additionalInfo: [{ name: 'email', value: 'test@example.com' }],
};

describe('InvoiceBuilder', () => {
  test('build generates XML with all required sections', () => {
    const builder = new InvoiceBuilder(mockIssuer);
    const xml = builder.build(validBody, '1'.repeat(49), 263);

    expect(xml).toContain('<infoTributaria>');
    expect(xml).toContain('<infoFactura>');
    expect(xml).toContain('<detalles>');
    expect(xml).toContain('<infoAdicional>');
    expect(xml).toContain('</factura>');
  });

  test('infoFactura contains buyer data', () => {
    const builder = new InvoiceBuilder(mockIssuer);
    const xml = builder.build(validBody, '1'.repeat(49), 263);

    expect(xml).toContain('<tipoIdentificacionComprador>04</tipoIdentificacionComprador>');
    expect(xml).toContain('<razonSocialComprador>BUYER S.A.</razonSocialComprador>');
    expect(xml).toContain('<identificacionComprador>1712345678001</identificacionComprador>');
  });

  test('calculates correct totals', () => {
    const builder = new InvoiceBuilder(mockIssuer);
    builder.build(validBody, '1'.repeat(49), 263);

    expect(builder.subtotal).toBe('1428.57');
    expect(builder.total).toBe('1600.00');
  });

  test('detalles contains item details with taxes', () => {
    const builder = new InvoiceBuilder(mockIssuer);
    const xml = builder.build(validBody, '1'.repeat(49), 263);

    expect(xml).toContain('<codigoPrincipal>001</codigoPrincipal>');
    expect(xml).toContain('<descripcion>SERVICIOS PROFESIONALES</descripcion>');
    expect(xml).toContain('<cantidad>1.000000</cantidad>');
    expect(xml).toContain('<precioUnitario>1428.570000</precioUnitario>');
    expect(xml).toContain('<codigo>2</codigo>');
    expect(xml).toContain('<tarifa>12.00</tarifa>');
  });

  test('additional info is included when provided', () => {
    const builder = new InvoiceBuilder(mockIssuer);
    const xml = builder.build(validBody, '1'.repeat(49), 263);

    expect(xml).toContain("nombre='email'");
    expect(xml).toContain('test@example.com');
  });

  test('additional info is omitted when not provided', () => {
    const bodyNoInfo = { ...validBody, additionalInfo: undefined };
    const builder = new InvoiceBuilder(mockIssuer);
    const xml = builder.build(bodyNoInfo, '1'.repeat(49), 263);

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
          unitPrice: '500.000000',
          discount: '0.00',
          taxes: [{ code: '2', rateCode: '2', rate: '12.00', taxBase: '1000.00', value: '120.00' }],
        },
      ],
    };

    const builder = new InvoiceBuilder(mockIssuer);
    const xml = builder.build(multiItemBody, '1'.repeat(49), 263);

    expect(xml).toContain('<codigoPrincipal>001</codigoPrincipal>');
    expect(xml).toContain('<codigoPrincipal>002</codigoPrincipal>');
  });

  test('handles multiple payments', () => {
    const multiPayBody = {
      ...validBody,
      payments: [
        { method: '01', total: '800.00' },
        { method: '20', total: '800.00' },
      ],
    };

    const builder = new InvoiceBuilder(mockIssuer);
    const xml = builder.build(multiPayBody, '1'.repeat(49), 263);

    expect(xml).toContain('<formaPago>01</formaPago>');
    expect(xml).toContain('<formaPago>20</formaPago>');
  });
});
