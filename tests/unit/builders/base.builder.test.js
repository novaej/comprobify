const BaseDocumentBuilder = require('../../../src/builders/base.builder');

const mockIssuer = {
  environment: '1',
  emission_type: '1',
  business_name: 'TEST COMPANY S.A.',
  trade_name: 'TEST CO',
  ruc: '1712345678001',
  branch_code: '001',
  issue_point_code: '001',
  main_address: 'AV. QUITO',
  special_taxpayer: null,
  required_accounting: 'SI',
};

describe('BaseDocumentBuilder', () => {
  test('buildInfoTributaria sets all required fields', () => {
    const builder = new BaseDocumentBuilder(mockIssuer, '01');
    builder.buildInfoTributaria({ accessKey: '1'.repeat(49), sequential: 263 });

    const info = builder.data.infoTributaria;
    expect(info.ambiente).toBe('1');
    expect(info.tipoEmision).toBe('1');
    expect(info.razonSocial).toBe('TEST COMPANY S.A.');
    expect(info.nombreComercial).toBe('TEST CO');
    expect(info.ruc).toBe('1712345678001');
    expect(info.claveAcceso).toBe('1'.repeat(49));
    expect(info.codDoc).toBe('01');
    expect(info.estab).toBe('001');
    expect(info.ptoEmi).toBe('001');
    expect(info.secuencial).toBe('000000263');
    expect(info.dirMatriz).toBe('AV. QUITO');
    // obligadoContabilidad belongs in infoFactura per XSD — not infoTributaria
    expect(info.obligadoContabilidad).toBeUndefined();
  });

  test('omits optional fields when not present', () => {
    const issuer = { ...mockIssuer, trade_name: null };
    const builder = new BaseDocumentBuilder(issuer, '01');
    builder.buildInfoTributaria({ accessKey: '1'.repeat(49), sequential: 1 });

    expect(builder.data.infoTributaria.nombreComercial).toBeUndefined();
    expect(builder.data.infoTributaria.agenteRetencion).toBeUndefined();
    expect(builder.data.infoTributaria.contribuyenteRimpe).toBeUndefined();
  });

  test('toXml generates valid XML with attributes', () => {
    const builder = new BaseDocumentBuilder(mockIssuer, '01');
    builder.buildInfoTributaria({ accessKey: '1'.repeat(49), sequential: 1 });
    const xml = builder.toXml('factura');

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<factura');
    expect(xml).toContain('id="comprobante"');
    expect(xml).toContain('version="2.1.0"');
    expect(xml).toContain('<infoTributaria>');
    expect(xml).toContain('</factura>');
  });
});
