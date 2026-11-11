// Independently drawn HUD silhouettes. These are small vector pictograms, not
// imported Valve artwork or renders of the weapon models. They add no texture,
// network request, WebGL pass or per-frame work to the game.
const record=(id,label,category,kind,viewBox,path)=>Object.freeze({id,label,category,kind,viewBox,path});
const gun=(id,label,category,path,viewBox='0 0 120 48')=>record(id,label,category,'gun',viewBox,path);
const entries=[
  gun('glock18','Glock-18','pistol','M7 11H61L65 14V23H40L36 29H32L28 43H13L19 25H7Z M39 24H47V28H37Z','0 0 72 48'),
  gun('usp','USP-S','pistol','M6 12H43V10H47V14H69V23H47V25H37L33 31H29L26 43H13L18 26H6Z M35 25H42V29H33Z','0 0 74 48'),
  gun('p228','P250','pistol','M7 10H57L61 13V22L57 26H39L34 32H30L27 43H13L19 27H9L5 21Z M36 26H43V30H34Z','0 0 70 48'),
  gun('deagle','Desert Eagle','pistol','M4 9H12V6H45L66 12V24H43L39 29H35L32 44H17L22 27H11L4 21Z M42 24H49V29H39Z','0 0 74 48'),
  gun('elite','Dual Berettas','pistol','M3 7H48L53 11V18H32L28 23H24L20 35H9L14 20H3Z M22 17H67L72 21V28H51L47 33H43L39 45H28L33 30H22Z','0 0 78 48'),
  gun('fiveseven','Five-SeveN','pistol','M8 9H58L64 13V23H42L37 29H34L30 43H15L18 31L19 26H10L6 21Z M40 24H47V29H37Z','0 0 72 48'),
  gun('m3','Nova','shotgun','M3 22L23 17H38L44 14H111V18H116V21H79V24H52L43 28H33L25 39H14L19 26H12L4 32Z M56 22H86V28H56Z'),
  gun('xm1014','XM1014','shotgun','M3 20H19L29 16H43V13H48V16H113V20H117V23H78V26H55L49 30L54 42H44L39 29H31L25 37H16L19 27H3Z M66 23H103V27H66Z'),
  gun('mac10','MAC-10','smg','M3 17H24V20H31V11H54V15H61V18H80V23H57V28H48L51 43H39L36 28H31V23H23V21H6V32H3Z M49 28H56V33H50Z','0 0 86 48'),
  gun('tmp','MP9','smg','M3 22L24 16H39V12H57V15H66V18H90V23H64L60 27H55V39H48V28H40L35 43H24L29 27H22L7 33H3Z M38 14H48V17H38Z','0 0 98 48'),
  gun('mp5navy','MP5-SD','smg','M3 21H15L24 16H43V12H48V17H66V15H113V26H68L61 28H56Q58 37 64 42L55 46Q48 39 47 29H39L34 41H25L30 27H21L5 34H3Z'),
  gun('ump45','UMP-45','smg','M3 20H24V15H43V12H48V16H82V19H103V23H78L67 27H58L62 45H49L45 29H36L31 40H22L26 27H17L5 33H3Z M18 19V23H25V19Z','0 0 110 48'),
  gun('p90','P90','smg','M6 16Q10 10 24 10H63V7H72V12H86V16H104V21H88L84 25H74L66 39H58L55 28H48L43 39H20Q6 38 4 28Z M20 21V30H34V21Z M23 10H66V14H23Z M80 9H84V16H80Z','0 0 112 48'),
  gun('galil','Galil AR','rifle','M3 21L23 16H36V13H47V16H80V14H85V18H105V20H117V23H82L69 27H60Q64 36 73 41L64 46Q52 39 49 28H39L34 40H25L29 28H22L6 34H3Z M51 12H61V16H51Z'),
  gun('famas','FAMAS','rifle','M3 20H17V16H27V10H74V16H83V19H108V22H117V25H81L72 29H61L57 41H47L49 29H35L31 42H21L23 30H6Z M32 9H69V13H32Z M70 25H78V32H69Z'),
  gun('ak47','AK-47','rifle','M3 22L23 17H35V14H47V17H66V15H85V18H103V20H117V23H87L78 26H62Q65 36 77 41L68 47Q53 40 49 27H40L35 41H26L30 28H23L5 35H3Z M72 12H77V17H72Z M102 16H106V22H102Z'),
  gun('m4a1','M4A1-S','rifle','M3 17H19V15H25V18H36V14H47V17H78V15H84V18H99V15H118V25H99V22H82L72 27H57L61 43H49L45 29H37L32 40H23L27 28H22V25H3Z M39 12V8H58V14H53V11H44V14Z'),
  gun('aug','AUG','rifle','M4 21Q9 16 21 16H44V13H52V10H64L70 14V18H89V20H115V24H87L77 28H62L59 41H48L49 28H42L36 39H18Q6 36 4 29Z M48 8H65V12H48Z M68 27H75V32H66Z'),
  gun('sg552','SG 553','rifle','M3 21L26 17H37V14H46V16H81V13H86V18H104V20H117V23H85L74 27H61L67 43H54L48 29H39L35 40H26L29 28H24L5 33H3Z M43 9H63V13H43Z M51 13H56V17H51Z'),
  gun('scout','SSG 08','sniper','M3 24L23 20H37L45 17H70V19H110V20H118V23H72L61 27H46L41 39H31L33 29H20L5 36H3Z M42 11H49V8H72V12H65V16H58V12H49V16H44Z'),
  gun('awp','AWP','sniper','M3 22L19 18H39L46 16H72V18H112V20H119V23H75L64 27H53L50 37H42L39 29H31L25 39H13L17 27H7L3 31Z M42 8H49V6H77V12H67V16H61V12H51V16H46V12H42Z M68 26H78V33H67Z'),
  gun('g3sg1','G3SG1','sniper','M3 18H21L28 16H41V13H49V17H78V15H86V19H108V21H117V24H84L68 28H59L65 43H52L47 30H37L32 41H23L27 28H21V25H3Z M41 8H46V6H69V11H61V15H55V11H47V15H42Z'),
  gun('sg550','SCAR-20','sniper','M3 17H19L26 14H40V12H80V16H91V19H110V21H117V24H87L77 28H64V42H50V29H41L35 41H26L30 29H23L16 25H3Z M44 6H70V11H62V15H55V11H45Z M73 11H83V15H73Z'),
  gun('m249','M249','machinegun','M3 19H23V16H36V12H47V16H76V18H103V20H117V24H85L78 28H69V43H44V29H36L31 41H22L26 28H3Z M43 12V7H63V12H58V10H48V13Z M93 25H97L93 43H90Z M98 25H101L107 42H104Z'),
  record('knife','匕首','melee','melee','0 0 104 40','M5 25L28 20L32 15L38 18L91 8L99 6L92 15L44 27L41 32L35 29L13 35L5 32Z M34 16L39 12L45 30L40 34Z'),
  record('hegrenade','高爆手雷','grenade','grenade','0 0 38 48','M14 4H24L28 12H25V18Q34 22 34 32Q34 43 20 45Q6 43 6 32Q6 22 15 18V13H12V9H14Z M27 7H34V21H30V11H27Z'),
  record('flashbang','闪光弹','grenade','grenade','0 0 34 48','M11 5H22L25 10H21V15H27V42H7V15H13V11H10Z M24 7H30V19H27V10H24Z M10 18V21H24V18Z M10 35V38H24V35Z'),
  record('smokegrenade','烟雾弹','grenade','grenade','0 0 36 48','M13 4H23L27 11H24V16H29V41L25 45H10L6 41V16H14V12H11Z M26 6H33V21H30V10H26Z M10 24V30H25V24Z'),
  record('c4','C4 炸弹','bomb','bomb','0 0 48 48','M7 13H40V42H7Z M12 17V25H34V17Z M11 8H18V13H14V10H11Z M22 5H35V13H31V9H22Z M12 29V33H17V29Z M21 29V33H26V29Z M30 29V33H35V29Z M12 36V39H17V36Z M21 36V39H26V36Z'),
  record('fall','坠落','environment','environment','0 0 40 48','M15 4A5 5 0 1 1 15 14A5 5 0 1 1 15 4Z M14 16L23 19L30 14L33 18L24 25L20 24L16 32L25 37L23 41L10 35L12 26L5 31L2 27L10 18Z M2 44H38V47H2Z'),
  record('world','环境伤害','environment','environment','0 0 40 40','M20 4L37 34H3Z M18 13V25H22V13Z M18 28V32H22V28Z'),
  record('unknown','未知武器','unknown','unknown','0 0 40 40','M17 5Q30 4 31 14Q31 20 24 23L23 27H17L17 21L23 17Q27 14 23 11Q20 9 15 13L10 9Q13 6 17 5Z M17 31H23V37H17Z'),
];
const weapons=Object.freeze(Object.fromEntries(entries.map(info=>[info.id,info])));
const aliases=Object.freeze({glock:'glock18',usp_silencer:'usp',p250:'p228',nova:'m3',mp9:'tmp',mp5sd:'mp5navy',mp5_sd:'mp5navy',galilar:'galil',m4a1_silencer:'m4a1',sg556:'sg552',sg553:'sg552',ssg08:'scout',scar20:'sg550',knife_t:'knife',worldspawn:'world',environment:'world',blast:'world',planted_c4:'c4'});
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);

export function killWeaponInfo(id){
  if(typeof id!=='string')return weapons.unknown;
  const key=id.startsWith('weapon_')?id.slice(7):id;
  const canonical=own(aliases,key)?aliases[key]:key;
  return own(weapons,canonical)?weapons[canonical]:weapons.unknown;
}

function svgIcon(document,viewBox,path,fillRule='nonzero'){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),shape=document.createElementNS(ns,'path');
  const [, ,width,height]=viewBox.split(' ');
  svg.setAttribute('viewBox',viewBox);svg.setAttribute('width',width);svg.setAttribute('height',height);
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  shape.setAttribute('d',path);shape.setAttribute('fill','currentColor');shape.setAttribute('fill-rule',fillRule);svg.append(shape);return svg;
}

export function createKillIcon(document,id){
  const info=killWeaponInfo(id),svg=svgIcon(document,info.viewBox,info.path);
  svg.setAttribute('data-weapon-canonical',info.id);svg.setAttribute('data-weapon-category',info.category);return svg;
}

export function createHeadshotIcon(document){
  // Head profile, eye and a separate entry burst: deliberately not a second
  // generic death skull, so it cannot be confused with a knife/world death.
  const path='M17 3C10 3 7 8 7 14V19L4 23H9V29H16V25H20L24 21V16C24 8 22 3 17 3Z M15 13H20V17H15Z M25 9L28 7L29 11L33 10L32 14L36 16L32 18L33 22L29 21L27 25L25 21L28 17L25 14Z';
  return svgIcon(document,'0 0 40 32',path,'evenodd');
}
