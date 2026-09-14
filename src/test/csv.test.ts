import { expect, it } from 'vitest';
import { parseResidentCsv } from '../csv';
const header = 'building,unit,residentName,phoneNumber,residentType';
it('preserves quoted CSV fields and canonical row numbers', () =>
  expect(
    parseResidentCsv(header + '\r\nTower A,1203,"Smith, Alex",+639170000000,owner')[0],
  ).toEqual({
    rowNumber: 2,
    building: 'Tower A',
    unit: '1203',
    residentName: 'Smith, Alex',
    phoneNumber: '+639170000000',
    residentType: 'owner',
  }));
it('accepts the existing column aliases', () =>
  expect(
    parseResidentCsv('tower,flat,name,mobile,ownershipType\nA,1,Alex,+639170000000,tenant')[0]
      .residentType,
  ).toBe('tenant'));
it.each([
  'name,phone\nAlex,+123456789',
  'building,unit,residentName,phoneNumber,residentType,name\nA,1,A,+123456789,owner,B',
  header + '\nA,1,"Unclosed,+123456789,owner',
])('rejects malformed imports', (csv) => expect(() => parseResidentCsv(csv)).toThrow());
it('enforces the existing 500-row boundary', () =>
  expect(() =>
    parseResidentCsv(header + '\n' + Array(501).fill('A,1,Alex,+123456789,owner').join('\n')),
  ).toThrow());
