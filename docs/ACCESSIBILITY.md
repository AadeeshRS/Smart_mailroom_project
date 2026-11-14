# Accessibility checklist

Plan task 8.4 (finding F27). Status 2026-11-15: the code-level pass is done; the screen-reader walkthrough and the
largest-font check belong to the physical-device test.

## Done in code

| Check | How |
|---|---|
| Every touchable has a role and a name | `Button` (button), `Choice` (radio buttons inside a radiogroup named by its label), `Check` (checkbox with its checked state), parcel cards and giveaway rows (button, named after the parcel or member). The tab bar uses each tab's title |
| Disabled and busy states are announced | `Button` sets `aria-disabled` and `aria-busy`; the spinner is labelled "Working" |
| Form fields are read with their label and hint | `Field` sets `accessibilityLabel` to the visible label and `accessibilityHint` to the hint below it |
| Errors are announced | `Feedback` is an `alert` and, on Android, a polite live region, so a screen reader reads a new error without moving focus |
| Headings | Page titles and card headings have the `header` role |
| Codes are read digit by digit | The member's collection code and the operator's delivery OTP have labels that spell out each digit |
| Dashboard tiles read as one item | "Received today: 4", not two separate numbers |
| The camera view is labelled | "Camera viewfinder. Point it at the barcode; it scans on its own." Manual entry is always offered |
| Touch targets | Buttons, choices and checkboxes are at least 48 points tall; the tab bar is 64 |
| Large system fonts | Text scales with the system setting. Only the two decorative ✓ glyphs (in a fixed-size circle and box) don't scale; their meaning is in the label beside them |

## Colour contrast (WCAG 2.1 AA)

Text needs 4.5:1; form-field outlines need 3:1. Measured with the WCAG relative-luminance formula.

| Pair | Ratio |
|---|---|
| Body text (ink) on white / page background | 14.36 / 13.23 |
| Muted text on white / page background / pale green | 5.78 / 5.33 / 4.97 |
| White on teal (primary button) | 6.45 |
| Teal on pale green (quiet button, tag) | 5.55 |
| White on red (danger button) | 7.18 |
| Red on pale red (error) | 6.29 |
| Amber on pale amber (notice) | 6.04 |
| Teal eyebrow on page background | 5.95 |
| Input placeholder on white | 4.93 (was 4.35; changed to `#5E747B`) |
| Input outline on white | 3.62 (was 2.25; changed to `#768B86`) |

## Left for the physical-device test

- TalkBack (Android) and VoiceOver (iOS) walkthrough: sign in, Home and Collect now, Requests, the operator's Scan
  and intake, Giveaway and handover. Check that every control is reached, named and operable.
- Largest system font size: no clipped or overlapping text on those screens.
