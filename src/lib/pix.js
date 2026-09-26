// Gera o "Pix copia e cola" (BR Code estático) seguindo o Manual de Padrões para Iniciação do Pix do Banco Central.
// O pagamento é conferido manualmente pela loja no app do banco — não há integração com PSP.

function field(id, value) {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC16/CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF), exigido pelo BR Code. */
export function crc16(str) {
  let crc = 0xffff;
  for (const byte of Buffer.from(str, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Remove acentos e caracteres fora do conjunto aceito pelos bancos. */
function sanitize(text, max) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .-]/g, '')
    .trim()
    .slice(0, max);
}

export function buildPixPayload({ key, name, city, amountCents, txid = '***' }) {
  const merchantAccount = field('00', 'br.gov.bcb.pix') + field('01', key.trim());
  const cleanTxid = txid === '***' ? txid : txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  let payload =
    field('00', '01') +
    field('26', merchantAccount) +
    field('52', '0000') +
    field('53', '986') +
    (amountCents ? field('54', (amountCents / 100).toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', sanitize(name, 25) || 'LOJA') +
    field('60', sanitize(city, 15) || 'BRASIL') +
    field('62', field('05', cleanTxid));
  payload += '6304';
  return payload + crc16(payload);
}
