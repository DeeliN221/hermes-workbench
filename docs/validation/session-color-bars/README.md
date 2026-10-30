# Session color bars in split view

These screenshots use the built dashboard/dist/index.js in Chromium through the
local fixture host. All visible conversation text is fictional preview data; no
production or NAS state is read.

The session accent bar is a split-view locator. It appears only while two or
three panes are open, so the open session cards can be matched with the pane
headers. A single pane already marks its row as active and shows no bars.

| Before: a single pane colors every card | After: a single pane has no bars |
| --- | --- |
| ![Two bars in a single pane](before-desktop-light-single.png) | ![No bars in a single pane](after-desktop-light-single.png) |

| Desktop light split | Desktop dark split |
| --- | --- |
| ![Two open sessions marked in light mode](after-desktop-light-split.png) | ![Two open sessions marked in dark mode](after-desktop-dark-split.png) |

| Mobile light split | Mobile dark split |
| --- | --- |
| ![Phone drawer with two open sessions](after-mobile-light-split.png) | ![Dark phone drawer with two open sessions](after-mobile-dark-split.png) |

The before image was captured from origin/main at d0c656a; the after images came
from this branch with the same mock host and fixture data.
