// UI reads the canonical catalog and snapshots; only the server changes inventory or money.
import {equipmentPrice} from './economy.js';
import {createShopIcon} from './shop-icons.js';
export const GRENADE_IDS=['hegrenade','flashbang','smokegrenade'];
const groups=[{id:'equipment',label:'装备 / 投掷物',categories:['equipment']},{id:'pistol',label:'手枪',categories:['pistol']},
  {id:'mid',label:'冲锋枪 / 重型',categories:['smg','shotgun','machinegun']},{id:'rifle',label:'步枪',categories:['rifle']},{id:'sniper',label:'狙击步枪',categories:['sniper']}];
const money=value=>Number.isFinite(value)?`$${value.toLocaleString('en-US')}`:'服务器定价';
export function ownedWeapons(p,bomb){
  if(!p)return [];
  const inventory=p.inventory||{};
  const guns=[p.primary,p.pistol].filter(id=>id&&Object.hasOwn(inventory,id));
  return [...new Set([...guns,'knife',...GRENADE_IDS.filter(id=>(p.grenades?.[id]||0)>0),...(bomb?.state==='carried'&&bomb.holder===p.id?['c4']:[])])];
}
export function equipmentCount(p,id){
  if(GRENADE_IDS.includes(id))return p.grenades?.[id]||0;
  if(id==='kevlar')return Number((p.armour||0)>0);
  if(id==='assaultsuit')return Number(Boolean(p.helmet));
  return Number(Boolean(p[{defusekit:'defuseKit',nightvision:'nightvision',shield:'shield'}[id]]));
}
export function teamAllows(item,team){return !item.teams||item.teams.includes(team)||item.teams.includes('both');}
export function purchaseStatus(item,p,guns){
  if(!p?.alive)return '阵亡后无法购买';
  if(!teamAllows(item,p.team))return `${(item.teams||[]).join(' / ')} 专属`;
  if(!p.canBuy)return '需在购买区与购买时间内';
  if(Object.hasOwn(guns,item.id)){
    if(Object.hasOwn(p.inventory||{},item.id))return p.weapon===item.id?'已装备':'已拥有';
  }else if(item.id==='kevlar'||item.id==='assaultsuit'){
    if((p.armour||0)>=100&&(item.id==='kevlar'||p.helmet))return '护甲装备已满';
  }else if(equipmentCount(p,item.id)>=(item.limit||1))return '已达携带上限';
  const quote=equipmentPrice(item.id,p)??item.price;
  if(Number.isFinite(quote)&&Number.isFinite(p.money)&&p.money<quote)return '资金不足';
  return '';
}
export function createShop({guns,equipment,economy,send,onOpenChange,onResume,root=document}){
  const $=id=>root.getElementById(id),panel=$('buyMenu'),list=$('buyItems');
  const catalog=Object.entries(guns).map(([id,item])=>({...item,id,category:item.category||'rifle'}));
  catalog.push(...Object.entries(equipment).map(([id,item])=>({...item,id,category:'equipment'})));
  let open=false,player=null,state=null,signature='',pending=null;
  const rows=new Map();
  function node(tag,className,text){const el=root.createElement(tag);el.className=className;if(text!==undefined)el.textContent=text;return el;}
  // Every card stays mounted while snapshots arrive: no category navigation and
  // no lost mouse-up target when a purchase changes the balance or inventory.
  for(const group of groups){
    const column=node('section','buy-column');column.dataset.category=group.id;
    const heading=node('h3','buy-column-title',group.label);heading.id=`buy-group-${group.id}`;column.setAttribute('aria-labelledby',heading.id);column.append(heading);
    const items=catalog.filter(item=>group.categories.includes(item.category)).sort((a,b)=>Number(GRENADE_IDS.includes(a.id))-Number(GRENADE_IDS.includes(b.id))||a.price-b.price);
    for(const item of items){
      const button=node('button','shop-item');button.type='button';button.dataset.item=item.id;
      const head=node('span','shop-item-head'),name=node('strong','shop-item-name'),price=node('strong','shop-item-price');head.append(name,price);
      const detail=node('span','shop-item-detail'),owned=node('span','shop-item-owned'),action=node('span','shop-item-action'),status=node('span','shop-item-status');status.append(owned,action);
      button.append(createShopIcon(root,item),head,detail,status);button.onclick=()=>purchase(item.id);column.append(button);
      rows.set(item.id,{button,name,price,detail,owned,action,item});
    }
    list.append(column);
  }
  function setOpen(value){
    if(open===value)return;open=value;panel.hidden=!open;signature='';
    onOpenChange(open);if(open){render();$('buyResume').focus();}
  }
  $('buyClose').onclick=()=>setOpen(false);
  $('buyResume').onclick=()=>{setOpen(false);onResume();};
  function status(text,isError=false){$('buyMessage').textContent=text;$('buyMessage').dataset.error=String(isError);}
  function purchase(id){
    const item=rows.get(id)?.item;
    if(!open||!item||purchaseStatus(item,player,guns))return;
    if(pending?.id===id&&performance.now()-pending.at<180)return;
    pending={id,at:performance.now(),before:JSON.stringify([player.money,player.inventory,player.grenades,player.armour,player.helmet,player.defuseKit,player.nightvision,player.shield])};
    status(`请求购买 ${item.name}，等待服务器确认…`);send({type:'buy',item:id});
  }
  function render(){
    if(!open)return;
    $('buyBalance').textContent=money(player?.money);
    $('buyTeam').textContent=player?`${player.team} / ${player.name}`:'等待玩家';
    const seconds=state?Math.max(0,Math.ceil((state.buyEndAt||0)-state.time)):0;
    $('buyAvailability').textContent=!player?.alive?'阵亡 · 仅浏览装备':player.canBuy?`可购买 · ${seconds} 秒`:'购买已关闭 · 需在购买区与购买时间内';
    $('buyAvailability').dataset.available=String(Boolean(player?.alive&&player.canBuy));
    const next=JSON.stringify([player?.money,player?.weapon,player?.primary,player?.pistol,player?.alive,player?.canBuy,player?.team,player?.inventory,player?.reserve,player?.ammoPool,player?.grenades,player?.armour,player?.helmet,player?.defuseKit,player?.nightvision,player?.shield]);
    if(next===signature)return;signature=next;
    for(const item of catalog){
      const row=rows.get(item.id);
      const quote=equipmentPrice(item.id,player)??item.price;
      row.item=item;row.name.textContent=item.name;row.price.textContent=money(quote);
      const team=teamAllows(item,'T')&&teamAllows(item,'CT')?'双方可用':`${(item.teams||[]).join(' / ')} 专属`;
      row.detail.textContent=Object.hasOwn(guns,item.id)?`${team} · ${item.slot===2?'2 手枪':'1 主武器'} · ${item.clip} / ${item.reserve} 发 · 赠满备弹`:`${team} · 携带上限 ${item.limit||1}`;
      const count=player?(Object.hasOwn(guns,item.id)?Number(Object.hasOwn(player.inventory||{},item.id)):equipmentCount(player,item.id)):0;
      const equipped=player?.weapon===item.id;
      row.owned.textContent=equipped?'当前装备':count?`已拥有${GRENADE_IDS.includes(item.id)?` ${count} / ${item.limit||1}`:''}`:'';
      if(player&&['kevlar','assaultsuit'].includes(item.id))row.owned.textContent=`护甲 ${Math.ceil(player.armour||0)} / 100${player.helmet?' · 已有头盔':''}`;
      row.button.dataset.owned=String(count>0);row.button.dataset.equipped=String(equipped);
      const reason=purchaseStatus(item,player,guns);row.button.disabled=Boolean(reason);row.action.textContent=reason||'购买 +';
      row.button.title=`${item.name} · ${row.detail.textContent} · ${row.action.textContent}`;
      row.button.setAttribute('aria-label',`${item.name} ${money(quote)} · ${row.owned.textContent} · ${row.action.textContent}`);
    }
  }
  $('buyStartMoney').textContent=`开局资金 ${money(economy.startMoney??10000)} · 买枪赠满备弹，每回合自动补满弹匣与备弹`;
  return {
    get isOpen(){return open;},setOpen,toggle:()=>setOpen(!open),
    update(p,s){player=p;state=s;
      if(pending&&JSON.stringify([p.money,p.inventory,p.grenades,p.armour,p.helmet,p.defuseKit,p.nightvision,p.shield])!==pending.before){status('服务器已更新资金 / 装备。');pending=null;}
      render();
    },
    reportError(message){pending=null;status(String(message),true);},
    reportResult(message,ok){pending=null;status(String(message),!ok);}
  };
}
