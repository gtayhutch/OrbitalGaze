/**
 * @fileoverview The site-wide credit for the webcam provider.
 *
 * Layer: client feature (browser only). Shown in the globe's credit strip.
 *
 * Windy's API terms ask every site that shows its webcams to say so, in
 * visible text the size of the site's normal small print, linking to
 * windy.com and to its page for adding a webcam. This component is that
 * credit; it stays on screen whenever the globe is shown.
 */

/** Windy's home page, as its credit requires. */
const WINDY_HOME_URL = 'https://www.windy.com/';

/** Windy's page for adding a webcam, as its credit requires. */
const WINDY_ADD_WEBCAM_URL = 'https://www.windy.com/webcams/add';

/**
 * "Webcams provided by windy.com — add a webcam", with both links.
 *
 * @example
 * <GlobeView credits={<WebcamCredit />} … />
 */
export function WebcamCredit(): React.JSX.Element {
  return (
    <p>
      Webcams provided by{' '}
      <a
        href={WINDY_HOME_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        windy.com
      </a>{' '}
      &mdash;{' '}
      <a
        href={WINDY_ADD_WEBCAM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        add a webcam
      </a>
    </p>
  );
}
