export const ONBOARD_KEY = 'jv-onboarded';

export function isOnboarded(): boolean {
  return localStorage.getItem(ONBOARD_KEY) === '1';
}

export function markOnboarded(): void {
  localStorage.setItem(ONBOARD_KEY, '1');
}
