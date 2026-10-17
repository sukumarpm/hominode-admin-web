import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PhoneNumberInput } from '../components/PhoneNumberInput';
import { normalizePhone } from '../utils/phone';

describe('resident phone registration input', () => {
  it.each([
    ['+91 98765 43210', '+919876543210'],
    ['+63 917 123 4567', '+639171234567'],
    ['+1 415 555 2671', '+14155552671'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('preserves explicit international input %s', (input, expected) => {
    render(<PhoneNumberInput name="phoneNumber" defaultCountry="IN" respectDefaultCountry />);
    const phone = screen.getByLabelText('Phone number');
    fireEvent.change(phone, { target: { value: input } });
    fireEvent.blur(phone);

    expect(phone).toHaveValue(input);
    expect(screen.getByRole('button', { name: 'Select phone country' })).toHaveTextContent(
      input.startsWith('+91')
        ? '+91'
        : input.startsWith('+63')
          ? '+63'
          : input.startsWith('+1 ')
            ? '+1'
            : '+44',
    );
    expect(document.querySelector<HTMLInputElement>('input[name="phoneNumber"]')).toHaveValue(
      expected,
    );
  });

  it('uses the community country for a local-format number and rejects invalid input', () => {
    expect(normalizePhone('98765 43210', 'IN')).toBe('+919876543210');
    expect(normalizePhone('not a phone', 'IN')).toBeNull();
    render(<PhoneNumberInput name="phoneNumber" defaultCountry="IN" respectDefaultCountry />);
    expect(screen.getByText('+91')).toBeInTheDocument();
  });

  it('requires a country choice when the community has no usable country code', () => {
    render(
      <PhoneNumberInput
        name="phoneNumber"
        defaultCountry="PH"
        respectDefaultCountry
        requireCountrySelection
      />,
    );
    const phone = screen.getByLabelText('Phone number');
    fireEvent.change(phone, { target: { value: '9876543210' } });
    expect(document.querySelector<HTMLInputElement>('input[name="phoneNumber"]')).toHaveValue('');
    expect((phone as HTMLInputElement).validationMessage).toContain('Select the phone country');

    fireEvent.click(screen.getByRole('button', { name: 'Select phone country' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'India +91' }));
    expect(document.querySelector<HTMLInputElement>('input[name="phoneNumber"]')).toHaveValue(
      '+919876543210',
    );
  });
});
