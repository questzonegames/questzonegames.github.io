---
name: Quest Zone
description: A space-themed, metallic-chrome browser game hub with an MMORPG-style account/skill layer.
colors:
  bg-deep: "#000000"
  bg-panel: "#0a0d18"
  bg-panel-alt: "#10152a"
  border: "rgba(130,160,255,0.14)"
  border-strong: "rgba(130,160,255,0.3)"
  blue: "#3b82f6"
  blue-dark: "#1d4ed8"
  blue-light: "#7fb3ff"
  green: "#39ff8f"
  green-dark: "#12a85a"
  text: "#e8ecff"
  text-dim: "#a9b1d6"
  text-faint: "rgba(232,236,255,0.45)"
  metal-hi: "#aab6d6"
  metal-mid: "#454e63"
  metal-low: "#12151f"
  gunmetal: "#171d30"
  seam: "rgba(90,150,255,0.75)"
typography:
  display:
    fontFamily: "Orbitron, sans-serif"
    fontSize: "clamp(19px, 2.8vw, 42px)"
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: "0.06em"
  body:
    fontFamily: "Exo 2, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.02em"
  label:
    fontFamily: "Orbitron, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.06em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "26px"
components:
  nav-tab:
    backgroundColor: "{colors.gunmetal}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
  nav-tab-hover:
    backgroundColor: "rgba(90,130,255,0.09)"
    textColor: "#ffffff"
  game-card:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "8px 6px"
  btn-chrome-blue:
    backgroundColor: "{colors.blue-dark}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "11px 22px"
---

# Design System: Quest Zone

## Overview

**Creative North Star: "The Flagship Bridge"**

Quest Zone reads as the command bridge of a starship, not a website chrome-plated for effect: a real universe fills the void behind everything (a canvas starfield with twinkling stars, drifting nebula wisps, and rare distant galaxies, its exact composition re-rolled every page load), and every interactive surface — nav bar, buttons, game tiles, panels — is machined from the same brushed-titanium/gunmetal material, lit from a cold blue seam rather than a warm studio light. The bridge metaphor is literal at the component level: the nav bar is built from angular, riveted plates with cyan seam-lighting between segments, exactly like a physical control console, not a flat CSS bar wearing a gradient.

The system is deliberately restrained given how much surface area it covers: the metallic material family (gunmetal fill, blue-white bevel highlight, cyan seam glow) is the *one* recurring texture used everywhere rather than a different treatment per section, so fifteen-plus pages spanning the homepage, Highscores, the full Profile suite, and the Admin Zone all read as one machine. Motion is a small, repeated vocabulary — a diagonal shimmer sweep on hover, a physical sink-in-and-spring-back on click, a soft cursor-follow glow — reused verbatim on every interactive element rather than invented fresh per component, which is what makes the whole site feel like one console rather than a pile of separately-designed widgets.

Confirmed visual rejections: no flat, un-textured "SaaS card" surfaces for anything meant to feel premium (nav, buttons, game tiles); no warm/neutral color anywhere in the chrome (this is a cold, blue-lit deep-space system, not a warm dashboard); no static hover states — every clickable metal surface in this system either glows, shimmers, or physically depresses.

**Key Characteristics:**
- A live, randomized deep-space canvas background behind every page, never a static image
- One shared "brushed gunmetal + blue seam-light" material used for the nav bar, every button variant, and every game/content tile
- A diagonal shimmer sweep + tactile press-and-spring physical feedback on every clickable metal surface
- Orbitron for anything that announces itself (headings, numbers, labels); Exo 2 for anything read in a sentence
- Status/semantic color (green = active/success, red = banned/danger, gold = achievements/rewards) is reserved and never used for ordinary chrome

## Colors

A cold, near-monochrome blue-on-black palette: color is spent on light and glow, not on hue variety. The one deliberate exception is semantic status color, held in reserve so it stays legible against the otherwise blue-toned system.

### Primary
- **Command Blue** (`#3b82f6`): the one saturated accent — primary CTAs, active/current states (active nav tab, active pagination page, focused inputs), and the color every glow effect is built from.
- **Command Blue Light** (`#7fb3ff`): hover/active text, XP bars, links, and the brighter end of every blue glow gradient.
- **Command Blue Dark** (`#1d4ed8`): the deep end of primary-button gradients and pressed/active states.

### Neutral
- **Void Black** (`#000000`): the deep space canvas base, and the color the starfield/nebula canvas fills before anything is drawn.
- **Panel Ink** (`#0a0d18`) / **Panel Ink Raised** (`#10152a`): the two-step dark navy fill used under every metal frame — panels, inputs, table headers.
- **Gunmetal** (`#171d30`): the recurring dark ring color inside every beveled component (nav tabs, game tiles, chrome buttons) — the "shadow side" of the metal.
- **Star White** (`#e8ecff`): primary text on dark.
- **Faded Signal** (`#a9b1d6`) / **Ghost Signal** (`rgba(232,236,255,0.45)`): secondary and disabled/placeholder text.
- **Seam Border** (`rgba(130,160,255,0.14–0.3)`): the hairline border used on every panel and input — never pure gray, always blue-tinted even at its faintest.

### Named Rules
**The Cold-Light Rule.** Every light source in this system — glow, highlight, seam, shimmer — is blue-white, never warm. A warm highlight on a metal surface signals it's using the wrong material.

**The Reserved-Status-Color Rule.** Green (`#39ff8f` active/success) and gold (used for achievements, rewards, rank badges) never appear on ordinary chrome (nav, buttons, panels) — only on the specific status or reward they signal. Their rarity is what makes them legible as meaning something.

## Typography

**Display Font:** Orbitron (with sans-serif fallback)
**Body Font:** Exo 2 (with sans-serif fallback)

**Character:** Orbitron is a geometric, slightly technical/sci-fi display face used for anything that needs to feel like a HUD readout — page titles, stat numbers, nav labels, table headers. Exo 2 is a cleaner, more legible grotesque used for anything read at length — body copy, descriptions, form inputs. The pairing is deliberately narrow: two faces, not three, both leaning technical rather than one technical face fighting a humanist one.

### Hierarchy
- **Display** (900, `clamp(19px, 2.8vw, 42px)`, Orbitron): page-level headings ("Highscores", "Admin Zone", "Guidebook").
- **Label** (700, 11px, Orbitron, uppercase, 0.06em tracking): nav tabs, table column headers, stat-tile labels — anything short and structural.
- **Body** (600, 13px, Exo 2): buttons, form inputs, descriptions, most UI copy.
- **Numeric** (900, Orbitron, gradient-clipped white-to-blue-grey text): standout numbers — Total Level, scores, rank — always Orbitron even inline in otherwise-Exo-2 text.

### Named Rules
**The One-Voice-Per-Job Rule.** Orbitron announces; Exo 2 explains. A control never mixes the two faces in the same string.

## Layout

Every page shares one `.container` column (1360px max-width, 18px side padding) centered in the viewport, with the starfield canvas running full-bleed behind it at all times. The nav bar and header sit inside that same container width, so nothing in the chrome is ever wider than the content it frames. Grids (the homepage game grid, admin summary stats) collapse from a wide multi-column layout down to fewer columns at narrower breakpoints rather than reflowing to a single list, keeping the "console" density even on smaller viewports.

## Elevation & Depth

Hybrid: flat dark fills at rest, with depth communicated almost entirely through **beveled metal edges** (a light top/bottom rail against a dark middle) and layered inset shadows rather than drop shadows. A typical interactive surface stacks 2-4 `box-shadow: inset` layers (a bright top highlight, a dark bottom edge, an inner shadow for cavity depth) instead of one outer `box-shadow`. Outer glow shadows exist but are reserved for state (hover/active/focus), never present at rest.

### Shadow Vocabulary
- **Bevel highlight** (`inset 0 1px 0 rgba(190,210,255,0.1–0.2)`): the "light catching the top edge" cue on every metal surface, at rest.
- **Bevel shadow** (`inset 0 -1px 0 rgba(0,0,0,0.4)`): the paired dark bottom edge.
- **Hover glow** (`0 0 14–20px rgba(59,130,246,0.3)`, outer): appears only on hover/focus.
- **Press shadow** (`inset 0 2px 6–8px rgba(0,0,0,0.6)`): replaces the bevel highlight on `:active`, selling a physical sink-in.

### Named Rules
**The Rest-Is-Quiet Rule.** No component glows or casts an outer shadow at rest — only the beveled inset pair. Glow is entirely a response to hover, focus, or active state, never ambient decoration.

## Shapes

Radius scales in three steps: 6-8px for small controls (nav tabs, pagination, form inputs), 10-11px for mid-size surfaces (game tiles, dashboard tiles, buttons), 16-18px for large panels (the game-section frame, profile/admin page frames). Corners are never sharp (0px) and never fully rounded (pill/circle) except genuinely circular elements (avatar frames, rank badges, small icon buttons). Panel frames add a decorative touch beyond the radius: thin animated "corner-bracket" accents (`.corner-brackets`) at the four corners of major panels, reinforcing the HUD/console reading.

## Components

### Buttons
- **Shape:** 10px radius, brushed-metal frame via a two-layer background (a dark fill clipped to padding-box, a diagonal chrome-blue gradient frame clipped to border-box).
- **Primary (`.btn-chrome-blue`):** blue-to-navy gradient fill, white text, used for the one recommended action per context (Signup, Admin Zone).
- **Secondary (`.btn-chrome-dark`):** charcoal-to-black fill with the same chrome-blue frame, used for Profile/Login/Logout and other non-primary actions.
- **Hover:** a diagonal shimmer band sweeps left-to-right across the button once (`chrome-sweep`), plus a brighter glow on the frame.
- **Press:** the button sinks 1px and scales to 0.97, its bevel inverting to a pressed-in inset shadow.

### Navigation
- **Style:** a single continuous gunmetal strip (not separate pill buttons) divided into tabs by short cyan seam-ticks, not full-height dividers.
- **Default:** icon + label in Faded Signal color on the gunmetal fill.
- **Hover:** background lifts to a faint blue tint, a diagonal shimmer sweeps across the tab, icon/text brighten to white.
- **Active/current page:** background shifts to a blue-tinted gradient with a persistent inset glow ring — the only nav state with an always-on glow.
- **Press:** the tab sinks 1px with a compressed inset shadow, springing back on release.
- **Mobile:** the same strip scrolls horizontally rather than collapsing into a hamburger/drawer, keeping every tab reachable without a mode switch.

### Cards / Game Tiles
- **Corner Style:** 10px radius.
- **Background:** dark navy-to-black diagonal gradient fill with a radial blue glow anchored at the bottom, framed by the same chrome-metal border trick as buttons.
- **Shadow Strategy:** the standard beveled inset pair at rest; on hover, an additional cursor-following soft light (`.tile-light`, a radial gradient anchored to mouse position) plus a diagonal shimmer sweep plus an outer blue glow.
- **Press:** the tile sinks (scale 0.97) with a compressed inset shadow, same physical language as buttons/nav.
- **Content:** either a placeholder icon + number (unbuilt game slots) or full-bleed artwork with a metallic gradient-text title overlaid at the bottom on a dark fade.

### Inputs / Fields
- **Style:** dark navy gradient fill, a thin blue-tinted border, inset top highlight matching the metal-surface bevel language.
- **Focus:** border brightens to Command Blue Light plus an outer blue glow ring — no color other than blue is used for focus anywhere in the system.

### Panels (Signature Component)
The large frame wrapping a page's main content (the homepage game section, Highscores, Profile, Admin Zone). Built from the same two-layer chrome-frame trick as buttons/tiles but at a larger radius (16-18px), with animated corner-bracket accents at all four corners and, on some panels, a thin glowing horizontal seam along the bottom edge (`.hud-edge-glow`) — the panel equivalent of a ship-bridge console readout strip.

## Do's and Don'ts

### Do:
- **Do** build every new interactive surface from the same metal-bevel + shimmer + press vocabulary already used by the nav, buttons, and game tiles — never invent a fourth material.
- **Do** keep the starfield canvas as the one full-bleed background element on every page; new surfaces sit on top of it, they never replace or obscure large areas of it with an opaque panel unless that panel itself needs full attention (modals).
- **Do** reserve outer glow/shadow for state changes (hover, focus, active, "this is currently selected") — a component that glows at rest is a bug, not a style choice.
- **Do** use Orbitron for anything structural or numeric and Exo 2 for anything read in a sentence; never mix them within one string.

### Don't:
- **Don't** introduce a warm accent color (amber/red/orange as a UI accent, not a status color) anywhere in the chrome — this is a cold blue-lit system throughout.
- **Don't** use a flat, un-beveled, drop-shadow-only card style anywhere meant to feel premium — that reads as generic SaaS, not console-grade.
- **Don't** add a hover effect that isn't already in the vocabulary (shimmer sweep, glow, cursor-follow light, physical press) — a bespoke one-off hover animation breaks the "one machine" read.
- **Don't** put game-genre-category tabs or any other nav content that isn't a real, working destination into the primary nav — every tab either goes somewhere or is an explicit, honestly-labeled "coming soon".
