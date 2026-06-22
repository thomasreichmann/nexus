/**
 * The full fixture chain: console → authenticated → db → dedicated-user → data.
 * Specs import `{ test, expect }` from here to get every precondition fixture.
 * A spec that only needs auth can import the smaller `./authenticated` instead;
 * one that only needs a connection can import `./db`.
 */
export { test, expect } from './data';
