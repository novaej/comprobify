const db = require('../config/database');

async function bulkCreate(documentId, items, client) {
  if (!items || items.length === 0) return [];

  const q = client || db;
  const COLS_PER_ROW = 10;
  const values = [];
  const placeholders = [];

  items.forEach((item, i) => {
    const quantity = parseFloat(item.quantity);
    const unitPrice = parseFloat(item.unitPrice);
    const discount = parseFloat(item.discount || '0');
    const subtotal = quantity * unitPrice - discount;
    const taxTotal = item.taxes.reduce((sum, t) => sum + parseFloat(t.value), 0);
    const lineTotal = subtotal + taxTotal;

    const offset = i * COLS_PER_ROW;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`
    );

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
    );
  });

  const { rows } = await q.query(
    `INSERT INTO document_line_items
      (document_id, main_code, aux_code, description, quantity, unit_price, discount, subtotal, taxes, line_total)
     VALUES ${placeholders.join(', ')}
     RETURNING *`,
    values
  );

  return rows;
}

module.exports = { bulkCreate };
