"""Export the two bundled WenKai glyphs as a small offline vector wordmark.
Glyph outlines retain the bundled font's license. No raster logo processing.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

root = Path(__file__).resolve().parents[1]
font = TTFont(root / 'public/fonts/wenkai.woff2')
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
units = font['head'].unitsPerEm
paths = []
for char, x, size, width in [('鲸', 1, 32, 1.02), ('笺', 35, 30.5, .98)]:
    pen = SVGPathPen(glyphs)
    glyphs[cmap[ord(char)]].draw(pen)
    scale = size / units
    paths.append(f'<path transform="translate({x} 34) scale({scale * width} {-scale})" d="{pen.getCommands()}"/>')
svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 42" role="img" aria-label="鲸笺"><title>鲸笺</title><g fill="#24262b">' + ''.join(paths) + '</g></svg>\n'
(root / 'public/brand/jingjian-wordmark.svg').write_text(svg, encoding='utf-8')
print('WenKai glyph wordmark exported, original glyph outlines retained')
