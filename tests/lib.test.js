import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPixPayload, crc16 } from '../src/lib/pix.js';
import { localDate, localHour, startOfLocalDay, tzOffsetMinutes } from '../src/lib/time.js';

test('CRC16 do Pix bate com o valor de verificação padrão', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('Pix copia e cola reproduz o exemplo do manual do Banco Central', () => {
  const payload = buildPixPayload({
    key: '123e4567-e12b-12d1-a456-426655440000',
    name: 'Fulano de Tal',
    city: 'BRASILIA',
  });
  assert.equal(
    payload,
    '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
  );
});

test('Pix inclui valor, remove acentos e limita nome e cidade', () => {
  const payload = buildPixPayload({
    key: 'loja@email.com',
    name: 'Max Lanches Food Truck do Zé Ltda',
    city: 'São José dos Campos',
    amountCents: 4150,
    txid: 'ML-42',
  });
  assert.match(payload, /540541\.50/);
  assert.match(payload, /5925Max Lanches Food Truck do/);
  assert.match(payload, /6015Sao Jose dos Ca62/);
  assert.match(payload, /0504ML42/);
  assert.equal(payload.slice(-4), crc16(payload.slice(0, -4)));
});

test('datas no fuso de São Paulo', () => {
  const tz = 'America/Sao_Paulo';
  assert.equal(tzOffsetMinutes(new Date('2026-09-26T12:00:00Z'), tz), -180);
  assert.equal(startOfLocalDay('2026-09-26', tz).toISOString(), '2026-09-26T03:00:00.000Z');
  // 01:30 UTC ainda é o dia anterior, 22h30, no Brasil.
  const lateNight = new Date('2026-09-27T01:30:00Z');
  assert.equal(localDate(lateNight, tz), '2026-09-26');
  assert.equal(localHour(lateNight, tz), 22);
});
