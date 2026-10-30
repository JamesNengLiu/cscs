// Original vector pictograms, drawn in code; no imported weapon artwork.
const shapes={
  pistol:'M18 14H82V23H55L48 30H43L37 43H24L30 25H18Z M48 23V29H53L57 23Z',
  smg:'M19 14H65V19H92V23H64L59 28H53L57 42H46L42 27H36L32 38H24L27 24H13V19H19Z',
  rifle:'M4 22L24 17H36V14H54V18H91V21H108V24H55L49 28L55 42H45L40 29H32L27 39H20L23 27H16L6 33Z',
  sniper:'M3 23L23 18H39V16H46V12H39V8H67V12H60V16H65V19H108V22H65L58 26H43L38 37H30L33 27H19L6 34Z',
  shotgun:'M5 23L22 18H38V17H104V22H69V27H46L40 30H33L28 39H20L23 28H17L6 34Z',
  machinegun:'M4 20H24V16H62V19H109V23H66L64 28H59V41H37V27H30L25 39H17L20 26H4Z',
  grenade:'M49 13V7H62L68 15H63V20C76 29 71 43 56 43C40 43 35 29 49 20Z M65 8H74V22H70V12H65Z',
  kevlar:'M42 7L50 12H62L70 7L81 17L74 25V43H38V25L31 17Z',
  assaultsuit:'M31 19C31 5 52 3 52 19H31Z M63 17L68 20H77L82 17L91 25L86 30V44H59V30L54 25Z',
  defusekit:'M38 13H47V8H65V13H74V42H38Z M45 22V33H49V22Z M57 22V33H61V22Z',
  nightvision:'M25 18H46V39H25Z M66 18H87V39H66Z M46 22H66V28H46Z M29 10H83V15H29Z',
  shield:'M38 6H74L79 13V34L56 45L33 34V13Z M43 13V20H69V13Z',
};
export function createShopIcon(root,item){
  const wrap=root.createElement('span');wrap.className='shop-item-icon';wrap.setAttribute('aria-hidden','true');
  const svg=root.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 112 48');svg.setAttribute('focusable','false');
  const path=root.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',shapes[item.id]||shapes[item.category]||shapes.grenade);path.setAttribute('fill','currentColor');
  svg.append(path);wrap.append(svg);return wrap;
}
