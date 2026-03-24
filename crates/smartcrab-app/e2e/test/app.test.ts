describe("SmartCrab App", () => {
  it("should load and display the app title", async () => {
    const title = await browser.getTitle();
    expect(title).toBeTruthy();
  });

  it("should render the main navigation", async () => {
    // Wait for app to be ready
    await browser.waitUntil(
      async () => {
        const body = await $("body");
        return await body.isDisplayed();
      },
      { timeout: 10000 },
    );

    const body = await $("body");
    const bodyText = await body.getText();
    expect(bodyText).toBeTruthy();
  });

  it("should show SmartCrab heading or navigation", async () => {
    // Wait for React to render DOM elements
    await browser.waitUntil(
      async () => {
        const headings = await $$("h1, h2, nav, [class*='sidebar'], [class*='nav']");
        return headings.length > 0;
      },
      { timeout: 10000, timeoutMsg: "React app did not render navigation within 10s" },
    );

    const headings = await $$("h1, h2, nav, [class*='sidebar'], [class*='nav']");
    expect(headings.length).toBeGreaterThan(0);
  });
});
