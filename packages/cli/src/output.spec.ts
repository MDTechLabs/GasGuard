import { logInfo, setCliOptions, shouldShowProgress } from "./output";

describe("CLI output options", () => {
  afterEach(() => {
    setCliOptions({});
    jest.restoreAllMocks();
  });

  it("suppresses informational logs in quiet mode", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);

    setCliOptions({ quiet: true });
    logInfo("status");
    expect(log).not.toHaveBeenCalled();

    setCliOptions({ quiet: false });
    logInfo("result");
    expect(log).toHaveBeenCalledWith("result");
  });

  it("enables progress only for an interactive, non-quiet terminal", () => {
    expect(shouldShowProgress({}, true)).toBe(true);
    expect(shouldShowProgress({ quiet: true }, true)).toBe(false);
    expect(shouldShowProgress({ progress: false }, true)).toBe(false);
    expect(shouldShowProgress({}, false)).toBe(false);
  });
});
