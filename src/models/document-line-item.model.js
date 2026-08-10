const db = require('../config/database');

async function bulkCreate(documentId, items, client, sandbox = false) {
  if (!items || items.length === 0) return [];

  const COLS_PER_ROW = 11;
  const values = [];
  const placeholders = [];

  items.forEach((item, i) => {
    const quantity = parseFloat(item.quantity);
    const unitPrice = parseFloat(item.unitPrice);
    const discount = parseFloat(item.discount || '0');
    const subtotal = quantity * unitPrice - discount;
    // Tax amount is never submitted on the request — only code/rateCode/rate are — so it
    // must be derived the same way the XML builders derive it (subtotal * rate / 100),
    // not read from a `.value` field that doesn't exist on the payload's tax objects.
    const taxTotal = item.taxes.reduce((sum, t) => sum + subtotal * (parseFloat(t.rate) / 100), 0);
    const lineTotal = subtotal + taxTotal;

    const offset = i * COLS_PER_ROW;
    const cols = Array.from({ length: COLS_PER_ROW }, (_, j) => `$${offset + j + 1}`);
    placeholders.push(`(${cols.join(', ')})`);

    values.push(
      documentId,
      item.mainCode,
      item.auxCode || null,
      item.description,
      quantity,
      unitPrice,
      discount,
      subtotal.toFixed(2),
      JSON.stringify(item.taxes),
      lineTotal.toFixed(2),
      // Audit/query record only — not the RIDE's source of truth, which reads the
      // authorized XML's own <detallesAdicionales> (see ride.service.js).
      JSON.stringify(item.additionalDetails || []),
    );
  });

  const q = client || db;
  const schema = client ? '' : (sandbox ? 'sandbox.' : 'public.');
  const { rows } = await q.query(
    `INSERT INTO ${schema}document_line_items
      (document_id, main_code, aux_code, description, quantity, unit_price, discount, subtotal, taxes, line_total, additional_details)
     VALUES ${placeholders.join(', ')}
     RETURNING *`,
    values
  );

  return rows;
}

async function deleteByDocumentId(documentId, client) {
  await client.query('DELETE FROM document_line_items WHERE document_id = $1', [documentId]);
}

module.exports = { bulkCreate, deleteByDocumentId };
