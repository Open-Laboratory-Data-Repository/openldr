// Moved to @openldr/core/pure so @openldr/bootstrap can parse a manifest without depending on
// this package — packages/release is maintainer tooling and must never ship in a runtime image.
export { buildReleaseManifest, parseReleaseManifest, type ReleaseManifest } from '@openldr/core/pure';
