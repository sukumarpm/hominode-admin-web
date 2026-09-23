import type { CountryCode } from 'libphonenumber-js';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  detectPhoneCountry,
  formatPhoneForEditing,
  getPhonePlaceholder,
  normalizePhone,
  phoneCountries,
} from '../utils/phone';

interface PhoneNumberInputProps {
  name?: string;
  label?: string;
  value?: string;
  onChange?: (e164: string) => void;
  required?: boolean;
  disabled?: boolean;
  defaultCountry?: CountryCode;
}

const STORAGE_KEY = 'hominode.phoneCountry';

function savedCountry(defaultCountry: CountryCode): CountryCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as CountryCode | null;

    if (saved && phoneCountries.some((item) => item.code === saved)) {
      return saved;
    }
  } catch {
    // localStorage may be unavailable in tests/private contexts.
  }

  return defaultCountry;
}

export function PhoneNumberInput({
  name,
  label = 'Phone number',
  value = '',
  onChange,
  required = false,
  disabled = false,
  defaultCountry = 'PH',
}: PhoneNumberInputProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const initial = value ? formatPhoneForEditing(value) : null;

  const [country, setCountry] = useState<CountryCode>(
    initial?.country || savedCountry(defaultCountry),
  );
  const [phoneText, setPhoneText] = useState(initial?.display || '');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const normalized = normalizePhone(phoneText, country);

  const selected = useMemo(() => phoneCountries.find((item) => item.code === country)!, [country]);

  const filteredCountries = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return phoneCountries;

    return phoneCountries.filter((item) => {
      return (
        item.name.toLowerCase().includes(query) ||
        item.code.toLowerCase().includes(query) ||
        item.callingCode.includes(query.replace(/\s/g, ''))
      );
    });
  }, [search]);

  useEffect(() => {
    function outside(event: MouseEvent) {
      if (open && containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', outside);

    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  function setValidation(text: string, countryCode: CountryCode) {
    const element = inputRef.current;

    if (!element) return;

    if (!text.trim()) {
      element.setCustomValidity('');
      return;
    }

    if (normalizePhone(text, countryCode)) {
      element.setCustomValidity('');
    } else {
      const countryName =
        phoneCountries.find((item) => item.code === countryCode)?.name || countryCode;

      element.setCustomValidity(`Enter a valid phone number for ${countryName}.`);
    }
  }

  function updatePhone(next: string) {
    let nextCountry = country;

    // If an explicit international number is pasted, follow its country.
    if (next.trim().startsWith('+')) {
      const detected = detectPhoneCountry(next);

      if (detected) {
        nextCountry = detected;
        setCountry(detected);

        try {
          localStorage.setItem(STORAGE_KEY, detected);
        } catch {
          // Ignore storage failures.
        }
      }
    }

    setPhoneText(next);

    const e164 = normalizePhone(next, nextCountry) || '';
    onChange?.(e164);

    setValidation(next, nextCountry);
  }

  function chooseCountry(nextCountry: CountryCode) {
    setCountry(nextCountry);
    setOpen(false);
    setSearch('');

    try {
      localStorage.setItem(STORAGE_KEY, nextCountry);
    } catch {
      // Ignore storage failures.
    }

    const e164 = normalizePhone(phoneText, nextCountry) || '';
    onChange?.(e164);
    setValidation(phoneText, nextCountry);
  }

  function formatOnBlur() {
    setValidation(phoneText, country);

    const e164 = normalizePhone(phoneText, country);

    if (!e164) return;

    const formatted = formatPhoneForEditing(e164);

    if (formatted.country) {
      setCountry(formatted.country);
    }

    setPhoneText(formatted.display);
    onChange?.(e164);
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <label htmlFor={id}>{label}</label>

      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          border: '1px solid var(--border, #d8dee9)',
          borderRadius: 10,
          background: 'var(--surface, #fff)',
          overflow: 'visible',
        }}
      >
        <button
          type="button"
          disabled={disabled}
          aria-label="Select phone country"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          style={{
            border: 0,
            borderRight: '1px solid var(--border, #d8dee9)',
            background: 'transparent',
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            cursor: disabled ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
            minHeight: 44,
          }}
        >
          <span aria-hidden="true">{selected.flag}</span>
          <strong>{selected.callingCode}</strong>
          <span style={{ fontSize: 11 }}>▼</span>
        </button>

        <input
          ref={inputRef}
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={phoneText}
          onChange={(event) => updatePhone(event.target.value)}
          onBlur={formatOnBlur}
          placeholder={getPhonePlaceholder(country)}
          required={required}
          disabled={disabled}
          style={{
            flex: 1,
            border: 0,
            outline: 0,
            minWidth: 0,
            background: 'transparent',
          }}
        />
      </div>

      {name && <input type="hidden" name={name} value={normalized || ''} />}

      {open && (
        <div
          role="dialog"
          aria-label="Select country"
          style={{
            position: 'absolute',
            zIndex: 1000,
            top: '100%',
            left: 0,
            width: 'min(360px, 90vw)',
            marginTop: 6,
            padding: 8,
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border, #d8dee9)',
            borderRadius: 12,
            boxShadow: '0 14px 40px rgba(15, 23, 42, 0.18)',
          }}
        >
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search country or code"
            aria-label="Search country or calling code"
            style={{
              width: '100%',
              marginBottom: 7,
              boxSizing: 'border-box',
            }}
          />

          <div
            style={{
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            {filteredCountries.map((item) => (
              <button
                type="button"
                key={item.code}
                onClick={() => chooseCountry(item.code)}
                style={{
                  width: '100%',
                  border: 0,
                  background: item.code === country ? 'var(--blue-bg, #eef5ff)' : 'transparent',
                  padding: '9px 8px',
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr auto',
                  gap: 8,
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderRadius: 7,
                  alignItems: 'center',
                }}
              >
                <span aria-hidden="true">{item.flag}</span>
                <span>{item.name}</span>
                <strong>{item.callingCode}</strong>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
