\# Quest Zone — User-Supplied Asset Integrity



This rule applies whenever working with user-supplied visual assets such as:



\- PNG

\- WebP

\- JPG/JPEG

\- SVG

\- buttons

\- sprites

\- icons

\- game UI panels

\- HUD assets

\- frames

\- backgrounds

\- logos

\- decorative graphics



\## Immutable Source Asset Rule



When the user provides an image asset and instructs Claude to use that asset, treat the supplied file as immutable source artwork.



Use the exact supplied image.



Do not:



\- redraw it

\- recreate it

\- imitate it using CSS

\- generate a replacement

\- change its silhouette

\- change its border geometry

\- change its proportions

\- add decorative pieces

\- remove decorative pieces

\- change unrelated colours

\- change textures

\- redesign corners

\- alter the artwork because another design appears better



The supplied image is the source of truth.



\## Allowed Enhancements



If the user explicitly requests an effect, apply that effect non-destructively around or over the original asset.



Examples:



\- shimmer

\- metallic reflection

\- hover animation

\- click animation

\- scale animation

\- nebula movement

\- energy pulses

\- particles

\- lighting animation

\- live HTML text

\- score overlays



Modify only the explicitly requested property.



Example:



If asked to animate the blue galaxy area:



\- animate only the galaxy area

\- preserve the metallic frame exactly

\- preserve the original shape

\- preserve all unrelated artwork



If asked to add shimmer to silver metal:



\- keep the original silver artwork

\- layer the shimmer over it

\- do not redraw the metal



\## Layering



Respect the visual depth of the supplied asset.



Foreground artwork such as metallic frames must remain above background effects such as:



\- galaxies

\- nebulae

\- particles

\- shimmer behind glass

\- animated backgrounds



Do not allow effects to spill over parts of the asset they should visually sit behind.



\## Transparency



When a supplied asset has transparency:



\- preserve transparency

\- do not add a rectangular background

\- do not create unwanted halos

\- do not create fuzzy edges

\- do not allow animation overlays to spill outside the intended asset region



\## Image Quality



Do not reduce the apparent quality of supplied artwork.



Avoid:



\- blur

\- destructive filters

\- distorted aspect ratios

\- poor scaling

\- low-resolution replacements

\- excessive compression

\- fuzzy masks



Use the original high-resolution asset whenever available.



\## Dynamic Text and Values



When values change dynamically, such as:



\- scores

\- XP

\- levels

\- usernames

\- currency

\- statistics



keep those values as live HTML/UI text layered on top of the image whenever practical.



Do not permanently bake changing values into the source image.



\## Default Behaviour



If there is any uncertainty about whether the artwork itself should be modified:



DO NOT MODIFY THE ASSET.



Preserve the original and use non-destructive overlays or code-based effects instead.



\## Priority



This rule takes priority over general UI/UX creativity.



UI/UX skills may improve layout, motion, interaction, responsiveness, and presentation.



They must not reinterpret or redesign user-supplied artwork unless the user explicitly requests that specific visual change.

