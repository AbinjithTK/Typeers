import { afterEach, describe, expect, it, vi } from 'vitest';

let requestExpandedModeMock: ReturnType<typeof vi.fn>;
let navigateToMock: ReturnType<typeof vi.fn>;

vi.mock('@devvit/web/client', () => {
  requestExpandedModeMock = vi.fn();
  navigateToMock = vi.fn();

  return {
    navigateTo: navigateToMock,
    context: {
      username: 'test-user',
    },
    requestExpandedMode: requestExpandedModeMock,
  };
});

afterEach(() => {
  requestExpandedModeMock?.mockReset();
  navigateToMock?.mockReset();
});

describe('Splash', () => {
  it('renders the PLAY NOW button and calls requestExpandedMode on click', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import('./splash');

    // Let React commit the initial render.
    await new Promise((r) => setTimeout(r, 0));

    const playButton = Array.from(document.querySelectorAll('button')).find(
      (b) => /play now/i.test(b.textContent ?? '')
    );
    expect(playButton).toBeTruthy();

    playButton!.click();

    expect(requestExpandedModeMock).toHaveBeenCalledTimes(1);
  });
});
