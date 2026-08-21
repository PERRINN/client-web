import { PERRINNPage } from './app.po';

describe('perrinn App', () => {
  let page: PERRINNPage;

  beforeEach(() => {
    page = new PERRINNPage();
  });

  it('should display welcome message', async () => {
    await page.navigateTo();
    expect(await page.getParagraphText()).toEqual('Welcome to app!!');
  });
});
