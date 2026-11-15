import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { DetailFields } from '../pages';
import { describe, expect, it } from 'vitest';
import { communityZone, communityDate, communityTimeLabel, localSchedule, scheduleInstant } from '../visitorPolicy';
describe('community visitor timezone contract', () => {
  it.each([
    ['Asia/Kolkata', '2026-11-14T22:32', '2026-11-14T17:02:00Z'],
    ['Asia/Manila', '2026-11-15T01:02', '2026-11-14T17:02:00Z'],
    ['America/New_York', '2026-11-14T22:32', '2026-11-15T03:32:00Z'],
  ])('converts %s input once regardless of browser timezone', (zone, wall, utc) => {
    const ms = scheduleInstant(wall, zone);
    expect(ms).toBe(Date.parse(utc));
    expect(localSchedule(ms, zone)).toBe(wall);
    expect(communityDate(new Date(ms), zone)).toContain(zone);
  });
  it.each(['2026-03-29T01:30', '2026-10-25T01:30'])('rejects London skipped/repeated time %s', wall => {
    expect(() => scheduleInstant(wall, 'Europe/London')).toThrow(/daylight saving/);
  });
  it('keeps valid London DST instants and the community calendar date across midnight', () => {
    expect(scheduleInstant('2026-03-29T02:30', 'Europe/London')).toBe(Date.parse('2026-03-29T01:30Z'));
    const ms = Date.parse('2026-11-14T17:02Z');
    expect(localSchedule(ms, 'Asia/Kolkata').slice(0, 10)).toBe('2026-11-14');
    expect(localSchedule(ms, 'Asia/Manila').slice(0, 10)).toBe('2026-11-15');
  });
  it('reports invalid configuration and canonicalizes the existing India alias', () => {
    expect(communityZone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(communityTimeLabel('Asia/Calcutta')).toContain('Asia/Kolkata');
    for (const zone of ['', 'Invalid/Zone', '+05:30']) {
      expect(() => scheduleInstant('2026-11-14T22:32', zone)).toThrow(/community.*zone/i);
      expect(communityDate(new Date(), zone)).toContain('Community Admin');
    }
    expect(communityDate(new Date(), undefined)).toContain('not configured');
  });
});

it('visitor detail fields use the community timestamp and suppress the competing legacy time', () => {
  render(createElement(DetailFields, {data: {
    expectedArrival: new Date('2026-11-14T17:02Z'),
    expectedTime: new Date('2026-11-15T17:02Z'),
  }, visitorZone: 'Asia/Calcutta'}));
  expect(screen.getAllByText('Expected arrival')).toHaveLength(1);
  expect(screen.getByText(/10:32/)).toHaveTextContent('Asia/Kolkata');
  expect(screen.getByText(/10:32/)).toHaveTextContent('14 Nov 2026');
});
