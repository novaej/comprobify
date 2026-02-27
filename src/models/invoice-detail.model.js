const db = require('../config/database');

async function bulkCreate(documentId, items) {
  if (!items || items.length === 0) return [];

  const rows = [];
  for (const item of items) {
    const quantity = parseFloat(item.quantity);
    const unitPrice = parseFloat(item.unitPrice);
    const discount = parseFloat(item.discount || '0');
    const subtotal = quantity * unitPrice - discount;
    const taxTotal = item.taxes.reduce((sum, t) => sum + parseFloat(t.value), 0);
    const lineTotal = subtotal + taxTotal;

    const { rows: inserted } = await db.query(
      `INSERT INTO invoice_details
        (document_id, main_code, aux_code, description, quantity, unit_price, discount, subtotal, taxes, line_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
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
      ]
    );
    rows.push(inserted[0]);
  }
  return rows;
}

module.exports = { bulkCreate };
