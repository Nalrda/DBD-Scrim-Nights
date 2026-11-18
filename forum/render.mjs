// Pure renderer: does not depend on Discord and can be tested without credentials.
export const AUTO_MARKER='[DBD-BALANCE-AUTO]';
const MAX=1850;
const md=s=>String(s).replace(/([*_`~|>])/g,'\\$1').replace(/@/g,'@​');
const formatId=(v,lookup,unresolved,label)=> {
 const raw=String(v),name=lookup?.[raw];
 if(!name){unresolved.add(`${label}: ${raw}`);return `ID ${md(raw)} (unmapped)`;}
 return md(name);
};
const list=(name,values,lookup,unresolved,label)=>values?.length?
 [`**${name} (${values.length})**`,...values.map(x=>`• ${formatId(x,lookup,unresolved,label)}`)].join('\n'):null;
const combos=(name,values,lookup,unresolved,label)=>values?.length?
 [`**${name} (${values.length})**`,...values.map(a=>`• ${a.map(x=>formatId(x,lookup,unresolved,label)).join(' + ')}`)].join('\n'):null;
function perkRules(o,cat,warnings){
 return [
  list('Survivor banned perks',o.SurvivorIndvPerkBans,cat.perks,warnings,'perk'),
  list('Killer banned perks',o.KillerIndvPerkBans,cat.perks,warnings,'perk'),
  combos('Survivor banned combinations',o.SurvivorComboPerkBans,cat.perks,warnings,'perk'),
  combos('Killer banned combinations',o.KillerComboPerkBans,cat.perks,warnings,'perk'),
  list('Survivor allowed perk exceptions',o.SurvivorWhitelistedPerks,cat.perks,warnings,'perk'),
  list('Killer allowed perk exceptions',o.KillerWhitelistedPerks,cat.perks,warnings,'perk'),
  combos('Survivor allowed combinations',o.SurvivorWhitelistedComboPerks,cat.perks,warnings,'perk'),
  combos('Killer allowed combinations',o.KillerWhitelistedComboPerks,cat.perks,warnings,'perk'),
 ].filter(Boolean);
}
function splitSections(sections){
 const blocks=[];
 for(const s of sections){
  // Split only between lines to keep each named entry intact.
  let current='';
  for(const line of s.split('\n')){
   if(line.length>MAX)throw Error('Oversized line while formatting: '+line.slice(0,90));
   if(current&&current.length+line.length+1>MAX){blocks.push(current);current='';}
   current+=(current?'\n':'')+line;
  }
  if(current)blocks.push(current);
 }
 return blocks;
}
function tierNames(indices,tiers){return (indices||[]).map(i=>tiers[Number(i)]?.Name||`Unknown tier ${i}`).join(' + ');}
function addonNames(k,cat,warnings){
 return (k.IndividualAddonBans||[]).map(v=>{
  if(typeof v==='string'&&!/^\d+$/.test(v))return md(v);
  const lookup=cat.addons[k.Name]||{};
  return formatId(v,lookup,warnings,`addon / ${k.Name}`);
 });
}
function renderKiller(k,balance,cat,warnings){
 const tier=tierNames(k.BalanceTiers,balance.Tiers);
 const stier=tierNames(k.SurvivorBalanceTiers,balance.Tiers);
 const maps=(k.Map||[]).map(x=>formatId(x,cat.maps,warnings,'map')).join(', ')||'Not specified';
 const intro=[
  `**Killer:** ${md(k.Name)}`,
  `**Map:** ${maps}`,
  `**Killer rules:** ${tier}`,
  `**Survivor rules:** ${stier}`,
  `**Anti-facecamp permitted:** ${k.AntiFacecampPermitted?'Yes':'No'}`,
  ...(k.KillerNotes?[`**Notes:** ${md(k.KillerNotes)}`]:[]),
  '',
  'The General rules and all named tiers apply cumulatively. This thread shows killer-specific overrides. See pinned General/Tier threads for inherited bans.'
 ].join('\n');
 const sections=[intro,...perkRules(k,cat,warnings)];
 const bans=addonNames(k,cat,warnings);
 if(k.AddonTiersBanned?.length)sections.push(`**Banned add-on rarities/tiers:** ${k.AddonTiersBanned.map(md).join(', ')}`);
 if(bans.length)sections.push(['**Banned killer add-ons**',...bans.map(n=>'• '+n)].join('\n'));
 const items=(k.ItemWhitelist||[]).map(x=>formatId(x,cat.items,warnings,'item'));
 if(items.length)sections.push(['**Survivor items allowed (whitelist)**',...items.map(x=>'• '+x)].join('\n'));
 if(k.AddonWhitelist){
  for(const [type,o] of Object.entries(k.AddonWhitelist)){
   if(!o?.Addons?.length)continue;
   sections.push(['**Allowed '+md(type)+' item add-ons**',...o.Addons.map(x=>'• '+formatId(x,cat.itemAddons?.[type],warnings,'item addon / '+type))].join('\n'));
  }
 }
 for(const side of ['Survivor','Killer']){
  const values=k[side+'Offerings']||[];
  if(values.length)sections.push(['**Allowed '+side.toLowerCase()+' offerings**',...values.map(v=>'• '+formatId(v,cat.offerings?.[side],warnings,'offering'))].join('\n'));
 }
 sections.push('**Restriction model:** Empty ban list = no additional ban at this scope. Empty item add-on whitelist = no additional allowed add-ons in that category. Follow the imported JSON as the authoritative version.');
 return splitSections(sections);
}
export function buildForumPosts(balance,cat){
 if(!Array.isArray(balance?.Tiers)||!Array.isArray(balance?.KillerOverride))throw Error('Unexpected balance schema');
 const warnings=new Set(),posts=[];
 const general=balance.Tiers[0];
 if(general.Name!=='General')throw Error('Expected General rules at tier index 0');
 const generalSections=[
  `**${md(balance.Name)}**\n**Version:** ${md(balance.Version)}\n**Maximum perk repetition:** ${md(balance.MaxPerkRepetition)}\n\nApplies to every killer and survivor. Additional tier and killer-specific rules are cumulative.`,
  ...(balance.GlobalNotes?[`**Global notes**\n${md(balance.GlobalNotes)}`]:[]),
  ...perkRules(general,cat,warnings)
 ];
 posts.push({name:'00 • GENERAL RULES',key:'general',parts:splitSections(generalSections)});
 for(let i=1;i<balance.Tiers.length;i++){
  const t=balance.Tiers[i];
  const sections=[`**${md(t.Name)}**\nTier-specific rules apply in addition to General and any killer-specific restrictions.`,...perkRules(t,cat,warnings)];
  posts.push({name:`0${i} • ${t.Name.toUpperCase()}`,key:'tier-'+i,parts:splitSections(sections)});
 }
 for(const k of balance.KillerOverride){
  if(k.IsDisabled)continue;
  posts.push({name:k.Name,key:'killer-'+k.Name,parts:renderKiller(k,balance,cat,warnings)});
 }
 const names=new Set(posts.map(p=>p.name));
 if(names.size!==posts.length)throw Error('Duplicate forum thread names');
 return {posts,warnings:[...warnings].sort()};
}
