import { LoadingScreen } from './states';

/**
 * Kept as the default full-page loader so existing call sites stay unchanged.
 * The look lives in `states.tsx` with the empty and error screens, so all three
 * move together.
 */
export default function Loading({ label }: { label?: string }) {
  return <LoadingScreen label={label} />;
}
