// Tiny WCAG contrast helper. Usage:
//   node contrast.js "<fg>" "<bg>" ["<base>"]
// fg/bg/base accept: #rrggbb, #rgb, "r,g,b", or "r,g,b,a" (alpha 0..1).
// If a color has alpha, it is composited over the next color to its right
// (bg over base, fg over the resolved bg). base defaults to white then also
// shows dark-base result.
function parse(c) {
  c = c.trim();
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 1];
  }
  const p = c.split(',').map(Number);
  return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]];
}
function over(top, bot) { // composite top(rgba) over bot(rgb)
  const a = top[3];
  return [0,1,2].map(i => Math.round(top[i]*a + bot[i]*(1-a)));
}
function lum([r,g,b]) {
  const f = v => { v/=255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
  return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b);
}
function ratio(fg, bg) {
  const L1 = lum(fg), L2 = lum(bg);
  const hi = Math.max(L1,L2), lo = Math.min(L1,L2);
  return (hi+0.05)/(lo+0.05);
}
const [,, fgS, bgS, baseS] = process.argv;
const fg = parse(fgS), bg = parse(bgS);
const base = baseS ? parse(baseS) : null;
function resolve(bgC, baseC) {
  const bgSolid = bgC[3] < 1 ? over(bgC, baseC) : bgC.slice(0,3);
  const fgSolid = fg[3] < 1 ? over(fg, bgSolid) : fg.slice(0,3);
  return ratio(fgSolid, bgSolid);
}
if (base) {
  console.log(`ratio = ${resolve(bg, base.slice(0,3)).toFixed(2)}:1`);
} else {
  console.log(`over white = ${resolve(bg,[255,255,255]).toFixed(2)}:1 | over dark#1a1a1a = ${resolve(bg,[26,26,26]).toFixed(2)}:1`);
}
