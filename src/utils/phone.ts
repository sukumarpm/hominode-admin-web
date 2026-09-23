import {
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max';

import examples from 'libphonenumber-js/mobile/examples';

export type PhoneCountry = {
  code: CountryCode;
  name: string;
  callingCode: string;
  flag: string;
};

const displayNames = new Intl.DisplayNames(['en'], {
  type: 'region',
});

function flagForCountry(country: CountryCode): string {
  return country
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

export const phoneCountries: PhoneCountry[] = getCountries()
  .map((code) => ({
    code,
    name: displayNames.of(code) || code,
    callingCode: `+${getCountryCallingCode(code)}`,
    flag: flagForCountry(code),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function getPhonePlaceholder(country: CountryCode): string {
  try {
    const example = getExampleNumber(country, examples);
    return example?.formatNational() || 'Phone number';
  } catch {
    return 'Phone number';
  }
}

export function normalizePhone(value: string, country: CountryCode): string | null {
  const input = value.trim();

  if (!input) return null;

  // Explicit international format:
  // +639171234567
  if (input.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(input);
    return parsed?.isValid() ? parsed.number : null;
  }

  // First parse as a national/local number for the selected country.
  // Philippines example:
  // 09171234567 -> +639171234567
  const national = parsePhoneNumberFromString(input, country);

  if (national?.isValid()) {
    return national.number;
  }

  // Also accept international digits pasted without "+":
  // 639171234567 -> +639171234567
  // 919876543210 -> +919876543210
  const digits = input.replace(/\D/g, '');

  if (digits) {
    const international = parsePhoneNumberFromString(`+${digits}`);

    if (international?.isValid()) {
      return international.number;
    }
  }

  return null;
}

export function detectPhoneCountry(value: string): CountryCode | undefined {
  const input = value.trim();

  if (!input) return undefined;

  try {
    if (input.startsWith('+')) {
      return parsePhoneNumberFromString(input)?.country;
    }

    const digits = input.replace(/\D/g, '');

    if (digits.length >= 7) {
      return parsePhoneNumberFromString(`+${digits}`)?.country;
    }
  } catch {
    // Ignore incomplete numbers while the user is typing.
  }

  return undefined;
}

export function formatPhoneForEditing(e164: string): { country?: CountryCode; display: string } {
  const parsed = parsePhoneNumberFromString(e164);

  if (!parsed) {
    return { display: e164 };
  }

  return {
    country: parsed.country,
    display: parsed.formatNational(),
  };
}
