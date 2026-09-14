export const requiredColumns = ['building', 'unit', 'residentName', 'phoneNumber', 'residentType'];
const aliases: Record<string, string> = {
  building: 'building',
  buildingname: 'building',
  tower: 'building',
  block: 'building',
  unit: 'unit',
  flat: 'unit',
  flatnumber: 'unit',
  unitnumber: 'unit',
  apartment: 'unit',
  residentname: 'residentName',
  fullname: 'residentName',
  name: 'residentName',
  phonenumber: 'phoneNumber',
  phone: 'phoneNumber',
  mobile: 'phoneNumber',
  mobilenumber: 'phoneNumber',
  residenttype: 'residentType',
  ownershiptype: 'residentType',
  occupancytype: 'residentType',
  email: 'email',
  emailaddress: 'email',
  countrycode: 'countryCode',
  alternatephone: 'alternatePhone',
  alternatephonenumber: 'alternatePhone',
  moveindate: 'moveInDate',
};
export function parseResidentCsv(input: string): Record<string, string | number>[] {
  const records: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  input = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === '') quoted = !quoted;
      else throw Error('Malformed CSV quoting.');
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw Error('Unclosed quote in CSV.');
  if (cell || row.length) {
    row.push(cell);
    records.push(row);
  }
  const nonempty = records.filter((r) => r.some((v) => v.trim()));
  if (nonempty.length < 2) throw Error('Add resident rows below the CSV headers.');
  const headers = nonempty[0].map(
    (h) =>
      aliases[
        h
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
      ],
  );
  if (headers.some((h) => !h)) throw Error('The CSV contains an unsupported column.');
  if (new Set(headers).size !== headers.length) throw Error('The CSV contains duplicate columns.');
  for (const header of requiredColumns)
    if (!headers.includes(header)) throw Error('Missing required column: ' + header);
  if (nonempty.length > 501) throw Error('Import at most 500 residents at a time.');
  return nonempty.slice(1).map((r, i) => {
    if (r.slice(headers.length).some((v) => v.trim()))
      throw Error('Row ' + (i + 2) + ' has too many values.');
    return {
      rowNumber: i + 2,
      ...Object.fromEntries(headers.map((h, n) => [h, (r[n] || '').trim()])),
    };
  });
}
