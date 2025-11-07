import { CapitalizeWordPipe } from './capitalize-word-pipe';

describe('CapitalizeWordPipe', () => {
  it('create an instance', () => {
    const pipe = new CapitalizeWordPipe();
    expect(pipe).toBeTruthy();
  });
});
