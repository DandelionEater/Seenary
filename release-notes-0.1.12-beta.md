# Seenary 0.1.12 Beta

Tag: `v0.1.12-beta`

## New and improved

- The Windows updater now treats a download as one shared operation, so repeated requests reuse the transfer already in progress.

## Reliability and fixes

- Windows updates now download the installer once before prompting to install. Seenary skips differential updates because its custom installer wrapper is not compatible with Electron Updater's cached inner-installer blockmap.
