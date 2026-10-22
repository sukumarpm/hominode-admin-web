import { expect, it } from 'vitest';
import { complaintStatusValue } from '../models';

it.each([
  ['pending', 'pending'],
  ['inProgress', 'inprogress'],
  ['in-progress', 'inprogress'],
  ['inprogress', 'inprogress'],
  ['resolved', 'completed'],
  ['completed', 'completed'],
  ['closed', 'completed'],
])('maps legacy complaint status %s to the workflow option %s', (status, expected) => {
  expect(complaintStatusValue({ status })).toBe(expected);
});
